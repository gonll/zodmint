/**
 * zodmint/tanstack-query — Pre-populate QueryClient cache with schema-valid data.
 *
 * Requires @tanstack/query-core >=5.0.0 as a peer dependency.
 * Framework-agnostic — works with React, Vue, Svelte, Solid, etc.
 *
 * @example
 * import { mockQueryClient } from "zodmint/tanstack-query";
 *
 * const client = mockQueryClient([
 *   { queryKey: ["user", "1"], schema: UserSchema },
 *   { queryKey: ["posts"],     schema: z.array(PostSchema) },
 * ]);
 *
 * // client.getQueryData(["user", "1"]) → valid User
 * // client.getQueryData(["posts"])     → valid Post[]
 */

import { QueryClient } from "@tanstack/query-core";
import { z } from "zod";
import { mock } from "./mock.js";
import type { MockOptions } from "./config.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single cache entry: maps a query key to a Zod schema for generation. */
export type QueryEntry<S extends z.ZodTypeAny> = {
  queryKey: unknown[];
  schema: S;
  options?: MockOptions<S>;
};

/** A single infinite query cache entry. */
export type InfiniteQueryEntry<S extends z.ZodTypeAny> = {
  queryKey: unknown[];
  /** Schema for a single item in the list. */
  schema: S;
  /** Number of items to generate for the single page. Default: 5. */
  pageSize?: number;
  options?: MockOptions<S>;
};

// ---------------------------------------------------------------------------
// Sane test defaults
// ---------------------------------------------------------------------------

const TEST_DEFAULTS = {
  queries: {
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  },
} as const;

// ---------------------------------------------------------------------------
// mockQueryClient
// ---------------------------------------------------------------------------

/**
 * Creates a `QueryClient` with its cache pre-populated synchronously.
 *
 * Each entry maps a query key to a Zod schema — the generated value is
 * injected via `queryClient.setQueryData()`.
 *
 * Sane test defaults are applied (`retry: false`, `staleTime: Infinity`,
 * `gcTime: Infinity`). Pass `defaultOptions` to override.
 *
 * @example
 * const client = mockQueryClient([
 *   { queryKey: ["user", "1"], schema: UserSchema, options: { seed: 1 } },
 *   { queryKey: ["posts"],     schema: z.array(PostSchema) },
 * ]);
 */
export function mockQueryClient(
  entries: QueryEntry<z.ZodTypeAny>[],
  defaultOptions?: ConstructorParameters<typeof QueryClient>[0],
): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      ...TEST_DEFAULTS,
      ...defaultOptions?.defaultOptions,
      queries: {
        ...TEST_DEFAULTS.queries,
        ...defaultOptions?.defaultOptions?.queries,
      },
    },
  });

  for (const entry of entries) {
    const value = mock(entry.schema, entry.options);
    client.setQueryData(entry.queryKey, value);
  }

  return client;
}

// ---------------------------------------------------------------------------
// mockQueryFn
// ---------------------------------------------------------------------------

/**
 * Returns a `queryFn`-compatible function that generates a valid value from
 * the given schema each time it is called.
 *
 * Useful when you want to use zodmint inside a real `useQuery` call rather
 * than pre-populating the cache.
 *
 * @example
 * const { result } = renderHook(() =>
 *   useQuery({
 *     queryKey: ["user", "1"],
 *     queryFn: mockQueryFn(UserSchema, { seed: 42 }),
 *   })
 * );
 */
export function mockQueryFn<S extends z.ZodTypeAny>(
  schema: S,
  options?: MockOptions<S>,
): () => z.infer<S> {
  return () => mock(schema, options);
}

// ---------------------------------------------------------------------------
// mockInfiniteQueryClient
// ---------------------------------------------------------------------------

/**
 * Creates a `QueryClient` with infinite query cache pre-populated.
 *
 * Each entry produces an `InfiniteData` shape with a single page of items.
 * The shape matches TanStack Query v5: `{ pages: Array<T[]>, pageParams: unknown[] }`.
 *
 * @example
 * const client = mockInfiniteQueryClient([
 *   { queryKey: ["feed"], schema: PostSchema, pageSize: 10 },
 * ]);
 * // client.getQueryData(["feed"])
 * // → { pages: [Post[10]], pageParams: [undefined] }
 */
export function mockInfiniteQueryClient(
  entries: InfiniteQueryEntry<z.ZodTypeAny>[],
  defaultOptions?: ConstructorParameters<typeof QueryClient>[0],
): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      ...TEST_DEFAULTS,
      ...defaultOptions?.defaultOptions,
      queries: {
        ...TEST_DEFAULTS.queries,
        ...defaultOptions?.defaultOptions?.queries,
      },
    },
  });

  for (const entry of entries) {
    const size = entry.pageSize ?? 5;
    const items = Array.from({ length: size }, (_, i) =>
      mock(entry.schema, {
        ...entry.options,
        seed:
          entry.options?.seed !== undefined
            ? entry.options.seed + i
            : undefined,
      }),
    );

    client.setQueryData(entry.queryKey, {
      pages: [items],
      pageParams: [undefined],
    });
  }

  return client;
}
