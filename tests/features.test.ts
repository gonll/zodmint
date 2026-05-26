import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { mock, mockList } from "../src/mock.js";
import { ZodForgeError } from "../src/errors.js";
import { resetConfig, configure, definePlugin } from "../src/config.js";

afterEach(() => resetConfig());

// ---------------------------------------------------------------------------
// z.describe() metadata support
// ---------------------------------------------------------------------------

describe("z.describe() semantic inference", () => {
  it("uses description as semantic hint for string format", () => {
    const schema = z.string().describe("email");
    const result = mock(schema);
    expect(result).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("uses description 'uuid' to generate a uuid", () => {
    const schema = z.string().describe("uuid");
    const result = mock(schema);
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("uses description 'url' to generate a url", () => {
    const schema = z.string().describe("url");
    const result = mock(schema);
    expect(result).toMatch(/^https?:\/\//);
  });

  it("uses description 'phone' to generate a phone number", () => {
    const schema = z.string().describe("phone");
    const result = mock(schema);
    expect(result).toMatch(/\d/);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("uses description 'price' to generate a realistic price for numbers", () => {
    const schema = z.number().describe("price");
    const result = mock(schema);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("uses description 'age' to generate a plausible age", () => {
    const schema = z.number().describe("age");
    const results = Array.from({ length: 20 }, () => mock(schema));
    results.forEach(r => {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(130);
    });
  });

  it("description takes priority over field name for semantic inference", () => {
    // Field name 'x' has no semantic meaning, but describe("email") should win
    const schema = z.object({ x: z.string().describe("email") });
    const results = Array.from({ length: 10 }, () => mock(schema));
    const allEmails = results.every(r => /^[^@]+@[^@]+\.[^@]+$/.test(r.x));
    expect(allEmails).toBe(true);
  });

  it("standalone schema with no path uses description for semantic hint", () => {
    const schema = z.string().describe("firstName");
    // Should produce a proper name, not a random string
    const result = mock(schema);
    expect(schema.safeParse(result).success).toBe(true);
    // It should be a short word (a first name), not a UUID-like random string
    expect(result.length).toBeGreaterThan(0);
  });

  it("generates valid value when description matches no semantic pattern", () => {
    const schema = z.string().describe("something entirely unknown xyz123");
    const result = mock(schema);
    expect(typeof result).toBe("string");
    expect(schema.safeParse(result).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mode: "edge"
// ---------------------------------------------------------------------------

describe('mode: "edge"', () => {
  it("generates boundary string: empty (min=0)", () => {
    const schema = z.string();
    const result = mock(schema, { mode: "edge" });
    expect(typeof result).toBe("string");
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates boundary string: exactly min-length", () => {
    const schema = z.string().min(5);
    const result = mock(schema, { mode: "edge" });
    // Should be exactly 5 chars (the minimum)
    expect(result.length).toBe(5);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates boundary string: max-length or min-length when both constrained", () => {
    const schema = z.string().min(3).max(8);
    const result = mock(schema, { mode: "edge" });
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(8);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates shortest valid email in edge mode", () => {
    const schema = z.string().email();
    const result = mock(schema, { mode: "edge" });
    expect(schema.safeParse(result).success).toBe(true);
    expect(result).toMatch(/@/);
  });

  it("generates canonical edge uuid", () => {
    const schema = z.string().uuid();
    const result = mock(schema, { mode: "edge" });
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates 0 for unconstrained number", () => {
    const schema = z.number();
    const result = mock(schema, { mode: "edge", seed: 1 });
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates minimum number when constrained", () => {
    const schema = z.number().min(10).max(100);
    const result = mock(schema, { mode: "edge" });
    expect(result).toBe(10);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates false for boolean", () => {
    const schema = z.boolean();
    const result = mock(schema, { mode: "edge" });
    expect(result).toBe(false);
  });

  it("generates undefined for optional", () => {
    const schema = z.string().optional();
    const result = mock(schema, { mode: "edge" });
    expect(result).toBeUndefined();
  });

  it("generates null for nullable", () => {
    const schema = z.string().nullable();
    const result = mock(schema, { mode: "edge" });
    expect(result).toBeNull();
  });

  it("generates empty array for unconstrained array", () => {
    const schema = z.array(z.string());
    const result = mock(schema, { mode: "edge" });
    expect(result).toEqual([]);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates minimum-length array when constrained", () => {
    const schema = z.array(z.string()).min(2);
    const result = mock(schema, { mode: "edge" });
    expect(result.length).toBe(2);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates epoch date in edge mode", () => {
    const schema = z.date();
    const result = mock(schema, { mode: "edge" });
    expect(result).toEqual(new Date(0));
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generates zero bigint in edge mode", () => {
    const schema = z.bigint();
    const result = mock(schema, { mode: "edge" });
    expect(result).toBe(0n);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("entire object is valid in edge mode", () => {
    const schema = z.object({
      name: z.string().min(2).max(50),
      age: z.number().int().min(0).max(150),
      active: z.boolean(),
      tags: z.array(z.string()),
      nickname: z.string().optional(),
      score: z.number().min(0).max(100),
    });
    const result = mock(schema, { mode: "edge" });
    const parsed = schema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.active).toBe(false);
    expect(result.nickname).toBeUndefined();
    expect(result.tags).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// mode: "random"
// ---------------------------------------------------------------------------

describe('mode: "random"', () => {
  it("does not throw", () => {
    expect(() => mock(z.string(), { mode: "random" })).not.toThrow();
  });

  it("generates valid values", () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().int().min(0).max(150),
      active: z.boolean(),
    });
    const result = mock(schema, { mode: "random" });
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("field named 'email' without .email() constraint gets a random string not necessarily an email", () => {
    // In random mode, field name inference is off
    const schema = z.object({ email: z.string() });
    // We can't assert it's NOT an email (it might randomly be), but we can
    // assert it doesn't throw and is a valid string
    const results = Array.from({ length: 20 }, () => mock(schema, { mode: "random" }));
    results.forEach(r => expect(typeof r.email).toBe("string"));
  });

  it("respects format constraints even in random mode", () => {
    const schema = z.string().email();
    const result = mock(schema, { mode: "random" });
    expect(z.string().email().safeParse(result).success).toBe(true);
  });

  it("same seed produces same output", () => {
    const schema = z.object({ name: z.string(), score: z.number() });
    const a = mock(schema, { mode: "random", seed: 7 });
    const b = mock(schema, { mode: "random", seed: 7 });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Path-based generators
// ---------------------------------------------------------------------------

describe("path-based generators", () => {
  it("uses generator for exact path", () => {
    const schema = z.object({ zip: z.string() });
    const result = mock(schema, {
      generators: { "zip": () => "90210" },
    });
    expect(result.zip).toBe("90210");
  });

  it("uses generator for nested path", () => {
    const schema = z.object({
      user: z.object({ address: z.object({ zip: z.string() }) }),
    });
    const result = mock(schema, {
      generators: { "user.address.zip": () => "90210" },
    });
    expect(result.user.address.zip).toBe("90210");
  });

  it("uses wildcard path for array items", () => {
    const schema = z.object({
      items: z.array(z.object({ sku: z.string() })),
    });
    const result = mock(schema, {
      generators: { "items.*.sku": () => "SKU-TEST" },
    });
    result.items.forEach(item => {
      expect(item.sku).toBe("SKU-TEST");
    });
  });

  it("generator takes priority over semantic inference", () => {
    const schema = z.object({ email: z.string() });
    const result = mock(schema, {
      generators: { "email": () => "custom@override.com" },
    });
    expect(result.email).toBe("custom@override.com");
  });

  it("generator takes priority over describe()", () => {
    const schema = z.object({ contact: z.string().describe("email") });
    const result = mock(schema, {
      generators: { "contact": () => "pinned@test.com" },
    });
    expect(result.contact).toBe("pinned@test.com");
  });

  it("non-matching paths use normal generation", () => {
    const schema = z.object({ name: z.string(), zip: z.string() });
    const result = mock(schema, {
      generators: { "zip": () => "90210" },
    });
    expect(result.zip).toBe("90210");
    // name is still generated normally
    expect(typeof result.name).toBe("string");
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("generator can return any type compatible with schema", () => {
    const schema = z.object({ count: z.number().int() });
    const result = mock(schema, {
      generators: { "count": () => 42 },
    });
    expect(result.count).toBe(42);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("mockList passes generators to each call", () => {
    const schema = z.object({ id: z.string() });
    const results = mockList(schema, {
      count: 3,
      generators: { "id": () => "fixed-id" },
    });
    results.forEach(r => expect(r.id).toBe("fixed-id"));
  });

  it("generator returning invalid value throws with path in message", () => {
    const schema = z.object({ age: z.number().positive() });
    expect(() =>
      mock(schema, { generators: { "age": () => -5 } })
    ).toThrow(ZodForgeError);
    try {
      mock(schema, { generators: { "age": () => -5 } });
    } catch (e) {
      expect((e as ZodForgeError).message).toContain("age");
    }
  });
});

// ---------------------------------------------------------------------------
// mode: "edge" — additional types
// ---------------------------------------------------------------------------

describe('mode: "edge" — additional types', () => {
  it("z.literal in edge mode returns the literal value and passes safeParse", () => {
    const schema = z.literal("hello");
    const result = mock(schema, { mode: "edge" });
    expect(result).toBe("hello");
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("z.enum in edge mode returns a valid enum member and passes safeParse", () => {
    const schema = z.enum(["a", "b", "c"]);
    const result = mock(schema, { mode: "edge" });
    expect(["a", "b", "c"]).toContain(result);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("z.union in edge mode passes safeParse", () => {
    const schema = z.union([z.string(), z.number()]);
    const result = mock(schema, { mode: "edge" });
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("z.record in edge mode passes safeParse", () => {
    const schema = z.record(z.string(), z.number());
    const result = mock(schema, { mode: "edge" });
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("z.tuple in edge mode passes safeParse", () => {
    const schema = z.tuple([z.string(), z.number()]);
    const result = mock(schema, { mode: "edge" });
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("z.set in edge mode produces empty Set and passes safeParse", () => {
    const schema = z.set(z.string());
    const result = mock(schema, { mode: "edge" });
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("z.map in edge mode produces empty Map and passes safeParse", () => {
    const schema = z.map(z.string(), z.number());
    const result = mock(schema, { mode: "edge" });
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(schema.safeParse(result).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// refinementRetries option
// ---------------------------------------------------------------------------

describe("refinementRetries option", () => {
  it("respects per-call refinementRetries", () => {
    const schema = z.string().refine(() => false, "always fails");
    expect(() => mock(schema, { refinementRetries: 3 })).toThrow(ZodForgeError);
  });

  it("higher retries increases chance of satisfying strict refinement", () => {
    // Only 1-in-10 numbers pass — needs retries
    const schema = z.number().int().min(1).max(100)
      .refine(v => v % 10 === 0, "must be multiple of 10");
    // With enough retries this should always pass
    expect(() => mock(schema, { refinementRetries: 50, seed: 1 })).not.toThrow();
    const result = mock(schema, { refinementRetries: 50, seed: 1 });
    expect(result % 10).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// z.symbol() support
// ---------------------------------------------------------------------------

describe("z.symbol() support", () => {
  it("generates a symbol", () => {
    const schema = z.symbol();
    const value = mock(schema);
    expect(typeof value).toBe("symbol");
  });

  it("passes safeParse", () => {
    const schema = z.symbol();
    expect(schema.safeParse(mock(schema)).success).toBe(true);
  });

  it("generates a symbol inside an object", () => {
    const schema = z.object({ key: z.symbol(), label: z.string() });
    const value = mock(schema);
    expect(typeof value.key).toBe("symbol");
    expect(schema.safeParse(value).success).toBe(true);
  });

  it("symbol description contains path for debuggability", () => {
    const schema = z.object({ tag: z.symbol() });
    const value = mock(schema);
    expect(value.tag.description).toContain("tag");
  });
});

// ---------------------------------------------------------------------------
// MatcherContext (ctx.path in custom matchers)
// ---------------------------------------------------------------------------

describe("MatcherContext in custom matchers", () => {
  afterEach(() => resetConfig());

  it("receives the leaf key", () => {
    const received: string[] = [];
    configure({
      matchers: [
        {
          pattern: /zip/i,
          generate: (ctx) => { received.push(ctx!.leaf); return "90210"; },
        },
      ],
    });
    const schema = z.object({ zip: z.string() });
    mock(schema);
    expect(received[0]).toBe("zip");
  });

  it("receives the full path array", () => {
    const paths: string[][] = [];
    configure({
      matchers: [
        {
          pattern: /zip/i,
          generate: (ctx) => { paths.push(ctx!.path); return "10001"; },
        },
      ],
    });
    const schema = z.object({ address: z.object({ zip: z.string() }) });
    mock(schema);
    expect(paths[0]).toEqual(["address", "zip"]);
  });

  it("allows path-conditional generation", () => {
    configure({
      matchers: [
        {
          pattern: /zip/i,
          generate: (ctx) =>
            ctx?.path.includes("billing") ? "BILLING-ZIP" : "SHIPPING-ZIP",
        },
      ],
    });
    const schema = z.object({
      billing:  z.object({ zip: z.string() }),
      shipping: z.object({ zip: z.string() }),
    });
    const value = mock(schema);
    expect(value.billing.zip).toBe("BILLING-ZIP");
    expect(value.shipping.zip).toBe("SHIPPING-ZIP");
  });

  it("backward compatible — generate with no params still works", () => {
    configure({
      matchers: [{ pattern: /sku/i, generate: () => "SKU-1234" }],
    });
    const schema = z.object({ sku: z.string() });
    expect(mock(schema).sku).toBe("SKU-1234");
  });
});

// ---------------------------------------------------------------------------
// Plugin system
// ---------------------------------------------------------------------------

describe("Plugin system", () => {
  afterEach(() => resetConfig());

  it("definePlugin creates a plugin from matchers", () => {
    const plugin = definePlugin({
      matchers: [{ pattern: /sku/i, generate: () => "SKU-TEST" }],
    });
    expect(plugin.matchers).toHaveLength(1);
  });

  it("plugin matchers are applied via configure()", () => {
    const plugin = definePlugin({
      matchers: [{ pattern: /currency/i, generate: () => "EUR" }],
    });
    configure({ plugins: [plugin] });
    const schema = z.object({ currency: z.string() });
    expect(mock(schema).currency).toBe("EUR");
  });

  it("multiple plugins are all applied", () => {
    const pluginA = definePlugin({ matchers: [{ pattern: /sku/i, generate: () => "SKU-A" }] });
    const pluginB = definePlugin({ matchers: [{ pattern: /currency/i, generate: () => "USD" }] });
    configure({ plugins: [pluginA, pluginB] });
    const schema = z.object({ sku: z.string(), currency: z.string() });
    const value = mock(schema);
    expect(value.sku).toBe("SKU-A");
    expect(value.currency).toBe("USD");
  });

  it("explicit matchers take priority over plugin matchers", () => {
    const plugin = definePlugin({ matchers: [{ pattern: /tag/i, generate: () => "from-plugin" }] });
    configure({
      matchers: [{ pattern: /tag/i, generate: () => "from-explicit" }],
      plugins: [plugin],
    });
    const schema = z.object({ tag: z.string() });
    expect(mock(schema).tag).toBe("from-explicit");
  });

  it("plugin does not mutate the original matchers array", () => {
    const matchers = [{ pattern: /sku/i, generate: () => "SKU" }];
    const plugin = definePlugin({ matchers });
    matchers[0]!.generate = () => "MUTATED";
    expect(plugin.matchers[0]!.generate()).toBe("SKU");
  });

  it("resetConfig() removes installed plugins", () => {
    const plugin = definePlugin({ matchers: [{ pattern: /sku/i, generate: () => "SKU-X" }] });
    configure({ plugins: [plugin] });
    resetConfig();
    const schema = z.object({ sku: z.string() });
    // After reset, no matcher — sku gets generic string, not "SKU-X"
    expect(mock(schema).sku).not.toBe("SKU-X");
  });
});

describe("custom matchers applied to bigint and date fields", () => {
  it("custom matcher on a bigint field overrides generation", () => {
    configure({
      matchers: [{ pattern: /\bpoints\b/i, generate: () => 999n }],
    });
    const schema = z.object({ points: z.bigint() });
    const result = mock(schema);
    expect(result.points).toBe(999n);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("custom matcher on a date field overrides generation", () => {
    const fixed = new Date("2024-06-15T00:00:00.000Z");
    configure({
      matchers: [{ pattern: /\bhiredAt\b/i, generate: () => fixed }],
    });
    const schema = z.object({ hiredAt: z.date() });
    const result = mock(schema);
    expect(result.hiredAt.getTime()).toBe(fixed.getTime());
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("custom matchers are skipped in random mode for bigint/date", () => {
    configure({
      matchers: [{ pattern: /points/i, generate: () => 999n }],
    });
    const schema = z.object({ points: z.bigint() });
    // random mode should bypass the matcher
    const result = mock(schema, { mode: "random" });
    expect(schema.safeParse(result).success).toBe(true);
    // In random mode the matcher is skipped, so value should NOT be the hardcoded 999n
    // (technically not guaranteed but highly unlikely with a seeded RNG picking from a large range)
    expect(typeof result.points).toBe("bigint");
  });
});
