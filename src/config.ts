import { z } from "zod";
import type { GenerationMode } from "./context.js";
import type { DeepPartial } from "./merge.js";
import type { Session } from "./session.js";

/**
 * Context passed to `FieldMatcher.generate`. Provides the full schema path
 * and the matched leaf key so matchers can produce path-aware values.
 */
export interface MatcherContext {
  /** Full dot-separated path segments, e.g. ["user", "addresses", "*", "zipCode"] */
  path: string[];
  /** The matched leaf key (last non-"*" segment), e.g. "zipCode" */
  leaf: string;
  /** Session for cross-call coordination. Only present when a session is passed to mock(). */
  session?: Session;
}

export interface FieldMatcher {
  /** Regex pattern tested against the leaf key of ctx.path */
  pattern: RegExp;
  /**
   * Generator function. Receives a `MatcherContext` with the full path and
   * leaf key — use it to produce path-aware values.
   *
   * The context parameter is optional for backward compatibility: existing
   * `generate: () => value` matchers continue to work unchanged.
   *
   * @example
   * {
   *   pattern: /zipCode/i,
   *   generate: ({ path }) => path.includes("billing") ? "90210" : "10001",
   * }
   */
  generate: (context?: MatcherContext) => unknown;
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
  /** Session to thread shared state across calls and into matchers */
  session?: Session;
  /**
   * Paths of fields to intentionally violate. Values at these paths will
   * deliberately fail schema validation, useful for testing error handling.
   *
   * @example
   * mock(UserSchema, { violate: ["email", "age"] })
   * // result.email is not a valid email
   * // result.age is not a valid age value
   * // all other fields are valid
   */
  violate?: string[];
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

/**
 * A plugin bundles a set of matchers (and optionally other config defaults)
 * into a reusable, distributable package. Install via `configure({ plugins })`.
 *
 * Plugin matchers are prepended to the global matchers list, so they take
 * priority over the built-in semantic inference. Explicit `matchers` passed
 * to `configure()` are prepended before plugin matchers and therefore win.
 *
 * @example
 * // my-commerce-plugin.ts
 * export const commercePlugin = definePlugin({
 *   matchers: [
 *     { pattern: /sku/i,      generate: () => `SKU-${Math.random().toString(36).slice(2,6).toUpperCase()}` },
 *     { pattern: /currency/i, generate: () => "USD" },
 *     { pattern: /taxRate/i,  generate: () => 0.08 },
 *   ],
 * });
 *
 * // in your test setup
 * configure({ plugins: [commercePlugin] });
 */
export interface ZodmintPlugin {
  /** Matchers contributed by this plugin. */
  matchers: FieldMatcher[];
}

/**
 * Creates a `ZodmintPlugin` from a plain options object.
 * Use this to package and share domain-specific matchers.
 */
export function definePlugin(options: { matchers: FieldMatcher[] }): ZodmintPlugin {
  return { matchers: options.matchers.map(m => ({ ...m })) };
}

/** Options accepted by `configure()` — extends `GlobalConfig` with a `plugins` array. */
export interface ConfigureOptions extends Partial<GlobalConfig> {
  /**
   * Plugins to install. Each plugin's matchers are merged into the global
   * matchers list after any explicitly provided `matchers`.
   */
  plugins?: ZodmintPlugin[];
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

export function configure(options: ConfigureOptions): void {
  // Expand plugin matchers (plugins come after explicit matchers, so explicit win)
  const pluginMatchers = (options.plugins ?? []).flatMap(p => p.matchers.map(m => ({ ...m })));
  const explicitMatchers = options.matchers
    ? options.matchers.map(m => ({ ...m }))
    : globalConfig.matchers;

  globalConfig = {
    ...globalConfig,
    ...options,
    matchers: [...explicitMatchers, ...pluginMatchers],
  };
}

export function resetConfig(): void {
  globalConfig = { ...DEFAULT_CONFIG, matchers: [] };
}

/**
 * Runs `fn` with a temporarily-scoped config, then restores the previous config.
 * Useful in tests or isolated contexts where you need a one-off config change
 * without polluting the global state.
 *
 * Plugin matchers installed via configure({ plugins }) are preserved unless
 * `options.plugins` is explicitly provided to replace them.
 *
 * When `options.matchers` is provided, those matchers are prepended to (not
 * replacing) any existing plugin matchers, so plugin-installed matchers remain
 * active for the duration of `fn()`.
 */
export function withConfig<T>(options: ConfigureOptions, fn: () => T): T {
  const previous = snapshotConfig();
  // Preserve existing plugin matchers when options doesn't bring its own plugins.
  // We do this by passing the current global matchers as the baseline so that
  // configure() doesn't wipe them out when options.plugins is undefined.
  const mergedOptions: ConfigureOptions =
    options.plugins === undefined && options.matchers !== undefined
      ? { ...options, matchers: [...options.matchers, ...globalConfig.matchers] }
      : options;
  configure(mergedOptions);
  try {
    return fn();
  } finally {
    globalConfig = previous as GlobalConfig;
  }
}
