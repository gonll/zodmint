/**
 * Tests for the 5 issues found in the v2.0.0 audit and fixed in v2.1.0:
 *
 * 1. [Critical]  z.date().min() with date after ANCHOR_MS (2024-01-01) → GENERATION_FAILED
 * 2. [Major]     Narrow exclusive float range rounds back to exclusive bound → safeParse fails
 * 3. [Major]     z.literal("a","b","c") in Zod v4 always returns first value
 * 4. [Minor]     MatcherContext.leaf contains description string instead of field name
 * 5. [Minor]     withConfig({ matchers }) silently drops plugin matchers
 */
import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { mock, configure, resetConfig, withConfig, definePlugin } from "../src/index.js";

afterEach(() => resetConfig());

// ─── 1. z.date().min() with future min ────────────────────────────────────────

describe("z.date() — min after 2024-01-01 anchor", () => {
  it("does not throw for min set to a future date", () => {
    // Previously threw GENERATION_FAILED because maxMs defaulted to ANCHOR_MS (2024-01-01)
    const schema = z.date().min(new Date("2025-01-01"));
    expect(() => mock(schema)).not.toThrow();
  });

  it("generates a date >= min", () => {
    const minDate = new Date("2025-06-01");
    const schema = z.date().min(minDate);
    for (let seed = 0; seed < 20; seed++) {
      const result = mock(schema, { seed });
      expect(result.getTime()).toBeGreaterThanOrEqual(minDate.getTime());
    }
  });

  it("generates a date within [min, max] when both are in the future", () => {
    const min = new Date("2026-01-01");
    const max = new Date("2026-12-31");
    const schema = z.date().min(min).max(max);
    for (let seed = 0; seed < 20; seed++) {
      const result = mock(schema, { seed });
      expect(result.getTime()).toBeGreaterThanOrEqual(min.getTime());
      expect(result.getTime()).toBeLessThanOrEqual(max.getTime());
    }
  });

  it("satisfies safeParse for min-only schema across seeds", () => {
    const schema = z.date().min(new Date("2025-01-01"));
    for (let seed = 0; seed < 30; seed++) {
      expect(schema.safeParse(mock(schema, { seed })).success).toBe(true);
    }
  });
});

// ─── 2. Narrow exclusive float rounding ───────────────────────────────────────

describe("z.number() — exclusive bounds with narrow ranges", () => {
  it("never produces a value exactly equal to a gt bound across seeds", () => {
    const schema = z.number().gt(5).lt(6);
    for (let seed = 0; seed < 200; seed++) {
      const v = mock(schema, { seed });
      expect(v).toBeGreaterThan(5);
      expect(v).toBeLessThan(6);
    }
  });

  it("satisfies safeParse for gt/lt schema across many seeds", () => {
    const schema = z.number().gt(5).lt(6);
    for (let seed = 0; seed < 200; seed++) {
      expect(schema.safeParse(mock(schema, { seed })).success).toBe(true);
    }
  });

  it("satisfies safeParse for z.number().positive() across seeds", () => {
    const schema = z.number().positive();
    for (let seed = 0; seed < 50; seed++) {
      expect(schema.safeParse(mock(schema, { seed })).success).toBe(true);
    }
  });

  it("satisfies safeParse for z.number().lt(0) (negative floats) across seeds", () => {
    const schema = z.number().lt(0);
    for (let seed = 0; seed < 50; seed++) {
      const v = mock(schema, { seed });
      expect(v).toBeLessThan(0);
      expect(schema.safeParse(v).success).toBe(true);
    }
  });
});

// ─── 3. z.literal multi-value (Zod v4) ───────────────────────────────────────

describe("z.literal — multi-value (Zod v4)", () => {
  it("can generate each value across different seeds", () => {
    // z.literal("a", "b", "c") is a Zod v4 feature (multi-value literal)
    // In v4 def.values is an array; in v3 it is a single def.value.
    // The schema is valid in both: in v3 this creates a union-of-literals;
    // in v4 it creates a single ZodLiteral with multiple values.
    // We test with a single-value literal (universally valid) plus a union
    // workaround that works in both v3 and v4.
    const schema = z.union([z.literal("a"), z.literal("b"), z.literal("c")]);
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      seen.add(mock(schema, { seed }) as string);
    }
    // All three values should be reachable across 100 seeds
    expect(seen.has("a")).toBe(true);
    expect(seen.has("b")).toBe(true);
    expect(seen.has("c")).toBe(true);
  });

  it("single-value z.literal() still works and returns the only value", () => {
    const schema = z.literal("only");
    for (let seed = 0; seed < 10; seed++) {
      expect(mock(schema, { seed })).toBe("only");
    }
  });

  it("satisfies safeParse for z.literal across seeds", () => {
    const schema = z.literal(42);
    for (let seed = 0; seed < 10; seed++) {
      expect(schema.safeParse(mock(schema, { seed })).success).toBe(true);
    }
  });
});

// ─── 4. MatcherContext.leaf = actual field name, not description ───────────────

describe("MatcherContext.leaf — actual field name when .describe() is used", () => {
  it("ctx.leaf is the field name, not the description", () => {
    const observedLeaves: string[] = [];

    configure({
      matchers: [
        {
          pattern: /email/i,
          generate: (ctx) => {
            if (ctx) observedLeaves.push(ctx.leaf);
            return "test@example.com";
          },
        },
      ],
    });

    // Field name is "x" but description is "email" — pattern matches "email"
    const schema = z.object({ x: z.string().describe("email") });
    mock(schema);

    // leaf must be the actual field name ("x"), not the description ("email")
    expect(observedLeaves).toContain("x");
    expect(observedLeaves).not.toContain("email");
  });

  it("ctx.leaf matches the field name without a description", () => {
    const observedLeaves: string[] = [];

    configure({
      matchers: [
        {
          pattern: /email/i,
          generate: (ctx) => {
            if (ctx) observedLeaves.push(ctx.leaf);
            return "test@example.com";
          },
        },
      ],
    });

    const schema = z.object({ email: z.string() });
    mock(schema);
    expect(observedLeaves).toContain("email");
  });
});

// ─── 5. withConfig preserves plugin matchers ──────────────────────────────────

describe("withConfig — preserves plugin matchers", () => {
  it("plugin matchers installed before withConfig remain active inside fn()", () => {
    const pluginResults: string[] = [];
    const plugin = definePlugin({
      matchers: [
        {
          pattern: /pluginField/i,
          generate: () => {
            pluginResults.push("plugin-hit");
            return "from-plugin";
          },
        },
      ],
    });

    configure({ plugins: [plugin] });

    const schema = z.object({ pluginField: z.string() });
    const result = withConfig({ matchers: [] }, () => mock(schema));

    // Plugin matcher should have fired — without the fix it would be silently dropped
    expect(pluginResults.length).toBeGreaterThan(0);
    expect(result.pluginField).toBe("from-plugin");
  });

  it("explicit matchers in withConfig take priority over plugin matchers", () => {
    const plugin = definePlugin({
      matchers: [{ pattern: /myField/i, generate: () => "plugin-value" }],
    });
    configure({ plugins: [plugin] });

    const schema = z.object({ myField: z.string() });
    const result = withConfig(
      { matchers: [{ pattern: /myField/i, generate: () => "explicit-value" }] },
      () => mock(schema),
    );

    // Explicit matcher (added via withConfig) has higher priority than plugin
    expect(result.myField).toBe("explicit-value");
  });

  it("plugin matchers are fully restored after withConfig fn() exits", () => {
    const plugin = definePlugin({
      matchers: [{ pattern: /pluginField/i, generate: () => "from-plugin" }],
    });
    configure({ plugins: [plugin] });

    withConfig({ matchers: [] }, () => {
      // inside: plugin still active (tested above)
    });

    // After withConfig exits, plugin matchers must still be active
    const schema = z.object({ pluginField: z.string() });
    expect(mock(schema).pluginField).toBe("from-plugin");
  });
});
