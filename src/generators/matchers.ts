import type { FieldMatcher } from "../config.js";

/**
 * Checks custom matchers against the leaf key.
 * Returns the first matching generated value, or undefined if none match.
 */
export function applyCustomMatchers(
  leafKey: string | null,
  matchers: FieldMatcher[],
): unknown {
  if (!leafKey || matchers.length === 0) return undefined;
  for (const matcher of matchers) {
    if (matcher.pattern.test(leafKey)) {
      return matcher.generate();
    }
  }
  return undefined;
}
