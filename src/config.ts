import { z } from "zod";
import type { GenerationMode } from "./context.js";
import type { DeepPartial } from "./merge.js";

export interface FieldMatcher {
  /** Regex pattern tested against the leaf key of ctx.path */
  pattern: RegExp;
  /** Generator function — receives no args, returns a value */
  generate: () => unknown;
}

export interface GlobalConfig {
  maxDepth: number;
  useDefaults: boolean;
  matchers: FieldMatcher[];
  refinementRetries: number;
}

export interface MockOptions<S extends z.ZodTypeAny = z.ZodTypeAny> {
  overrides?: DeepPartial<z.infer<S>>;
  seed?: number;
  maxDepth?: number;
  mode?: GenerationMode;
  useDefaults?: boolean;
  /**
   * Path-based generators. Keys are dot-separated paths (e.g. "user.address.zip").
   * When the generation path matches a key, the provided function is called
   * instead of the normal generator.
   *
   * @example
   * mock(schema, {
   *   generators: {
   *     "user.address.zip": () => "90210",
   *     "items.*.sku": () => `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
   *   }
   * })
   */
  generators?: Record<string, () => unknown>;
  /**
   * Maximum number of attempts when generating a value for a refined schema
   * (z.refine / z.superRefine). Overrides the global config value for this call.
   * Defaults to globalConfig.refinementRetries (default: 10).
   */
  refinementRetries?: number;
}

const DEFAULT_CONFIG: GlobalConfig = {
  maxDepth: 2,
  useDefaults: false,
  matchers: [],
  refinementRetries: 10,
};

let globalConfig: GlobalConfig = { ...DEFAULT_CONFIG, matchers: [] };

/** Returns an immutable snapshot of the current global config */
export function snapshotConfig(): Readonly<GlobalConfig> {
  return {
    maxDepth: globalConfig.maxDepth,
    useDefaults: globalConfig.useDefaults,
    matchers: [...globalConfig.matchers.map(m => ({ ...m }))],
    refinementRetries: globalConfig.refinementRetries,
  };
}

export function configure(options: Partial<GlobalConfig>): void {
  globalConfig = {
    ...globalConfig,
    ...options,
    matchers: options.matchers
      ? options.matchers.map(m => ({ ...m }))
      : globalConfig.matchers,
  };
}

export function resetConfig(): void {
  globalConfig = { ...DEFAULT_CONFIG, matchers: [] };
}
