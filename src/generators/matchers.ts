import type { FieldMatcher, MatcherContext } from "../config.js";
import type { Session } from "../session.js";

/**
 * Checks custom matchers against the semantic key (description or path leaf).
 * Returns the first matching generated value, or undefined if none match.
 *
 * `matchKey`   — the string tested against each matcher's pattern. This may be
 *                the schema description (e.g. "email") when `.describe()` is set.
 * `actualLeaf` — the real field name from the path (e.g. "x"). Always used as
 *                `ctx.leaf` so matchers see the field name, not the description.
 */
export function applyCustomMatchers(
  matchKey: string | null,
  matchers: FieldMatcher[],
  path: string[] = [],
  session?: Session,
  actualLeaf?: string | null,
): unknown {
  if (!matchKey || matchers.length === 0) return undefined;
  const leaf = actualLeaf ?? matchKey;
  const ctx: MatcherContext = { path, leaf, session };
  for (const matcher of matchers) {
    if (matcher.pattern.test(matchKey)) {
      return matcher.generate(ctx);
    }
  }
  return undefined;
}
