import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mock } from "../src/mock.js";
import { ZodForgeError } from "../src/errors.js";

describe("string constraints", () => {
  it("min length respected", () => {
    for (let i = 0; i < 20; i++) {
      const s = mock(z.string().min(10));
      expect(s.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("max length respected", () => {
    for (let i = 0; i < 20; i++) {
      const s = mock(z.string().max(5));
      expect(s.length).toBeLessThanOrEqual(5);
    }
  });

  it("min + max respected", () => {
    for (let i = 0; i < 20; i++) {
      const s = mock(z.string().min(4).max(7));
      expect(s.length).toBeGreaterThanOrEqual(4);
      expect(s.length).toBeLessThanOrEqual(7);
    }
  });

  it("exact length respected", () => {
    for (let i = 0; i < 10; i++) {
      const s = mock(z.string().length(6));
      expect(s.length).toBe(6);
    }
  });

  it("email() generates valid email", () => {
    for (let i = 0; i < 10; i++) {
      const s = mock(z.string().email());
      expect(z.string().email().safeParse(s).success).toBe(true);
    }
  });

  it("url() generates valid URL", () => {
    for (let i = 0; i < 10; i++) {
      const s = mock(z.string().url());
      expect(z.string().url().safeParse(s).success).toBe(true);
    }
  });

  it("uuid() generates valid UUID", () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (let i = 0; i < 10; i++) {
      const s = mock(z.string().uuid());
      expect(s).toMatch(uuidRe);
    }
  });

  it("startsWith() respected", () => {
    for (let i = 0; i < 10; i++) {
      const s = mock(z.string().startsWith("PREFIX_"));
      expect(s.startsWith("PREFIX_")).toBe(true);
    }
  });

  it("endsWith() respected", () => {
    for (let i = 0; i < 10; i++) {
      const s = mock(z.string().endsWith("_SUFFIX"));
      expect(s.endsWith("_SUFFIX")).toBe(true);
    }
  });

  it("simple regex: [A-Z]{3}", () => {
    const schema = z.string().regex(/^[A-Z]{3}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(schema.safeParse(s).success).toBe(true);
    }
  });

  it("simple regex alternation: (foo|bar|baz)", () => {
    const schema = z.string().regex(/^(foo|bar|baz)$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(["foo", "bar", "baz"]).toContain(s);
    }
  });

  it("unsatisfiable min > max throws an error", () => {
    // v3: zodmint throws GENERATION_FAILED; v4: Zod itself throws SyntaxError during schema creation
    expect(() => mock(z.string().min(10).max(5))).toThrow();
  });

  it("email + max(5) throws GENERATION_FAILED", () => {
    expect(() => mock(z.string().email().max(5))).toThrow(ZodForgeError);
    try {
      mock(z.string().email().max(5));
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("GENERATION_FAILED");
    }
  });

  it("lookahead throws REGEX_UNSUPPORTED", () => {
    // Lookaheads are genuinely unsupported
    expect(() => mock(z.string().regex(/^\d+(?=px$)/))).toThrow(ZodForgeError);
    try {
      mock(z.string().regex(/^\d+(?=px$)/));
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("REGEX_UNSUPPORTED");
    }
  });

  it("\\d shorthand: postal code /^\\d{5}$/", () => {
    const schema = z.string().regex(/^\d{5}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(schema.safeParse(s).success).toBe(true);
      expect(s).toMatch(/^\d{5}$/);
    }
  });

  it("\\w shorthand: /^\\w{8}$/", () => {
    const schema = z.string().regex(/^\w{8}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(s).toMatch(/^\w{8}$/);
    }
  });

  it("range quantifier {n,m}: /^[A-Z]{2,4}$/", () => {
    const schema = z.string().regex(/^[A-Z]{2,4}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(schema.safeParse(s).success).toBe(true);
    }
  });

  it("dot: /^.{4}$/ generates 4 chars", () => {
    const schema = z.string().regex(/^.{4}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(s.length).toBe(4);
    }
  });

  it("negated class: /^[^aeiou]{5}$/", () => {
    const schema = z.string().regex(/^[^aeiou]{5}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(schema.safeParse(s).success).toBe(true);
    }
  });

  it("non-capturing group (?:...): /^(?:foo|bar){2}$/", () => {
    const schema = z.string().regex(/^(?:foo|bar){2}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(schema.safeParse(s).success).toBe(true);
    }
  });

  it("top-level alternation: /^cat$|^dog$|^fish$/", () => {
    const schema = z.string().regex(/^cat$|^dog$|^fish$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(["cat", "dog", "fish"]).toContain(s);
    }
  });

  it("phone-like: /^\\d{3}-\\d{4}$/", () => {
    const schema = z.string().regex(/^\d{3}-\d{4}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(schema.safeParse(s).success).toBe(true);
    }
  });

  it("price-like: /^\\d+\\.\\d{2}$/", () => {
    const schema = z.string().regex(/^\d+\.\d{2}$/);
    for (let i = 0; i < 10; i++) {
      const s = mock(schema, { seed: i });
      expect(schema.safeParse(s).success).toBe(true);
    }
  });

  it("regex + min conflict throws GENERATION_FAILED", () => {
    // regex /^X/ generates a very short string; min(100) can never be satisfied
    const schema = z.string().regex(/^X/).min(100);
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try {
      mock(schema);
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("GENERATION_FAILED");
      expect((e as ZodForgeError).message).toContain("regex");
      expect((e as ZodForgeError).message).toContain("min(100)");
    }
  });

  it("regex + max conflict throws GENERATION_FAILED", () => {
    // regex /^[A-Z]{20}$/ generates a 20-char string; max(5) can never be satisfied
    const schema = z.string().regex(/^[A-Z]{20}$/).max(5);
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try {
      mock(schema);
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("GENERATION_FAILED");
      expect((e as ZodForgeError).message).toContain("regex");
      expect((e as ZodForgeError).message).toContain("max(5)");
    }
  });

  it("regex + compatible min does NOT throw", () => {
    // /^[A-Z]{5}$/ always generates exactly 5 chars — min(5) is satisfiable
    const schema = z.string().regex(/^[A-Z]{5}$/).min(5);
    expect(() => mock(schema)).not.toThrow();
    const s = mock(schema);
    expect(schema.safeParse(s).success).toBe(true);
  });

  it("regex + compatible max does NOT throw", () => {
    // /^[A-Z]{3}$/ always generates exactly 3 chars — max(10) is satisfiable
    const schema = z.string().regex(/^[A-Z]{3}$/).max(10);
    expect(() => mock(schema)).not.toThrow();
    const s = mock(schema);
    expect(schema.safeParse(s).success).toBe(true);
  });

  it("edge mode: startsWith and endsWith both satisfied", () => {
    const schema = z.string().startsWith("foo").endsWith("bar");
    const result = mock(schema, { mode: "edge" });
    expect(result.startsWith("foo")).toBe(true);
    expect(result.endsWith("bar")).toBe(true);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("realistic mode: startsWith and endsWith both satisfied", () => {
    const schema = z.string().startsWith("hello").endsWith("world");
    for (let seed = 0; seed < 10; seed++) {
      const result = mock(schema, { seed });
      expect(result.startsWith("hello")).toBe(true);
      expect(result.endsWith("world")).toBe(true);
      expect(schema.safeParse(result).success).toBe(true);
    }
  });
});

describe("number constraints", () => {
  it("min respected", () => {
    for (let i = 0; i < 20; i++) {
      expect(mock(z.number().min(50))).toBeGreaterThanOrEqual(50);
    }
  });

  it("max respected", () => {
    for (let i = 0; i < 20; i++) {
      expect(mock(z.number().max(10))).toBeLessThanOrEqual(10);
    }
  });

  it("int() generates integers", () => {
    for (let i = 0; i < 20; i++) {
      expect(Number.isInteger(mock(z.number().int()))).toBe(true);
    }
  });

  it("positive() generates positive numbers", () => {
    for (let i = 0; i < 20; i++) {
      expect(mock(z.number().positive())).toBeGreaterThan(0);
    }
  });

  it("negative() generates negative numbers", () => {
    for (let i = 0; i < 20; i++) {
      expect(mock(z.number().negative())).toBeLessThan(0);
    }
  });

  it("multipleOf(7) generates multiples", () => {
    for (let i = 0; i < 20; i++) {
      const v = mock(z.number().int().multipleOf(7));
      expect(v % 7).toBe(0);
    }
  });

  it("positive().negative() throws GENERATION_FAILED", () => {
    expect(() => mock(z.number().positive().negative())).toThrow(ZodForgeError);
    try {
      mock(z.number().positive().negative());
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("GENERATION_FAILED");
    }
  });

  it("min(10).max(5) throws GENERATION_FAILED", () => {
    expect(() => mock(z.number().min(10).max(5))).toThrow(ZodForgeError);
    try {
      mock(z.number().min(10).max(5));
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("GENERATION_FAILED");
    }
  });

  it("z.number().positive() never generates 0 or negative", () => {
    const schema = z.number().positive();
    const results = Array.from({ length: 50 }, (_, i) => mock(schema, { seed: i }));
    results.forEach(r => {
      expect(r).toBeGreaterThan(0);
      expect(schema.safeParse(r).success).toBe(true);
    });
  });

  it("z.number().negative() never generates 0 or positive", () => {
    const schema = z.number().negative();
    const results = Array.from({ length: 50 }, (_, i) => mock(schema, { seed: i }));
    results.forEach(r => {
      expect(r).toBeLessThan(0);
      expect(schema.safeParse(r).success).toBe(true);
    });
  });

  it("z.number().nonnegative() can generate 0", () => {
    const schema = z.number().nonnegative();
    const results = Array.from({ length: 30 }, (_, i) => mock(schema, { seed: i }));
    results.forEach(r => {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(schema.safeParse(r).success).toBe(true);
    });
  });
});

describe("bigint constraints", () => {
  it("generates a bigint", () => {
    expect(typeof mock(z.bigint())).toBe("bigint");
  });

  it("min respected", () => {
    for (let i = 0; i < 10; i++) {
      expect(mock(z.bigint().min(100n))).toBeGreaterThanOrEqual(100n);
    }
  });

  it("max respected", () => {
    for (let i = 0; i < 10; i++) {
      expect(mock(z.bigint().max(10n))).toBeLessThanOrEqual(10n);
    }
  });

  it("multipleOf respected", () => {
    for (let i = 0; i < 10; i++) {
      const v = mock(z.bigint().min(0n).multipleOf(5n));
      expect(v % 5n).toBe(0n);
    }
  });
});

describe("date constraints", () => {
  it("generates a Date", () => {
    expect(mock(z.date())).toBeInstanceOf(Date);
  });

  it("min respected", () => {
    const min = new Date("2023-01-01");
    for (let i = 0; i < 10; i++) {
      const d = mock(z.date().min(min));
      expect(d.getTime()).toBeGreaterThanOrEqual(min.getTime());
    }
  });

  it("max respected", () => {
    const max = new Date("2023-12-31");
    for (let i = 0; i < 10; i++) {
      const d = mock(z.date().max(max));
      expect(d.getTime()).toBeLessThanOrEqual(max.getTime());
    }
  });
});

describe("array constraints", () => {
  it("min length respected", () => {
    for (let i = 0; i < 10; i++) {
      const arr = mock(z.array(z.string()).min(3));
      expect(arr.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("max length respected", () => {
    for (let i = 0; i < 10; i++) {
      const arr = mock(z.array(z.string()).max(2));
      expect(arr.length).toBeLessThanOrEqual(2);
    }
  });

  it("length() exact count", () => {
    for (let i = 0; i < 10; i++) {
      const arr = mock(z.array(z.number()).length(5));
      expect(arr).toHaveLength(5);
    }
  });
});
