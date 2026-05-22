import { z } from "zod";
import type { MockFactoryOptions, MockFactoryCallOptions } from "./config.js";
import { mock } from "./mock.js";
import { deepMerge, type DeepPartial } from "./merge.js";
import { ZodForgeError } from "./errors.js";

/** Internal helper: merges two partial objects without the double-DeepPartial type conflict. */
function mergePartials<T>(a: unknown, b: unknown): DeepPartial<T> {
  return deepMerge(a as T, b as DeepPartial<T>) as DeepPartial<T>;
}

/**
 * A typed factory returned by `mockFactory()`.
 * Callable directly, and exposes `.extend()` for deriving new factories.
 */
export type MockFactory<S extends z.ZodTypeAny> = {
  /** Generate a single instance, optionally activating states or providing overrides. */
  (callOptions?: MockFactoryCallOptions<S>): z.infer<S>;
  /**
   * Derive a new factory by merging additional options onto this one.
   * - `overrides` are deep-merged (extend wins).
   * - `states` are merged (extend adds/overrides individual states).
   * - `afterBuild` hooks are chained (base runs first, then extend).
   * - All other options follow normal spread (extend wins).
   */
  extend(options: Partial<MockFactoryOptions<S>>): MockFactory<S>;
};

function createFactory<S extends z.ZodTypeAny>(
  schema: S,
  options: MockFactoryOptions<S>,
): MockFactory<S> {
  function factory(callOptions?: MockFactoryCallOptions<S>): z.infer<S> {
    // 1. Resolve state overrides (merged left-to-right)
    let stateOverrides: DeepPartial<z.infer<S>> = {} as DeepPartial<z.infer<S>>;
    if (callOptions?.states !== undefined) {
      const stateNames = Array.isArray(callOptions.states)
        ? callOptions.states
        : [callOptions.states];

      for (const name of stateNames) {
        const stateData = options.states?.[name];
        if (stateData === undefined) {
          throw new ZodForgeError(
            `Unknown factory state: "${name}". Available states: ${
              Object.keys(options.states ?? {}).join(", ") || "(none)"
            }`,
            "INVALID_OVERRIDE",
          );
        }
        stateOverrides = mergePartials<z.infer<S>>(stateOverrides, stateData);
      }
    }

    // 2. Merge: base overrides → state overrides → per-call overrides
    const { states: _s, afterBuild: _ab, overrides: baseOverrides, ...baseCallOpts } = options;
    const { states: _cs, overrides: callOverrides, ...restCallOpts } = callOptions ?? {};

    const mergedOverrides = mergePartials<z.infer<S>>(
      mergePartials<z.infer<S>>(baseOverrides ?? {}, stateOverrides),
      callOverrides ?? {},
    );

    const finalOptions = {
      ...baseCallOpts,
      ...restCallOpts,
      overrides: mergedOverrides,
    };

    // 3. Generate
    let result = mock(schema, finalOptions);

    // 4. afterBuild hook
    if (options.afterBuild) {
      result = options.afterBuild(result);
    }

    return result;
  }

  factory.extend = function (
    extOptions: Partial<MockFactoryOptions<S>>,
  ): MockFactory<S> {
    // Chain afterBuild: base runs first, then extend
    let chainedAfterBuild: ((v: z.infer<S>) => z.infer<S>) | undefined;
    if (options.afterBuild && extOptions.afterBuild) {
      const baseHook = options.afterBuild;
      const extHook = extOptions.afterBuild;
      chainedAfterBuild = (v) => extHook(baseHook(v));
    } else {
      chainedAfterBuild = extOptions.afterBuild ?? options.afterBuild;
    }

    return createFactory(schema, {
      ...options,
      ...extOptions,
      overrides: mergePartials<z.infer<S>>(options.overrides ?? {}, extOptions.overrides ?? {}),
      states: {
        ...(options.states ?? {}),
        ...(extOptions.states ?? {}),
      },
      afterBuild: chainedAfterBuild,
    });
  };

  return factory as MockFactory<S>;
}

/**
 * Returns a typed factory for a Zod schema.
 *
 * Features:
 * - `states` — named pre-built override variants, activated by name per call
 * - `afterBuild` — post-generation hook for derived fields or cross-field logic
 * - `factory.extend()` — derive a new factory with merged options
 *
 * @example
 * const userFactory = mockFactory(UserSchema, {
 *   states: {
 *     admin: { role: "admin" },
 *     verified: { emailVerified: true },
 *   },
 *   afterBuild: (u) => ({ ...u, displayName: `${u.firstName} ${u.lastName}` }),
 * });
 *
 * userFactory();                          // random valid user
 * userFactory({ states: "admin" });       // role === "admin"
 * userFactory({ states: ["admin", "verified"] }); // both applied
 *
 * const guestFactory = userFactory.extend({ overrides: { role: "guest" } });
 */
export function mockFactory<S extends z.ZodTypeAny>(
  schema: S,
  baseOptions?: MockFactoryOptions<S>,
): MockFactory<S> {
  return createFactory(schema, baseOptions ?? {});
}
