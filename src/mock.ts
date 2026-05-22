import { z } from "zod";
import type { MockOptions } from "./config.js";
import { snapshotConfig } from "./config.js";
import {
  createSeededRNG,
  createRandomRNG,
  type GenerationContext,
} from "./context.js";
import { runPipeline } from "./pipeline.js";

/**
 * Generates a single mock object from a Zod schema.
 *
 * Captures an immutable snapshot of global config at call start.
 * Subsequent `configure()` calls during the same generation have no effect.
 */
export function mock<S extends z.ZodTypeAny>(
  schema: S,
  options?: MockOptions<S>,
): z.infer<S> {
  // Step 1: Capture immutable config snapshot
  const config = snapshotConfig();

  const mode = options?.mode ?? "realistic";

  const rng =
    options?.seed !== undefined
      ? createSeededRNG(options.seed)
      : createRandomRNG();

  const ctx: GenerationContext = {
    path: [],
    depth: 0,
    maxDepth: options?.maxDepth ?? config.maxDepth,
    rng,
    mode,
    useDefaults: options?.useDefaults ?? config.useDefaults,
    generators: options?.generators ?? {},
    refinementRetries: options?.refinementRetries ?? config.refinementRetries,
  };

  return runPipeline(schema, ctx, config, options);
}

/**
 * Generates an array of mocks, independent of schema-level array constraints.
 *
 * @param schema - The schema for each individual item
 * @param options - MockOptions plus optional `count`
 */
export function mockList<S extends z.ZodTypeAny>(
  schema: S,
  options?: MockOptions<S> & { count?: number },
): z.infer<S>[] {
  let count: number;
  if (options?.count !== undefined) {
    count = options.count;
  } else if (options?.seed !== undefined) {
    // Derive count from the seeded RNG so it is deterministic with the same seed
    count = createSeededRNG(options.seed).nextInt(1, 5);
  } else {
    count = createRandomRNG().nextInt(1, 5);
  }

  return Array.from({ length: count }, (_, i) =>
    mock(schema, {
      ...options,
      seed: options?.seed !== undefined ? options.seed + i : undefined,
    }),
  );
}
