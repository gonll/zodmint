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

/**
 * Options for `mockFactory()`. Extends `MockOptions` with factory-specific features:
 * states, afterBuild, and extend().
 */
export interface MockFactoryOptions<S extends z.ZodTypeAny = z.ZodTypeAny>
  extends MockOptions<S> {
  /**
   * Named state variants. Each state is a set of partial overrides that can be
   * activated by name when calling the factory. States are merged left-to-right,
   * then per-call overrides win.
   *
   * @example
   * const factory = mockFactory(UserSchema, {
   *   states: {
   *     admin:   { role: "admin" },
   *     banned:  { banned: true, bannedAt: new Date(0) },
   *   },
   * });
   * factory({ states: "admin" });
   * factory({ states: ["admin", "banned"] }); // merged
   */
  states?: Record<string, DeepPartial<z.infer<S>>>;
  /**
   * Post-generation hook. Called with the fully-generated (and override-merged)
   * value before it is returned. Ideal for derived fields or cross-field logic.
   *
   * @example
   * const factory = mockFactory(PostSchema, {
   *   afterBuild: (post) => ({ ...post, slug: post.title.toLowerCase().replace(/ /g, "-") }),
   * });
   */
  afterBuild?: (value: z.infer<S>) => z.infer<S>;
}

/**
 * Per-call options for a `MockFactory`. Extends `MockOptions` with a `states`
 * field that activates one or more named states for this call.
 */
export interface MockFactoryCallOptions<S extends z.ZodTypeAny = z.ZodTypeAny>
  extends MockOptions<S> {
  /**
   * State name(s) to apply for this call. Multiple states are merged left-to-right;
   * per-call `overrides` always win over state overrides.
   *
   * @example
   * factory({ states: "admin" });
   * factory({ states: ["admin", "verified"] });
   */
  states?: string | string[];
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

/**
 * Runs `fn` with a temporarily-scoped config, then restores the previous config.
 * Useful in tests or isolated contexts where you need a one-off config change
 * without polluting the global state.
 */
export function withConfig<T>(options: Partial<GlobalConfig>, fn: () => T): T {
  const previous = snapshotConfig();
  configure(options);
  try {
    return fn();
  } finally {
    globalConfig = previous as GlobalConfig;
  }
}
