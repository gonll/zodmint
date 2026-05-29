import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { mockFactory } from "../src/factory.js";
import { resetConfig } from "../src/config.js";
import { ZodForgeError } from "../src/errors.js";

afterEach(() => resetConfig());

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().min(18).max(99),
  role: z.enum(["user", "admin", "guest"]),
  active: z.boolean(),
});

// ─── Core ────────────────────────────────────────────────────────────────────

describe("mockFactory() — core", () => {
  it("returns a callable factory function", () => {
    const createUser = mockFactory(UserSchema);
    expect(typeof createUser).toBe("function");
  });

  it("factory produces valid objects", () => {
    const createUser = mockFactory(UserSchema);
    const user = createUser();
    expect(UserSchema.safeParse(user).success).toBe(true);
  });

  it("factory produces varied output on multiple calls", () => {
    const createUser = mockFactory(UserSchema);
    const users = Array.from({ length: 10 }, () => createUser());
    const names = new Set(users.map((u) => u.name));
    expect(names.size).toBeGreaterThan(1);
  });

  it("per-call overrides applied", () => {
    const createUser = mockFactory(UserSchema);
    const user = createUser({ overrides: { name: "John" } });
    expect(user.name).toBe("John");
  });

  it("base overrides applied to every call", () => {
    const createActiveUser = mockFactory(UserSchema, {
      overrides: { active: true },
    });
    for (let i = 0; i < 5; i++) {
      expect(createActiveUser().active).toBe(true);
    }
  });

  it("per-call overrides win over base overrides", () => {
    const createUser = mockFactory(UserSchema, {
      overrides: { name: "Base Name" },
    });
    const user = createUser({ overrides: { name: "Override Name" } });
    expect(user.name).toBe("Override Name");
  });

  it("base seed produces deterministic results across calls", () => {
    const createUser = mockFactory(UserSchema, { seed: 42 });
    const a = createUser();
    const b = createUser();
    expect(a).toEqual(b);
  });

  it("deep-merges nested overrides from base and call", () => {
    const schema = z.object({
      user: z.object({ role: z.string(), name: z.string() }),
    });
    const createUser = mockFactory(schema, {
      overrides: { user: { role: "admin" } },
    });
    const result = createUser({ overrides: { user: { name: "Alice" } } });
    expect(result.user.role).toBe("admin");   // base preserved
    expect(result.user.name).toBe("Alice");   // call wins
    expect(schema.safeParse(result).success).toBe(true);
  });
});

// ─── States ──────────────────────────────────────────────────────────────────

describe("mockFactory() — states", () => {
  const factory = mockFactory(UserSchema, {
    states: {
      admin:    { role: "admin" },
      guest:    { role: "guest" },
      inactive: { active: false },
      aged:     { age: 99 },
    },
  });

  it("activates a single state by string", () => {
    const user = factory({ states: "admin" });
    expect(user.role).toBe("admin");
    expect(UserSchema.safeParse(user).success).toBe(true);
  });

  it("activates a single state via array with one element", () => {
    const user = factory({ states: ["guest"] });
    expect(user.role).toBe("guest");
  });

  it("merges multiple states left-to-right", () => {
    const user = factory({ states: ["admin", "inactive"] });
    expect(user.role).toBe("admin");
    expect(user.active).toBe(false);
  });

  it("later state wins on conflicting fields", () => {
    const f = mockFactory(UserSchema, {
      states: {
        admin: { role: "admin" },
        guest: { role: "guest" },
      },
    });
    const user = f({ states: ["admin", "guest"] });
    // "guest" state comes after "admin" so it wins
    expect(user.role).toBe("guest");
  });

  it("per-call overrides win over state overrides", () => {
    const user = factory({
      states: "admin",
      overrides: { role: "guest" }, // explicit override beats state
    });
    expect(user.role).toBe("guest");
  });

  it("base overrides are applied before state overrides", () => {
    const f = mockFactory(UserSchema, {
      overrides: { active: true },
      states: { inactive: { active: false } },
    });
    // state wins over base override (state is applied after base)
    const user = f({ states: "inactive" });
    expect(user.active).toBe(false);
  });

  it("no states applied when states not specified", () => {
    const user = factory();
    expect(UserSchema.safeParse(user).success).toBe(true);
  });

  it("throws INVALID_OVERRIDE for unknown state", () => {
    expect(() => factory({ states: "superadmin" })).toThrow(ZodForgeError);
    expect(() => factory({ states: "superadmin" })).toThrow("Unknown factory state");
  });

  it("error message lists available states", () => {
    try {
      factory({ states: "unknown" });
    } catch (e) {
      const err = e as ZodForgeError;
      expect(err.code).toBe("INVALID_OVERRIDE");
      expect(err.message).toContain("admin");
      expect(err.message).toContain("guest");
    }
  });

  it("empty states object with no state applied still works", () => {
    const f = mockFactory(UserSchema, { states: {} });
    expect(UserSchema.safeParse(f()).success).toBe(true);
  });
});

// ─── afterBuild ──────────────────────────────────────────────────────────────

describe("mockFactory() — afterBuild", () => {
  it("runs afterBuild on every generated value", () => {
    const PostSchema = z.object({ title: z.string(), slug: z.string() });
    const factory = mockFactory(PostSchema, {
      afterBuild: (post) => ({
        ...post,
        slug: post.title.toLowerCase().replace(/\s+/g, "-"),
      }),
    });
    const post = factory();
    expect(post.slug).toBe(post.title.toLowerCase().replace(/\s+/g, "-"));
  });

  it("afterBuild receives the override-merged value", () => {
    const factory = mockFactory(UserSchema, {
      afterBuild: (user) => ({ ...user, name: user.name.toUpperCase() }),
    });
    const user = factory({ overrides: { name: "alice" } });
    expect(user.name).toBe("ALICE");
  });

  it("afterBuild receives state-resolved value", () => {
    const seen: string[] = [];
    const factory = mockFactory(UserSchema, {
      states: { admin: { role: "admin" } },
      afterBuild: (user) => {
        seen.push(user.role);
        return user;
      },
    });
    factory({ states: "admin" });
    expect(seen[0]).toBe("admin");
  });

  it("afterBuild return value is what the factory returns", () => {
    const factory = mockFactory(UserSchema, {
      afterBuild: (user) => ({ ...user, age: 42 }),
    });
    const user = factory();
    expect(user.age).toBe(42);
  });
});

// ─── extend ──────────────────────────────────────────────────────────────────

describe("mockFactory() — extend()", () => {
  it("derive a new factory with additional overrides", () => {
    const base = mockFactory(UserSchema);
    const adminFactory = base.extend({ overrides: { role: "admin" } });
    const user = adminFactory();
    expect(user.role).toBe("admin");
    expect(UserSchema.safeParse(user).success).toBe(true);
  });

  it("extend deep-merges overrides (extend wins)", () => {
    const base = mockFactory(UserSchema, { overrides: { active: true } });
    const derived = base.extend({ overrides: { role: "guest" } });
    const user = derived();
    expect(user.active).toBe(true);   // from base
    expect(user.role).toBe("guest");  // from extend
  });

  it("extend merges states (new states added, existing ones overrideable)", () => {
    const base = mockFactory(UserSchema, {
      states: { admin: { role: "admin" } },
    });
    const derived = base.extend({
      states: { banned: { active: false } },
    });
    expect(derived({ states: "admin" }).role).toBe("admin");   // inherited
    expect(derived({ states: "banned" }).active).toBe(false);  // new
  });

  it("extend can override an existing state", () => {
    const base = mockFactory(UserSchema, {
      states: { special: { role: "admin" } },
    });
    const derived = base.extend({
      states: { special: { role: "guest" } }, // override the "special" state
    });
    expect(derived({ states: "special" }).role).toBe("guest");
  });

  it("chains afterBuild hooks (base runs first, extend runs second)", () => {
    const log: string[] = [];
    const base = mockFactory(UserSchema, {
      afterBuild: (u) => { log.push("base"); return u; },
    });
    const derived = base.extend({
      afterBuild: (u) => { log.push("extend"); return u; },
    });
    derived();
    expect(log).toEqual(["base", "extend"]);
  });

  it("chained afterBuild passes return value through the chain", () => {
    const base = mockFactory(UserSchema, {
      afterBuild: (u) => ({ ...u, age: 30 }),
    });
    const derived = base.extend({
      afterBuild: (u) => ({ ...u, name: `User-${u.age}` }),
    });
    const user = derived();
    expect(user.age).toBe(30);
    expect(user.name).toBe("User-30");
  });

  it("extend without afterBuild inherits base afterBuild", () => {
    const base = mockFactory(UserSchema, {
      afterBuild: (u) => ({ ...u, age: 55 }),
    });
    const derived = base.extend({ overrides: { role: "guest" } });
    expect(derived().age).toBe(55);
  });

  it("extend does not mutate the base factory", () => {
    const base = mockFactory(UserSchema, { overrides: { role: "user" } });
    base.extend({ overrides: { role: "admin" } });
    // base still produces "user"
    expect(base().role).toBe("user");
  });

  it("multiple levels of extend chain correctly", () => {
    const base = mockFactory(UserSchema);
    const level1 = base.extend({ overrides: { active: true } });
    const level2 = level1.extend({ overrides: { role: "admin" } });
    const level3 = level2.extend({ overrides: { age: 25 } });
    const user = level3();
    expect(user.active).toBe(true);
    expect(user.role).toBe("admin");
    expect(user.age).toBe(25);
    expect(UserSchema.safeParse(user).success).toBe(true);
  });
});

// ─── Async factory ───────────────────────────────────────────────────────────

describe("factory.async()", () => {
  it("resolves to a valid object", async () => {
    const factory = mockFactory(UserSchema);
    const user = await factory.async();
    expect(UserSchema.safeParse(user).success).toBe(true);
  });

  it("respects overrides", async () => {
    const factory = mockFactory(UserSchema);
    const user = await factory.async({ overrides: { role: "admin" } });
    expect(user.role).toBe("admin");
  });

  it("applies states", async () => {
    const factory = mockFactory(UserSchema, {
      states: { admin: { role: "admin" } },
    });
    const user = await factory.async({ states: "admin" });
    expect(user.role).toBe("admin");
  });

  it("runs sync afterBuild", async () => {
    const factory = mockFactory(UserSchema, {
      afterBuild: (u) => ({ ...u, name: "sync-hook" }),
    });
    const user = await factory.async();
    expect(user.name).toBe("sync-hook");
  });

  it("awaits async afterBuild", async () => {
    const factory = mockFactory(UserSchema, {
      afterBuild: async (u) => ({ ...u, name: "async-hook" }),
    });
    const user = await factory.async();
    expect(user.name).toBe("async-hook");
  });

  it("works with schemas containing async refinements", async () => {
    const EvenAge = z.object({
      name: z.string(),
      age: z.number().int().min(18).max(98).superRefine(async (n, ctx) => {
        if (n % 2 !== 0) ctx.addIssue({ code: "custom", message: "must be even" });
      }),
    });
    const factory = mockFactory(EvenAge);
    const result = await factory.async();
    expect(result.age % 2).toBe(0);
  });

  it("throws a friendly error when sync factory() is called with async afterBuild", () => {
    const factory = mockFactory(UserSchema, {
      afterBuild: async (u) => u,
    });
    expect(() => factory()).toThrow(ZodForgeError);
    expect(() => factory()).toThrow("factory.async()");
  });

  it("chained async afterBuild via extend works", async () => {
    const base = mockFactory(UserSchema, {
      afterBuild: async (u) => ({ ...u, name: "base" }),
    });
    const derived = base.extend({
      afterBuild: async (u) => ({ ...u, name: `${u.name}-ext` }),
    });
    const user = await derived.async();
    expect(user.name).toBe("base-ext");
  });

  it("unknown state throws ZodForgeError", async () => {
    const factory = mockFactory(UserSchema, { states: { admin: { role: "admin" } } });
    await expect(factory.async({ states: "nonexistent" })).rejects.toThrow(ZodForgeError);
  });
});
