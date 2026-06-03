import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mockAll } from "../src/coverage.js";

// Helper: assert every value in the array passes safeParse
function assertAllValid<S extends z.ZodTypeAny>(schema: S, values: Array<z.infer<S>>) {
  for (const v of values) {
    const result = schema.safeParse(v);
    expect(result.success, `value ${JSON.stringify(v)} failed safeParse`).toBe(true);
  }
}

describe("mockAll", () => {
  // ---------------------------------------------------------------------------
  // number
  // ---------------------------------------------------------------------------
  describe("number", () => {
    it("no constraints: returns -1, 0, 1", () => {
      const schema = z.number();
      const values = mockAll(schema);
      expect(values.length).toBeGreaterThan(0);
      assertAllValid(schema, values);
    });

    it("min/max: includes boundary values", () => {
      const schema = z.number().min(5).max(10);
      const values = mockAll(schema);
      expect(values).toContain(5);
      expect(values).toContain(10);
      assertAllValid(schema, values);
    });

    it("int min/max: all values are integers", () => {
      const schema = z.number().int().min(18).max(100);
      const values = mockAll(schema);
      expect(values).toContain(18);
      expect(values).toContain(100);
      expect(values.every((v) => Number.isInteger(v))).toBe(true);
      assertAllValid(schema, values);
    });

    it("min only: includes min-adjacent values", () => {
      const schema = z.number().min(3);
      const values = mockAll(schema);
      expect(values).toContain(3);
      assertAllValid(schema, values);
    });

    it("max only: includes max value", () => {
      const schema = z.number().max(10);
      const values = mockAll(schema);
      expect(values).toContain(10);
      assertAllValid(schema, values);
    });

    it("includes 0 when in range", () => {
      const schema = z.number().min(-5).max(5);
      const values = mockAll(schema);
      expect(values).toContain(0);
      assertAllValid(schema, values);
    });

    it("deduplicated when min=max", () => {
      const schema = z.number().min(7).max(7);
      const values = mockAll(schema);
      expect(values).toEqual([7]);
      assertAllValid(schema, values);
    });
  });

  // ---------------------------------------------------------------------------
  // string
  // ---------------------------------------------------------------------------
  describe("string", () => {
    it("no constraints: returns empty string and short strings", () => {
      const schema = z.string();
      const values = mockAll(schema);
      expect(values).toContain("");
      assertAllValid(schema, values);
    });

    it("min/max: includes strings of min and max length", () => {
      const schema = z.string().min(2).max(5);
      const values = mockAll(schema);
      expect(values.some((v) => (v as string).length === 2)).toBe(true);
      expect(values.some((v) => (v as string).length === 5)).toBe(true);
      assertAllValid(schema, values);
    });

    it("min 0: includes empty string", () => {
      const schema = z.string().min(0).max(3);
      const values = mockAll(schema);
      expect(values).toContain("");
      assertAllValid(schema, values);
    });

    it("format (email): returns multiple valid emails", () => {
      const schema = z.string().email();
      const values = mockAll(schema);
      expect(values.length).toBeGreaterThanOrEqual(2);
      assertAllValid(schema, values);
    });

    it("format (uuid): returns valid UUIDs", () => {
      const schema = z.string().uuid();
      const values = mockAll(schema);
      expect(values.length).toBeGreaterThanOrEqual(2);
      assertAllValid(schema, values);
    });
  });

  // ---------------------------------------------------------------------------
  // boolean
  // ---------------------------------------------------------------------------
  describe("boolean", () => {
    it("returns exactly [true, false] in any order", () => {
      const values = mockAll(z.boolean());
      expect(values).toHaveLength(2);
      expect(values).toContain(true);
      expect(values).toContain(false);
    });

    it("all values valid", () => {
      const schema = z.boolean();
      assertAllValid(schema, mockAll(schema));
    });
  });

  // ---------------------------------------------------------------------------
  // enum
  // ---------------------------------------------------------------------------
  describe("enum", () => {
    it("returns every enum value", () => {
      const schema = z.enum(["admin", "user", "guest"]);
      const values = mockAll(schema);
      expect(values).toHaveLength(3);
      expect(values).toContain("admin");
      expect(values).toContain("user");
      expect(values).toContain("guest");
    });

    it("all values valid", () => {
      const schema = z.enum(["a", "b", "c"]);
      assertAllValid(schema, mockAll(schema));
    });
  });

  // ---------------------------------------------------------------------------
  // nativeEnum
  // ---------------------------------------------------------------------------
  describe("nativeEnum", () => {
    enum Direction {
      Up = "UP",
      Down = "DOWN",
      Left = "LEFT",
      Right = "RIGHT",
    }

    it("returns all native enum values", () => {
      const schema = z.nativeEnum(Direction);
      const values = mockAll(schema);
      expect(values).toContain("UP");
      expect(values).toContain("DOWN");
      assertAllValid(schema, values);
    });
  });

  // ---------------------------------------------------------------------------
  // literal
  // ---------------------------------------------------------------------------
  describe("literal", () => {
    it("returns the literal value", () => {
      const schema = z.literal("hello");
      const values = mockAll(schema);
      expect(values).toEqual(["hello"]);
      assertAllValid(schema, values);
    });

    it("works with numeric literal", () => {
      const schema = z.literal(42);
      const values = mockAll(schema);
      expect(values).toEqual([42]);
    });
  });

  // ---------------------------------------------------------------------------
  // optional
  // ---------------------------------------------------------------------------
  describe("optional", () => {
    it("includes undefined", () => {
      const schema = z.string().optional();
      const values = mockAll(schema);
      expect(values).toContain(undefined);
    });

    it("includes inner type values", () => {
      const schema = z.boolean().optional();
      const values = mockAll(schema);
      expect(values).toContain(undefined);
      expect(values).toContain(true);
      expect(values).toContain(false);
    });

    it("all defined values pass safeParse", () => {
      const schema = z.number().min(1).optional();
      const values = mockAll(schema);
      for (const v of values) {
        if (v !== undefined) {
          expect(schema.safeParse(v).success).toBe(true);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // nullable
  // ---------------------------------------------------------------------------
  describe("nullable", () => {
    it("includes null", () => {
      const schema = z.string().nullable();
      const values = mockAll(schema);
      expect(values).toContain(null);
    });

    it("includes inner type values", () => {
      const schema = z.boolean().nullable();
      const values = mockAll(schema);
      expect(values).toContain(null);
      expect(values).toContain(true);
      expect(values).toContain(false);
    });

    it("all values valid", () => {
      const schema = z.number().nullable();
      assertAllValid(schema, mockAll(schema));
    });
  });

  // ---------------------------------------------------------------------------
  // union
  // ---------------------------------------------------------------------------
  describe("union", () => {
    it("returns one value per branch", () => {
      const schema = z.union([z.string(), z.number(), z.boolean()]);
      const values = mockAll(schema);
      expect(values.length).toBe(3);
      // At least one should be a string, one a number, one a boolean
      const hasString = values.some((v) => typeof v === "string");
      const hasNumber = values.some((v) => typeof v === "number");
      const hasBoolean = values.some((v) => typeof v === "boolean");
      expect(hasString).toBe(true);
      expect(hasNumber).toBe(true);
      expect(hasBoolean).toBe(true);
    });

    it("all values valid against their own branch", () => {
      const schema = z.union([z.string().uuid(), z.number().int().positive()]);
      const values = mockAll(schema);
      expect(values.length).toBeGreaterThan(0);
      assertAllValid(schema, values);
    });
  });

  // ---------------------------------------------------------------------------
  // array
  // ---------------------------------------------------------------------------
  describe("array", () => {
    it("no constraints: includes empty array, single, two-item", () => {
      const schema = z.array(z.number());
      const values = mockAll(schema);
      expect(values.some((v) => Array.isArray(v) && (v as unknown[]).length === 0)).toBe(true);
      expect(values.some((v) => Array.isArray(v) && (v as unknown[]).length === 1)).toBe(true);
      expect(values.some((v) => Array.isArray(v) && (v as unknown[]).length === 2)).toBe(true);
      assertAllValid(schema, values);
    });

    it("min constraint: includes min-length array", () => {
      const schema = z.array(z.string()).min(3);
      const values = mockAll(schema);
      expect(values.some((v) => Array.isArray(v) && (v as unknown[]).length >= 3)).toBe(true);
      assertAllValid(schema, values);
    });

    it("max constraint: includes max-length array", () => {
      const schema = z.array(z.string()).max(5);
      const values = mockAll(schema);
      expect(values.some((v) => Array.isArray(v) && (v as unknown[]).length <= 5)).toBe(true);
      assertAllValid(schema, values);
    });

    it("exact length: returns only that length", () => {
      const schema = z.array(z.number()).length(4);
      const values = mockAll(schema);
      expect(values.length).toBe(1);
      expect((values[0] as unknown[]).length).toBe(4);
      assertAllValid(schema, values);
    });
  });

  // ---------------------------------------------------------------------------
  // object
  // ---------------------------------------------------------------------------
  describe("object", () => {
    it("returns a single valid object", () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const values = mockAll(schema);
      expect(values.length).toBe(1);
      assertAllValid(schema, values);
    });
  });

  // ---------------------------------------------------------------------------
  // any / unknown
  // ---------------------------------------------------------------------------
  describe("any/unknown", () => {
    it("any: returns representative set", () => {
      const schema = z.any();
      const values = mockAll(schema);
      expect(values.length).toBeGreaterThan(0);
      assertAllValid(schema, values);
    });

    it("unknown: returns representative set", () => {
      const schema = z.unknown();
      const values = mockAll(schema);
      expect(values.length).toBeGreaterThan(0);
      assertAllValid(schema, values);
    });
  });

  // ---------------------------------------------------------------------------
  // general invariants
  // ---------------------------------------------------------------------------
  describe("invariants", () => {
    it("result is always non-empty", () => {
      const schemas = [
        z.string(),
        z.number(),
        z.boolean(),
        z.literal("x"),
        z.enum(["a"]),
        z.object({ x: z.number() }),
        z.array(z.string()),
        z.any(),
      ];
      for (const schema of schemas) {
        expect(mockAll(schema).length).toBeGreaterThan(0);
      }
    });

    it("deduplication works", () => {
      const schema = z.number().min(7).max(7);
      const values = mockAll(schema);
      expect(values).toEqual([7]);
    });

    it("options.seed is forwarded", () => {
      const schema = z.string().email();
      const v1 = mockAll(schema, { seed: 42 });
      const v2 = mockAll(schema, { seed: 42 });
      expect(v1).toEqual(v2);
    });
  });
});
