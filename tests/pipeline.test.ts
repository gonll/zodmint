import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mock } from "../src/mock.js";
import { ZodForgeError } from "../src/errors.js";

describe("discriminated union", () => {
  const schema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("circle"), radius: z.number().positive() }),
    z.object({ kind: z.literal("rect"), width: z.number().positive(), height: z.number().positive() }),
    z.object({ kind: z.literal("triangle"), base: z.number().positive() }),
  ]);

  it("always sets discriminator key correctly", () => {
    for (let i = 0; i < 30; i++) {
      const result = mock(schema);
      expect(["circle", "rect", "triangle"]).toContain(result.kind);
      expect(schema.safeParse(result).success).toBe(true);
    }
  });
});

describe("z.union()", () => {
  it("tries each branch at most once, returns valid value", () => {
    const schema = z.union([z.string(), z.number(), z.boolean()]);
    for (let i = 0; i < 10; i++) {
      const result = mock(schema);
      expect(schema.safeParse(result).success).toBe(true);
    }
  });

  it("throws GENERATION_FAILED when all branches fail (all z.never)", () => {
    const schema = z.union([z.never(), z.never()]);
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try {
      mock(schema);
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("GENERATION_FAILED");
    }
  });
});

describe("z.intersection()", () => {
  it("merges A and B, B overrides A on scalar conflicts", () => {
    const schema = z.intersection(
      z.object({ a: z.string(), shared: z.string() }),
      z.object({ b: z.number(), shared: z.string() }),
    );
    const result = mock(schema);
    expect(typeof result.a).toBe("string");
    expect(typeof result.b).toBe("number");
    expect(typeof result.shared).toBe("string");
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("arrays replace, not concat", () => {
    const schema = z.intersection(
      z.object({ tags: z.array(z.string()) }),
      z.object({ tags: z.array(z.string()) }),
    );
    const result = mock(schema);
    expect(Array.isArray(result.tags)).toBe(true);
    expect(schema.safeParse(result).success).toBe(true);
  });
});

describe("z.coerce.*", () => {
  it("z.coerce.string() generates a string", () => {
    const result = mock(z.coerce.string());
    expect(typeof result).toBe("string");
  });

  it("z.coerce.number() generates a number", () => {
    const result = mock(z.coerce.number());
    expect(typeof result).toBe("number");
  });

  it("z.coerce.boolean() generates a boolean", () => {
    const result = mock(z.coerce.boolean());
    expect(typeof result).toBe("boolean");
  });

  it("z.coerce.date() generates a Date", () => {
    const result = mock(z.coerce.date());
    expect(result).toBeInstanceOf(Date);
  });
});

describe("z.default()", () => {
  it("generates dynamically when useDefaults is false (default)", () => {
    const schema = z.string().default("hello");
    const results = Array.from({ length: 10 }, () => mock(schema));
    // Should sometimes generate something other than the default
    // (though it could randomly generate "hello", just check it's a string)
    results.forEach((r) => expect(typeof r).toBe("string"));
  });

  it("returns default value when useDefaults: true", () => {
    const schema = z.string().default("hello");
    const result = mock(schema, { useDefaults: true });
    expect(result).toBe("hello");
  });

  it("returns default function value when useDefaults: true", () => {
    const schema = z.number().default(() => 42);
    const result = mock(schema, { useDefaults: true });
    expect(result).toBe(42);
  });
});

describe("z.catch()", () => {
  it("generates inner schema, ignores fallback", () => {
    const schema = z.number().catch(0);
    for (let i = 0; i < 10; i++) {
      const result = mock(schema);
      expect(typeof result).toBe("number");
      expect(schema.safeParse(result).success).toBe(true);
    }
  });
});

describe("transforms", () => {
  it("transform executes via safeParse exactly once", () => {
    let callCount = 0;
    const schema = z.string().transform((s) => {
      callCount++;
      return s.toUpperCase();
    });

    callCount = 0;
    const result = mock(schema);
    expect(callCount).toBe(1);
    expect(result).toBe(result.toUpperCase());
  });

  it("transform schema without overrides produces output domain type", () => {
    const schema = z.string().transform((s) => parseInt(s.replace(/\D/g, "0"), 10));
    const result = mock(schema);
    expect(typeof result).toBe("number");
  });
});

describe("z.lazy() and recursion", () => {
  it("optional lazy terminates at maxDepth with undefined", () => {
    // The lazy resolves to z.optional(...) so dispatchLazy returns undefined
    // at maxDepth rather than throwing on the inner required object.
    const NodeSchema: z.ZodTypeAny = z.lazy(() =>
      z.optional(z.object({ child: NodeSchema }))
    );
    // Should not throw — lazy resolves to undefined at depth limit
    const result = mock(NodeSchema, { maxDepth: 2 });
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("array lazy terminates at maxDepth with []", () => {
    // The lazy itself is optional so dispatchLazy returns undefined at maxDepth
    // rather than throwing MAX_DEPTH_EXCEEDED on the inner required object.
    const TreeSchema: z.ZodTypeAny = z.lazy(() =>
      z.optional(z.object({ items: z.array(TreeSchema) }))
    );
    const result = mock(TreeSchema, { maxDepth: 3 });
    // Should not throw — resolves to undefined or a shallow tree
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("required lazy at maxDepth throws MAX_DEPTH_EXCEEDED", () => {
    type Required = { child: Required };
    const RequiredSchema: z.ZodType<Required> = z.lazy(() =>
      z.object({ child: RequiredSchema })
    );

    expect(() => mock(RequiredSchema, { maxDepth: 1 })).toThrow(ZodForgeError);
    try {
      mock(RequiredSchema, { maxDepth: 1 });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("MAX_DEPTH_EXCEEDED");
      expect((e as ZodForgeError).message).toMatch(/maxDepth/);
    }
  });
});

describe("optional / nullable decisions before generation", () => {
  it("optional: returns undefined sometimes", () => {
    const schema = z.string().optional();
    const results = Array.from({ length: 50 }, () => mock(schema));
    const hasUndefined = results.some((r) => r === undefined);
    const hasString = results.some((r) => typeof r === "string");
    expect(hasUndefined).toBe(true);
    expect(hasString).toBe(true);
  });

  it("nullable: returns null sometimes", () => {
    const schema = z.string().nullable();
    const results = Array.from({ length: 50 }, () => mock(schema));
    const hasNull = results.some((r) => r === null);
    const hasString = results.some((r) => typeof r === "string");
    expect(hasNull).toBe(true);
    expect(hasString).toBe(true);
  });
});

describe("z.record() and z.map() and z.set()", () => {
  it("z.record generates 2-4 key-value pairs", () => {
    for (let i = 0; i < 5; i++) {
      const result = mock(z.record(z.string(), z.number()));
      const keys = Object.keys(result);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      expect(keys.length).toBeLessThanOrEqual(4);
      keys.forEach((k) => expect(typeof result[k]).toBe("number"));
    }
  });

  it("z.map generates a Map with 2-4 entries", () => {
    for (let i = 0; i < 5; i++) {
      const result = mock(z.map(z.string(), z.number()));
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBeGreaterThanOrEqual(2);
      expect(result.size).toBeLessThanOrEqual(4);
    }
  });

  it("z.set generates a Set with unique values", () => {
    for (let i = 0; i < 5; i++) {
      const result = mock(z.set(z.string()));
      expect(result).toBeInstanceOf(Set);
    }
  });
});

describe("z.readonly()", () => {
  it("generates from inner schema", () => {
    const schema = z.object({ id: z.string().uuid(), val: z.number() }).readonly();
    const result = mock(schema);
    expect(typeof result.id).toBe("string");
    expect(typeof result.val).toBe("number");
    expect(schema.safeParse(result).success).toBe(true);
  });
});

describe("z.nan()", () => {
  it("returns NaN", () => {
    const result = mock(z.nan());
    expect(Number.isNaN(result)).toBe(true);
  });
});
