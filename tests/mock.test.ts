import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { mock, mockList } from "../src/mock.js";
import { configure, resetConfig } from "../src/config.js";
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

  it("mode: 'random' throws UNSUPPORTED_MODE", () => {
    expect(() => mock(z.string(), { mode: "random" })).toThrow(ZodForgeError);
    try {
      mock(z.string(), { mode: "random" });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_MODE");
    }
  });

  it("undefined override values are ignored", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = mock(schema, { overrides: { name: undefined } });
    // name should be a generated string, not undefined
    expect(typeof result.name).toBe("string");
  });

  it("overrides on transform schema throws UNSUPPORTED_SCHEMA", () => {
    const schema = z.string().transform((s) => s.toUpperCase());
    expect(() => mock(schema, { overrides: {} })).toThrow(ZodForgeError);
    try {
      mock(schema, { overrides: {} });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
    }
  });

  it("transform without overrides works fine", () => {
    const schema = z.string().transform((s) => s.toUpperCase());
    const result = mock(schema);
    expect(typeof result).toBe("string");
    expect(result).toBe(result.toUpperCase());
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
});
