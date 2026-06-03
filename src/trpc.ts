/**
 * zodmint/trpc — Mock tRPC callers for unit tests.
 *
 * No @trpc/server peer dependency required. Uses a Proxy to intercept any
 * method chain and return schema-valid data for registered procedure paths.
 *
 * @example
 * import { mockTrpcCaller } from "zodmint/trpc";
 *
 * const caller = mockTrpcCaller({
 *   "users.getById": UserSchema,
 *   "users.list":    z.array(UserSchema),
 *   "posts.create":  { schema: PostSchema, options: { seed: 1 } },
 * });
 *
 * const user = await caller.users.getById({ id: "1" }); // valid User
 */

import { z } from "zod";
import { mock } from "./mock.js";
import type { MockOptions } from "./config.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A procedure entry: either a bare Zod schema or a schema with per-procedure
 * MockOptions. Both forms produce Promise<z.infer<S>> on call.
 */
export type ProcedureSpec<S extends z.ZodTypeAny> =
  | S
  | { schema: S; options?: MockOptions<S> };

/** Maps dot-separated procedure paths to their output schema (or spec). */
export type ProcedureMap = Record<string, ProcedureSpec<z.ZodTypeAny>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves a ProcedureSpec to its schema and options. */
function resolveSpec(
  spec: ProcedureSpec<z.ZodTypeAny>,
): { schema: z.ZodTypeAny; options: MockOptions<z.ZodTypeAny> | undefined } {
  if (spec instanceof z.ZodType) {
    return { schema: spec, options: undefined };
  }
  return { schema: (spec as { schema: z.ZodTypeAny; options?: MockOptions<z.ZodTypeAny> }).schema, options: (spec as { schema: z.ZodTypeAny; options?: MockOptions<z.ZodTypeAny> }).options };
}

/** Recursively builds a Proxy that accumulates the access path and resolves on call. */
function buildProxy(
  procedureMap: ProcedureMap,
  defaultOptions: MockOptions<z.ZodTypeAny> | undefined,
  path: string[],
): unknown {
  return new Proxy(
    // Target must be a function so the proxy can be invoked as a procedure call.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    function () {},
    {
      get(_target, key: string) {
        // Extend the accumulated path on each property access.
        return buildProxy(procedureMap, defaultOptions, [...path, key]);
      },
      apply(_target, _this, _args) {
        // Called as a function — look up the accumulated dot-path.
        const procedurePath = path.join(".");
        const spec = procedureMap[procedurePath];
        if (!spec) return Promise.resolve(undefined);

        const { schema, options: perProcedureOptions } = resolveSpec(spec);
        // Per-procedure options take priority over default options.
        const resolvedOptions = perProcedureOptions ?? defaultOptions;
        return Promise.resolve(mock(schema, resolvedOptions));
      },
    },
  );
}

// ---------------------------------------------------------------------------
// mockTrpcCaller
// ---------------------------------------------------------------------------

/**
 * Creates a mock tRPC caller. `procedureMap` maps dot-separated procedure
 * paths to their output Zod schema (or a `{ schema, options }` spec).
 *
 * The return type is `Record<string, unknown>` — cast to your router caller
 * type for full IDE completion:
 * ```ts
 * const caller = mockTrpcCaller({...}) as Caller;
 * ```
 *
 * Procedures not in the map return `Promise<undefined>` rather than throwing.
 *
 * @param procedureMap  Procedure paths → output schema or spec.
 * @param defaultOptions  MockOptions applied to every procedure unless overridden.
 */
export function mockTrpcCaller(
  procedureMap: ProcedureMap,
  defaultOptions?: MockOptions<z.ZodTypeAny>,
): Record<string, unknown> {
  return buildProxy(procedureMap, defaultOptions, []) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// mockProcedureOutput
// ---------------------------------------------------------------------------

/**
 * Generates a single valid output value synchronously from a Zod schema.
 * Thin named wrapper around `mock()` for clarity in tRPC test contexts.
 *
 * @example
 * const output = mockProcedureOutput(getUserOutputSchema, { seed: 42 });
 */
export function mockProcedureOutput<S extends z.ZodTypeAny>(
  schema: S,
  options?: MockOptions<S>,
): z.infer<S> {
  return mock(schema, options);
}
