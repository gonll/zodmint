import type { FieldMatcher, MatcherContext } from "../config.js";
import type { Session } from "../session.js";

/**
 * Checks custom matchers against a semantic hint key (description ?? leaf name).
 * Returns the first matching generated value, or undefined if none match.
 *
 * `semanticHint` is used for pattern matching (so .describe("email") triggers
 * an email matcher even if the field name is "x").
 *
 * `MatcherContext.leaf` is always the actual field name from the path — NOT the
 * description — so matchers that inspect `ctx.leaf` for field-name logic see
 * the real name.
 */
export function applyCustomMatchers(
  semanticHint: string | null,
  matchers: FieldMatcher[],
  path: string[] = [],
  session?: Session,
): unknown {
  if (!semanticHint || matchers.length === 0) return undefined;
  // The true leaf is the last non-wildcard segment of the path.
  const trueLeaf = [...path].reverse().find(s => s !== "*") ?? semanticHint;
  const ctx: MatcherContext = { path, leaf: trueLeaf, session };
  for (const matcher of matchers) {
    if (matcher.pattern.test(semanticHint)) {
      return matcher.generate(ctx);
    }
  }
  return undefined;
}
