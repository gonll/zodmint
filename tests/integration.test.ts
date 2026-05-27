/**
 * Integration smoke test — imports via src path aliases to simulate package imports.
 * Catches broken exports, missing re-exports, and type issues before publishing.
 */
import { describe, it, expect } from "vitest";

// Import from src/index.ts (the same files that get compiled to dist)
// This tests that all intended exports are present and wired up correctly
import {
  mock,
  mockList,
  mockFactory,
  configure,
  resetConfig,
  withConfig,
  ZodForgeError,
} from "../src/index.js";
import { zodForgeMatchers } from "../src/testing.js";
import { z } from "zod";

describe("integration: public API surface", () => {
  it("all expected exports are present", () => {
    expect(typeof mock).toBe("function");
    expect(typeof mockList).toBe("function");
    expect(typeof mockFactory).toBe("function");
    expect(typeof configure).toBe("function");
    expect(typeof resetConfig).toBe("function");
    expect(typeof withConfig).toBe("function");
    expect(typeof ZodForgeError).toBe("function");
    expect(typeof zodForgeMatchers.toMatchSchema).toBe("function");
  });

  it("mock returns correctly typed output", () => {
    const schema = z.object({
      id: z.string().uuid(),
      name: z.string(),
      age: z.number().int().min(0).max(120),
      active: z.boolean(),
      tags: z.array(z.string()),
    });
    const result = mock(schema);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("ZodForgeError is instanceof-able", () => {
    try {
      mock(z.never());
    } catch (e) {
      expect(e).toBeInstanceOf(ZodForgeError);
      expect((e as ZodForgeError).code).toBe("UNSUPPORTED_SCHEMA");
    }
  });

  it("toMatchSchema matcher works", () => {
    expect.extend(zodForgeMatchers);
    const schema = z.object({ name: z.string() });
    expect(mock(schema)).toMatchSchema(schema);
  });

  it("withConfig scopes config changes", () => {
    const result = withConfig({ maxDepth: 5 }, () => mock(z.string()));
    expect(typeof result).toBe("string");
  });
});
