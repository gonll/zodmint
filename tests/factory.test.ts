import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { mockFactory } from "../src/factory.js";
import { resetConfig } from "../src/config.js";

afterEach(() => resetConfig());

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().min(18).max(99),
  active: z.boolean(),
});

describe("mockFactory()", () => {
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
    // Same factory with same seed should produce same output
    expect(a).toEqual(b);
  });
});
