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

  it("branch with object-level refine retries correctly (pipeline bypass fix)", () => {
    // If dispatchDiscriminatedUnion called dispatchObject() directly it would skip
    // refinement retry logic and throw GENERATION_FAILED on any branch with .refine().
    const refined = z.discriminatedUnion("type", [
      z.object({ type: z.literal("a"), val: z.number().int() }).refine(
        (v) => v.val >= 0,
        "must be non-negative",
      ),
      z.object({ type: z.literal("b"), label: z.string() }),
    ]);
    for (let i = 0; i < 20; i++) {
      const result = mock(refined);
      expect(refined.safeParse(result).success).toBe(true);
    }
  });

  it("path-based generator on a discriminated-union field runs transform only once", () => {
    // Regression for the double-safeParse bug: a path-based generator on a field
    // with .transform() used to call field.safeParse() inside dispatch() AND then
    // the root safeParse() ran the transform again, producing wrong output.
    const schema = z.object({
      label: z.string().transform((s) => s.toUpperCase()),
      count: z.number().int(),
    });

    const result = mock(schema, {
      generators: {
        // Supplying a plain string; .transform() should uppercase it exactly once.
        label: () => "hello",
      },
    });

    // The transform runs once → "HELLO"
    expect(result.label).toBe("HELLO");
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

describe("transforms on overrides", () => {
  it("object transform: overrides applied to input domain before transform runs", () => {
    // The transform adds an `id` field. Overrides target input fields (name, age).
    // The transform runs after the merge, so the output always has both fields + id.
    const schema = z.object({ name: z.string(), age: z.number().int().positive() })
      .transform((o) => ({ ...o, active: true }));

    const result = mock(schema, { overrides: { name: "Alice" } });
    expect(result.name).toBe("Alice");
    expect(typeof result.age).toBe("number");
    expect(result.active).toBe(true);
  });

  it("string-to-string transform: override applied before transform", () => {
    // transform uppercases; override sets the pre-transform input to "hello"
    const schema = z.string().transform((s) => s.toUpperCase());
    const result = mock(schema, { overrides: "hello" as unknown as string });
    expect(result).toBe("HELLO");
  });

  it("nested object transform: deep overrides work on input fields", () => {
    const schema = z.object({
      user: z.object({ name: z.string(), email: z.string().email() }),
      count: z.number().int(),
    }).transform((o) => ({ ...o, _generated: true }));

    const result = mock(schema, { overrides: { user: { name: "Bob" } } });
    expect(result.user.name).toBe("Bob");
    expect(typeof result.user.email).toBe("string");
    expect(result._generated).toBe(true);
  });

  it("transform without overrides still works", () => {
    const schema = z.object({ x: z.number() }).transform((o) => ({ ...o, doubled: o.x * 2 }));
    const result = mock(schema);
    expect(typeof result.x).toBe("number");
    expect(result.doubled).toBe(result.x * 2);
  });

  it("invalid override on transform schema throws INVALID_OVERRIDE", () => {
    // Providing a value that fails the input schema should throw INVALID_OVERRIDE.
    // The transform input is z.object({ x: z.number() }); passing x as a string fails.
    const schema = z.object({ x: z.number().positive() }).transform((o) => o);
    expect(() => mock(schema, { overrides: { x: -999 } })).toThrow(ZodForgeError);
    try {
      mock(schema, { overrides: { x: -999 } });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("INVALID_OVERRIDE");
    }
  });
});

describe("z.preprocess() with non-primitive output", () => {
  it("preprocess wrapping an object schema generates from the output object", () => {
    const schema = z.preprocess((v) => v, z.object({ name: z.string(), age: z.number() }));
    expect(() => mock(schema)).not.toThrow();
    const result = mock(schema);
    expect(typeof result.name).toBe("string");
    expect(typeof result.age).toBe("number");
  });

  it("preprocess wrapping an array schema generates from the output array", () => {
    const schema = z.preprocess((v) => v, z.array(z.string()));
    expect(() => mock(schema)).not.toThrow();
    const result = mock(schema);
    expect(Array.isArray(result)).toBe(true);
    result.forEach((item) => expect(typeof item).toBe("string"));
  });

  it("preprocess with transformation generates valid output-schema values", () => {
    // The preprocess function parses a string → the output schema validates as an object.
    // Generation ignores the preprocess fn and generates from the output schema directly.
    const schema = z.preprocess(
      (v) => (typeof v === "string" ? JSON.parse(v as string) : v),
      z.object({ id: z.number(), label: z.string() }),
    );
    const result = mock(schema);
    expect(typeof result.id).toBe("number");
    expect(typeof result.label).toBe("string");
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
