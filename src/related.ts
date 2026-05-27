/**
 * zodmint/related — cross-schema field consistency.
 *
 * mockRelated() generates two mock objects and ensures that linked fields
 * match — e.g. post.userId === user.id, post.authorEmail === user.email.
 *
 * Links can be:
 *   - A key string  →  `post.userId` is set to `user[key]`
 *   - A mapper fn   →  `post.userId` is set to `mapper(user)`
 *
 * @example
 * const [user, post] = mockRelated(
 *   UserSchema,
 *   PostSchema,
 *   { userId: 'id', authorEmail: 'email' }
 * )
 * // post.userId === user.id
 * // post.authorEmail === user.email
 *
 * @example
 * // Use a mapper for derived values
 * const [org, member] = mockRelated(
 *   OrgSchema,
 *   MemberSchema,
 *   { orgId: 'id', displayName: (org) => `Member of ${org.name}` }
 * )
 */

import { z } from "zod";
import { mock } from "./mock.js";
import type { MockOptions } from "./config.js";
import type { DeepPartial } from "./merge.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Describes how fields on B relate back to fields on A.
 *
 * Each entry can be:
 * - A key of A (string) — the generated value from A is used verbatim.
 * - A mapper `(a: A) => B[K]` — the value is derived from the full A instance.
 */
export type LinkSpec<A, B> = {
  [K in keyof B]?: keyof A | ((a: A) => B[K]);
};

/**
 * Three-way variant that links fields from A and/or B into C.
 * Keys map C fields to either a key on A, a key on B, or a combined mapper.
 */
export type ThreeWayLinkSpec<A, B, C> = {
  [K in keyof C]?:
    | { from: "a"; key: keyof A }
    | { from: "b"; key: keyof B }
    | ((a: A, b: B) => C[K]);
};

// ---------------------------------------------------------------------------
// mockRelated — two-schema variant
// ---------------------------------------------------------------------------

/**
 * Generates two related mocks where fields on B are derived from A
 * according to the `links` specification.
 *
 * Returns `[a, b]` as a typed tuple.
 */
export function mockRelated<
  SA extends z.ZodTypeAny,
  SB extends z.ZodTypeAny,
>(
  schemaA: SA,
  schemaB: SB,
  links: LinkSpec<z.infer<SA>, z.infer<SB>>,
  optionsA?: MockOptions<SA>,
  optionsB?: MockOptions<SB>,
): [z.infer<SA>, z.infer<SB>] {
  const a = mock(schemaA, optionsA);

  // Build overrides for B from the link spec
  const overrides: Record<string, unknown> = {};
  for (const [bKey, link] of Object.entries(links) as [
    string,
    keyof z.infer<SA> | ((a: z.infer<SA>) => unknown) | undefined,
  ][]) {
    if (link === undefined) continue;
    overrides[bKey] = resolveLink(link as string | ((s: unknown) => unknown), a);
  }

  const b = mock(schemaB, {
    ...optionsB,
    overrides: mergeOverrides(
      optionsB?.overrides as Record<string, unknown> | undefined,
      overrides,
    ) as DeepPartial<z.infer<SB>>,
  });

  return [a, b];
}

// ---------------------------------------------------------------------------
// mockRelatedMany — generate N related pairs
// ---------------------------------------------------------------------------

/**
 * Generates `count` pairs of related mocks.
 *
 * Each pair is independently generated (different random values), but
 * the cross-schema links are preserved within each pair.
 *
 * @example
 * const pairs = mockRelatedMany(UserSchema, PostSchema, { userId: 'id' }, 3)
 * // pairs[0][1].userId === pairs[0][0].id  ✓
 * // pairs[1][1].userId === pairs[1][0].id  ✓
 */
export function mockRelatedMany<
  SA extends z.ZodTypeAny,
  SB extends z.ZodTypeAny,
>(
  schemaA: SA,
  schemaB: SB,
  links: LinkSpec<z.infer<SA>, z.infer<SB>>,
  count: number,
  optionsA?: MockOptions<SA>,
  optionsB?: MockOptions<SB>,
): [z.infer<SA>, z.infer<SB>][] {
  return Array.from({ length: count }, (_, i) =>
    mockRelated(
      schemaA,
      schemaB,
      links,
      optionsA?.seed !== undefined
        ? { ...optionsA, seed: optionsA.seed + i * 2 }
        : optionsA,
      optionsB?.seed !== undefined
        ? { ...optionsB, seed: optionsB.seed + i * 2 + 1 }
        : optionsB,
    ),
  );
}

// ---------------------------------------------------------------------------
// mockRelatedThree — three-schema variant
// ---------------------------------------------------------------------------

/**
 * Generates three related mocks. Fields on C can be derived from A, B, or both.
 *
 * @example
 * // Order with user + product references
 * const [user, product, order] = mockRelatedThree(
 *   UserSchema,
 *   ProductSchema,
 *   OrderSchema,
 *   {
 *     userId:    { from: 'a', key: 'id' },
 *     productId: { from: 'b', key: 'id' },
 *     totalCost: (_, product) => product.price * 2,
 *   }
 * )
 */
export function mockRelatedThree<
  SA extends z.ZodTypeAny,
  SB extends z.ZodTypeAny,
  SC extends z.ZodTypeAny,
>(
  schemaA: SA,
  schemaB: SB,
  schemaC: SC,
  links: ThreeWayLinkSpec<z.infer<SA>, z.infer<SB>, z.infer<SC>>,
  optionsA?: MockOptions<SA>,
  optionsB?: MockOptions<SB>,
  optionsC?: MockOptions<SC>,
): [z.infer<SA>, z.infer<SB>, z.infer<SC>] {
  const a = mock(schemaA, optionsA);
  const b = mock(schemaB, optionsB);

  // Build overrides for C from the three-way link spec
  const overrides: Record<string, unknown> = {};
  for (const [cKey, link] of Object.entries(links) as [
    string,
    ThreeWayLinkSpec<z.infer<SA>, z.infer<SB>, z.infer<SC>>[keyof z.infer<SC>],
  ][]) {
    if (link === undefined) continue;
    if (typeof link === "function") {
      // Mapper receives both A and B
      overrides[cKey] = link(a, b);
    } else {
      // Key reference — source is either A or B
      const source = link.from === "a" ? a : b;
      overrides[cKey] = resolveLink(link.key as string, source);
    }
  }

  const c = mock(schemaC, {
    ...optionsC,
    overrides: mergeOverrides(
      optionsC?.overrides as Record<string, unknown> | undefined,
      overrides,
    ) as DeepPartial<z.infer<SC>>,
  });

  return [a, b, c];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a LinkSpec entry into a concrete value given the source object(s).
 * Used by both mockRelated and mockRelatedThree to avoid duplicated loop logic.
 *
 * @param link   - A key reference (string) or mapper function.
 * @param source - The object the key/mapper reads from (A for two-way, A or B for three-way).
 */
function resolveLink(
  link: string | ((source: unknown) => unknown),
  source: unknown,
): unknown {
  if (typeof link === "function") return link(source);
  return (source as Record<string, unknown>)[link];
}

/**
 * Merges caller-supplied overrides with derived link values.
 * Derived values always win — links are the point of the call.
 */
function mergeOverrides(
  base: Record<string, unknown> | undefined,
  derived: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(base ?? {}), ...derived };
}
