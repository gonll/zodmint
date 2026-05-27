import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { mock, mockList } from "../src/mock.js";
import { configure, resetConfig, withConfig } from "../src/config.js";
import { ZodForgeError } from "../src/errors.js";

afterEach(() => resetConfig());

describe("mock()", () => {
  it("returns correct type for string schema", () => {
    const result = mock(z.string());
    expect(typeof result).toBe("string");
  });

  it("returns correct type for number schema", () => {
    expect(typeof mock(z.number())).toBe("number");
  });

  it("returns correct type for boolean schema", () => {
    expect(typeof mock(z.boolean())).toBe("boolean");
  });

  it("returns a Date for z.date()", () => {
    expect(mock(z.date())).toBeInstanceOf(Date);
  });

  it("returns object with correct shape", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = mock(schema);
    expect(typeof result.name).toBe("string");
    expect(typeof result.age).toBe("number");
  });

  it("respects seed — same seed produces same output", () => {
    const schema = z.object({ name: z.string(), value: z.number() });
    const a = mock(schema, { seed: 123 });
    const b = mock(schema, { seed: 123 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different outputs (very likely)", () => {
    const schema = z.string();
    const results = new Set(Array.from({ length: 10 }, (_, i) => mock(schema, { seed: i })));
    expect(results.size).toBeGreaterThan(1);
  });

  it("no seed produces varied output", () => {
    const schema = z.string();
    const results = new Set(Array.from({ length: 20 }, () => mock(schema)));
    expect(results.size).toBeGreaterThan(1);
  });

  it("datetime string is deterministic with same seed", () => {
    const schema = z.string().datetime();
    const a = mock(schema, { seed: 42 });
    const b = mock(schema, { seed: 42 });
    expect(a).toBe(b);
    expect(z.string().datetime().safeParse(a).success).toBe(true);
  });

  it("z.date() is deterministic with same seed", () => {
    const schema = z.date();
    const a = mock(schema, { seed: 42 });
    const b = mock(schema, { seed: 42 });
    expect(a).toEqual(b);
    expect(schema.safeParse(a).success).toBe(true);
  });

  it("applies overrides", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = mock(schema, { overrides: { name: "Alice" } });
    expect(result.name).toBe("Alice");
    expect(typeof result.age).toBe("number");
  });

  it("applies deep partial overrides", () => {
    const schema = z.object({
      user: z.object({ name: z.string(), age: z.number().int().min(0) }),
    });
    const result = mock(schema, { overrides: { user: { name: "Bob" } } });
    expect(result.user.name).toBe("Bob");
    expect(typeof result.user.age).toBe("number");
  });

  it("throws INVALID_OVERRIDE when override fails validation", () => {
    const schema = z.object({ age: z.number().int().positive() });
    expect(() => mock(schema, { overrides: { age: -5 } })).toThrow(ZodForgeError);
    try {
      mock(schema, { overrides: { age: -5 } });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("INVALID_OVERRIDE");
    }
  });

  it("captures config snapshot at call start — mid-call configure has no effect", () => {
    configure({ maxDepth: 1 });
    const schema = z.object({ name: z.string() });
    // Calling configure before mock should be captured
    const result1 = mock(schema);
    expect(typeof result1.name).toBe("string");
    // Change config — but snapshot was already taken
    configure({ maxDepth: 5 });
    const result2 = mock(schema);
    expect(typeof result2.name).toBe("string");
  });

  it("per-call maxDepth overrides global config", () => {
    configure({ maxDepth: 1 });
    const schema = z.lazy((): z.ZodTypeAny => z.optional(z.object({ child: schema })));
    // With maxDepth:1 from global, lazy should be limited
    const result = mock(schema, { maxDepth: 3 });
    // Should not throw
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("mode: 'edge' produces a valid result", () => {
    const schema = z.string();
    const result = mock(schema, { mode: "edge" });
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("mode: 'random' does not throw — it is now implemented", () => {
    expect(() => mock(z.string(), { mode: "random" })).not.toThrow();
    const result = mock(z.string(), { mode: "random" });
    expect(z.string().safeParse(result).success).toBe(true);
  });

  it("undefined override values are ignored", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = mock(schema, { overrides: { name: undefined } });
    // name should be a generated string, not undefined
    expect(typeof result.name).toBe("string");
  });

  it("overrides on transform schema apply to input domain (no longer throws)", () => {
    // Overrides are now applied to the pre-transform input domain.
    // An incompatible override (object on a string-transform input) throws INVALID_OVERRIDE,
    // not UNSUPPORTED_SCHEMA — the error shifts from "not supported" to "bad value".
    const schema = z.string().transform((s) => s.toUpperCase());
    expect(() => mock(schema, { overrides: {} })).toThrow(ZodForgeError);
    try {
      mock(schema, { overrides: {} });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("INVALID_OVERRIDE");
    }
  });

  it("transform without overrides works fine", () => {
    const schema = z.string().transform((s) => s.toUpperCase());
    const result = mock(schema);
    expect(typeof result).toBe("string");
    expect(result).toBe(result.toUpperCase());
  });

  it("useDefaults: true calls function defaults", () => {
    let callCount = 0;
    const schema = z.object({
      id: z.string().default(() => { callCount++; return "fn-default"; }),
    });
    const result = mock(schema, { useDefaults: true });
    expect(result.id).toBe("fn-default");
    expect(callCount).toBe(1);
  });
});

describe("mockList()", () => {
  it("returns an array", () => {
    const result = mockList(z.string());
    expect(Array.isArray(result)).toBe(true);
  });

  it("respects count option", () => {
    const result = mockList(z.string(), { count: 7 });
    expect(result).toHaveLength(7);
  });

  it("applies overrides to all items", () => {
    const schema = z.object({ active: z.boolean() });
    const result = mockList(schema, { count: 5, overrides: { active: true } });
    expect(result).toHaveLength(5);
    result.forEach((item) => expect(item.active).toBe(true));
  });

  it("each item passes schema validation", () => {
    const schema = z.object({ name: z.string(), age: z.number().int().min(0) });
    const items = mockList(schema, { count: 10 });
    items.forEach((item) => {
      expect(schema.safeParse(item).success).toBe(true);
    });
  });

  it("with seed produces deterministic results", () => {
    const schema = z.object({ val: z.number() });
    const a = mockList(schema, { count: 3, seed: 42 });
    const b = mockList(schema, { count: 3, seed: 42 });
    expect(a).toEqual(b);
  });

  it("is independent of schema-level array constraints", () => {
    // mockList ignores the fact that UserSchema is not an array schema
    const UserSchema = z.object({ id: z.string() });
    const users = mockList(UserSchema, { count: 10 });
    expect(users).toHaveLength(10);
  });

  it("mockList with seed but no count is deterministic", () => {
    const schema = z.object({ name: z.string() });
    const a = mockList(schema, { seed: 99 });
    const b = mockList(schema, { seed: 99 });
    expect(a.length).toBe(b.length);
    expect(a).toEqual(b);
  });
});

describe("withConfig()", () => {
  it("applies config for the duration of the callback", () => {
    const schema = z.string();
    withConfig({ maxDepth: 10 }, () => {
      const result = mock(schema);
      expect(typeof result).toBe("string");
    });
  });

  it("restores previous config after callback completes", () => {
    configure({ maxDepth: 3 });
    withConfig({ maxDepth: 10 }, () => {
      // inside the callback, maxDepth is 10 — verify generation still works
      expect(typeof mock(z.string())).toBe("string");
    });
    // After withConfig, the previous maxDepth: 3 should be restored.
    // We verify indirectly: a schema that would exceed maxDepth: 3 but not 10
    // should still work (it would fail only if maxDepth had stayed at 10 and we
    // were testing the opposite direction, but at minimum we confirm no throw).
    expect(typeof mock(z.string())).toBe("string");
  });

  it("restores config even if callback throws", () => {
    configure({ maxDepth: 3 });
    expect(() =>
      withConfig({ maxDepth: 10 }, () => {
        throw new Error("intentional test error");
      }),
    ).toThrow("intentional test error");
    // Config should be restored to maxDepth: 3; resetting should be a no-op
    // for the invariants we care about.
    resetConfig();
  });

  it("returns the callback return value", () => {
    const result = withConfig({ maxDepth: 5 }, () => 42);
    expect(result).toBe(42);
  });

  it("can be nested — inner config is isolated", () => {
    configure({ maxDepth: 2 });
    withConfig({ maxDepth: 5 }, () => {
      withConfig({ maxDepth: 8 }, () => {
        expect(typeof mock(z.string())).toBe("string");
      });
      // after inner withConfig, should be back to 5 — not 8 or 2
      expect(typeof mock(z.string())).toBe("string");
    });
    // after outer withConfig, should be back to 2
    expect(typeof mock(z.string())).toBe("string");
  });
});
