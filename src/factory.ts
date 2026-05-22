import { z } from "zod";
import type { MockOptions } from "./config.js";
import { mock } from "./mock.js";

/**
 * Returns a factory function that generates instances of the schema.
 * Per-call overrides merge with base options.
 */
export function mockFactory<S extends z.ZodTypeAny>(
  schema: S,
  baseOptions?: MockOptions,
): (callOptions?: MockOptions) => z.infer<S> {
  return function (callOptions?: MockOptions): z.infer<S> {
    const merged: MockOptions = {
      ...baseOptions,
      ...callOptions,
      // Deep merge overrides so per-call overrides win over base overrides
      overrides:
        baseOptions?.overrides || callOptions?.overrides
          ? { ...(baseOptions?.overrides ?? {}), ...(callOptions?.overrides ?? {}) }
          : undefined,
    };
    return mock(schema, merged);
  };
}
