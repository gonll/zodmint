/**
 * Semantic inference helpers.
 * These are thin re-exports / wrappers so the pipeline can call a single
 * `inferSemanticKey(path)` and pass it into the constraint generators.
 */

/** Returns the leaf key of a path array, or null if path is empty. */
export function leafKey(path: string[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i]!;
    if (seg !== "*") return seg;
  }
  return null;
}
