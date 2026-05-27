/**
 * Deep partial merge for override application.
 *
 * Rules:
 * - Plain objects → merged recursively
 * - Arrays → replace (never concat or dedupe)
 * - Scalars (string, number, boolean, null) → replaced
 * - `undefined` override values → ignored (field keeps generated value)
 */
export function deepMerge<T>(base: T, overrides: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    // Non-object: override wins unless undefined
    return (overrides === undefined ? base : overrides) as T;
  }

  const result = { ...(base as Record<string, unknown>) };

  for (const [key, val] of Object.entries(overrides as Record<string, unknown>)) {
    if (val === undefined) continue; // ignore — field keeps generated value

    const baseVal = result[key];
    if (isPlainObject(baseVal) && isPlainObject(val)) {
      result[key] = deepMerge(baseVal, val);
    } else {
      // arrays replace; scalars replace
      result[key] = val;
    }
  }

  return result as T;
}

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !(v instanceof Map) &&
    !(v instanceof Set)
  );
}
