import { z } from "zod";
import type { MockOptions } from "./config.js";
import { snapshotConfig } from "./config.js";
import {
  createSeededRNG,
  createRandomRNG,
  type GenerationContext,
} from "./context.js";
import { runPipeline } from "./pipeline.js";
import { ZodForgeError } from "./errors.js";

/**
 * Generates a single mock object from a Zod schema.
 *
 * Captures an immutable snapshot of global config at call start.
 * Subsequent `configure()` calls during the same generation have no effect.
 */
/** Collects all dot-joined leaf paths from a nested override object */
function collectOverridePaths(obj: Record<string, unknown>, prefix = ""): Set<string> {
  const paths = new Set<string>();
  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    paths.add(fullPath);
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      for (const p of collectOverridePaths(val as Record<string, unknown>, fullPath)) {
        paths.add(p);
      }
    }
  }
  return paths;
}

export function mock<S extends z.ZodTypeAny>(
  schema: S,
  options?: MockOptions<S>,
): z.infer<S> {
  // Step 1: Capture immutable config snapshot
  const config = snapshotConfig();

  // Guard: violate and overrides may not target the same paths
  if (options?.violate && options?.overrides) {
    const overridePaths = collectOverridePaths(options.overrides as Record<string, unknown>);
    for (const vPath of options.violate) {
      if (overridePaths.has(vPath)) {
        throw new ZodForgeError(
          `Conflicting options: path "${vPath}" appears in both violate and overrides. ` +
            `Use one or the other.`,
          "INVALID_OVERRIDE",
        );
      }
    }
  }

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
    session: options?.session,
    violatePaths: new Set(options?.violate ?? []),
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
