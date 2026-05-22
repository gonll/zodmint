import { z } from "zod";
import type { MockOptions } from "./config.js";
import { mock } from "./mock.js";
import { deepMerge, type DeepPartial } from "./merge.js";

/**
 * Returns a factory function that generates instances of the schema.
 * Per-call overrides merge with base options.
 */
export function mockFactory<S extends z.ZodTypeAny>(
  schema: S,
  baseOptions?: MockOptions<S>,
): (callOptions?: MockOptions<S>) => z.infer<S> {
  return function (callOptions?: MockOptions<S>): z.infer<S> {
    const merged: MockOptions<S> = {
      ...baseOptions,
      ...callOptions,
      // Deep merge overrides so per-call overrides win over base overrides
      overrides:
        baseOptions?.overrides || callOptions?.overrides
          ? (deepMerge(
              (baseOptions?.overrides ?? {}) as z.infer<S>,
              (callOptions?.overrides ?? {}) as DeepPartial<z.infer<S>>,
            ) as DeepPartial<z.infer<S>>)
          : undefined,
    };
    return mock(schema, merged);
  };
}
