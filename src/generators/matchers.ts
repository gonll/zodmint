import type { FieldMatcher, MatcherContext } from "../config.js";

/**
 * Checks custom matchers against the leaf key.
 * Returns the first matching generated value, or undefined if none match.
 * Passes a MatcherContext so matchers can produce path-aware values.
 */
export function applyCustomMatchers(
  leafKey: string | null,
  matchers: FieldMatcher[],
  path: string[] = [],
): unknown {
  if (!leafKey || matchers.length === 0) return undefined;
  const ctx: MatcherContext = { path, leaf: leafKey };
  for (const matcher of matchers) {
    if (matcher.pattern.test(leafKey)) {
      return matcher.generate(ctx);
    }
  }
  return undefined;
}
