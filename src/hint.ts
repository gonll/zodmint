import { z } from "zod";

/**
 * WeakMap registry of user-supplied generation hints.
 * Keyed by schema object so hints are GC'd when the schema is GC'd.
 */
const generationHints = new WeakMap<object, () => unknown>();

/**
 * Attaches a generation hint to a schema containing `.refine()` or `.superRefine()`.
 *
 * When zodmint encounters a refinement during generation it normally uses a
 * brute-force generate-and-test retry loop, which can be slow or impossible for
 * complex predicates. `withGenerate` lets you short-circuit that by providing a
 * factory that returns a value known to satisfy all refinements.
 *
 * The hint is checked BEFORE the retry loop. If it returns a value that passes
 * `safeParse`, it is used directly. If it returns an invalid value, generation
 * falls back to the normal retry loop.
 *
 * Works with both `mock()` (sync) and `mockAsync()` (async refinements).
 *
 * @example
 * // Without hint: may need many retries to satisfy a complex email uniqueness check
 * const UniqueEmail = z.string().email().refine(
 *   (v) => !usedEmails.has(v),
 *   "Email already used",
 * );
 *
 * // With hint: always generates a valid, unique email immediately
 * const UniqueEmail = withGenerate(
 *   z.string().email().refine((v) => !usedEmails.has(v), "Email already used"),
 *   () => `user-${Date.now()}@example.com`,
 * );
 */
export function withGenerate<S extends z.ZodTypeAny>(
  schema: S,
  generate: () => z.infer<S>,
): S {
  generationHints.set(schema as object, generate as () => unknown);
  return schema;
}

/**
 * Returns the generation hint attached to a schema via `withGenerate()`, or
 * `undefined` if no hint is registered.
 *
 * Internal — not exported from the public API.
 */
export function getGenerationHint(schema: z.ZodTypeAny): (() => unknown) | undefined {
  return generationHints.get(schema as object);
}
