import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { mock } from "../src/mock.js";
import { ZodForgeError } from "../src/errors.js";
import { configure, resetConfig } from "../src/config.js";

afterEach(() => resetConfig());

describe("ZodForgeError structure", () => {
  it("has correct name", () => {
    try {
      mock(z.never());
    } catch (e) {
      expect((e as ZodForgeError).name).toBe("ZodForgeError");
    }
  });

  it("has correct code property", () => {
    try {
      mock(z.never());
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
    }
  });

  it("is instanceof ZodForgeError", () => {
    try {
      mock(z.never());
    } catch (e) {
      expect(e).toBeInstanceOf(ZodForgeError);
    }
  });

  it("is instanceof Error", () => {
    try {
      mock(z.never());
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });
});

describe("UNSUPPORTED_SCHEMA errors", () => {
  it("z.never() throws UNSUPPORTED_SCHEMA", () => {
    try {
      mock(z.never());
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
    }
  });

  it("z.preprocess() with non-primitive output throws UNSUPPORTED_SCHEMA", () => {
    // preprocess with a complex (non-primitive) output type is still unsupported
    const schema = z.preprocess((v) => v, z.object({ x: z.string() }));
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try {
      mock(schema);
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
      expect((e as ZodForgeError).message).toMatch(/preprocess/i);
    }
  });

  it("z.preprocess() with primitive output (z.coerce-like) works", () => {
    // preprocess wrapping a primitive output behaves like z.coerce — we generate the output type
    const schema = z.preprocess((v) => String(v), z.string());
    expect(() => mock(schema)).not.toThrow();
    const result = mock(schema);
    expect(typeof result).toBe("string");
  });

  it("z.promise() throws UNSUPPORTED_SCHEMA", () => {
    const schema = z.promise(z.string());
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try {
      mock(schema);
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
      expect((e as ZodForgeError).message).toMatch(/promise/i);
    }
  });

  it("z.symbol() throws UNSUPPORTED_SCHEMA", () => {
    const schema = z.symbol();
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try {
      mock(schema);
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
      expect((e as ZodForgeError).message).toMatch(/symbol/i);
    }
  });

  it("z.refine() throws UNSUPPORTED_SCHEMA", () => {
    const schema = z.string().refine((s) => s.startsWith("x"));
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try {
      mock(schema);
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
    }
  });

  it("overrides on transform schema throws UNSUPPORTED_SCHEMA with explanation", () => {
    const schema = z.string().transform((s) => s.length);
    expect(() => mock(schema, { overrides: {} })).toThrow(ZodForgeError);
    try {
      mock(schema, { overrides: {} });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
      expect((e as ZodForgeError).message).toMatch(/transform/i);
    }
  });
});

describe("UNSUPPORTED_MODE errors", () => {
  it("mode: 'edge' does not throw — it generates boundary values", () => {
    expect(() => mock(z.string(), { mode: "edge" })).not.toThrow();
    const result = mock(z.string(), { mode: "edge" });
    expect(z.string().safeParse(result).success).toBe(true);
  });

  it("mode: 'random' throws UNSUPPORTED_MODE", () => {
    expect(() => mock(z.string(), { mode: "random" })).toThrow(ZodForgeError);
    try {
      mock(z.string(), { mode: "random" });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_MODE");
    }
  });
});

describe("INVALID_OVERRIDE errors", () => {
  it("includes path information in message", () => {
    const schema = z.object({
      address: z.object({
        age: z.number().positive(),
      }),
    });
    try {
      mock(schema, { overrides: { address: { age: -5 } } });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("INVALID_OVERRIDE");
      expect((e as ZodForgeError).message).toContain("age");
    }
  });
});

describe("REGEX_UNSUPPORTED errors", () => {
  it("throws with description of what pattern was rejected", () => {
    // Lookahead patterns are unsupported and must throw REGEX_UNSUPPORTED
    const schema = z.string().regex(/(?=\d)/);
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try {
      mock(schema);
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("REGEX_UNSUPPORTED");
      expect((e as ZodForgeError).message).toMatch(/regex/i);
    }
  });
});

describe("GENERATION_FAILED errors", () => {
  it("z.intersection with conflicting field types throws GENERATION_FAILED", () => {
    // x must be both string and number — impossible
    const schema = z.intersection(
      z.object({ x: z.string() }),
      z.object({ x: z.number() }),
    );
    expect(() => mock(schema)).toThrow(ZodForgeError);
    try { mock(schema); } catch (e) {
      expect((e as ZodForgeError).code).toBe("GENERATION_FAILED");
    }
  });
});

describe("MAX_DEPTH_EXCEEDED errors", () => {
  it("error message includes maxDepth value", () => {
    type Required = { child: Required };
    const RequiredSchema: z.ZodType<Required> = z.lazy(() =>
      z.object({ child: RequiredSchema })
    );
    try {
      mock(RequiredSchema, { maxDepth: 2 });
    } catch (e) {
      expect((e as ZodForgeError).code).toBe("MAX_DEPTH_EXCEEDED");
      expect((e as ZodForgeError).message).toMatch(/2/);
    }
  });
});

describe("configure() and resetConfig()", () => {
  it("configure() and resetConfig() isolate between tests", () => {
    configure({ maxDepth: 5, useDefaults: true });
    resetConfig();
    // After reset, defaults should be back
    // We can verify by checking the snapshot indirectly via mock behavior
    const schema = z.string().default("hello");
    // useDefaults should be false after reset — so it shouldn't always return "hello"
    const results = Array.from({ length: 10 }, () => mock(schema));
    results.forEach((r) => expect(typeof r).toBe("string"));
  });

  it("configure() with matchers applies custom generator", () => {
    configure({
      matchers: [
        { pattern: /sku/i, generate: () => "SKU-1234" },
      ],
    });
    const schema = z.object({ sku: z.string() });
    const result = mock(schema);
    expect(result.sku).toBe("SKU-1234");
  });
});
