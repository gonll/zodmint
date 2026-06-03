// coverage.ts — mockAll: boundary-set generation for schema coverage
import { z } from "zod";
import type { MockOptions } from "./config.js";
import { mock } from "./mock.js";
import {
  typeName,
  getChecks,
  isV4,
  normalizeV4Checks,
  rawDef,
  getEnumValues,
  getUnionOptions,
  getInnerType,
  getArrayElement,
  getArrayBounds,
  getLiteralValue,
} from "./compat.js";

/**
 * Returns an array of values that collectively exercise all interesting
 * boundary conditions for the schema. Every value in the array is guaranteed
 * to pass schema.safeParse(value).success === true.
 *
 * The `mode` option is ignored — mockAll always does boundary generation.
 */
export function mockAll<S extends z.ZodTypeAny>(
  schema: S,
  options?: MockOptions<S>,
): Array<z.infer<S>> {
  const tn = typeName(schema);
  const results = coverageForType(schema, tn, options);
  return deduplicate(results) as Array<z.infer<S>>;
}

// ---------------------------------------------------------------------------
// Per-type boundary generation
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverageForType(schema: z.ZodTypeAny, tn: string, options?: MockOptions<any>): unknown[] {
  switch (tn) {
    case "number":
      return coverageNumber(schema, options);
    case "string":
      return coverageString(schema, options);
    case "boolean":
      return [true, false];
    case "enum":
    case "nativeEnum":
      return getEnumValues(schema) as unknown[];
    case "literal": {
      return [getLiteralValue(schema)];
    }
    case "union":
    case "discriminated_union":
      return coverageUnion(schema, options);
    case "optional":
      return coverageOptional(schema, options);
    case "nullable":
      return coverageNullable(schema, options);
    case "array":
      return coverageArray(schema, options);
    case "any":
    case "unknown":
      return [null, 0, "", true, [], {}];
    case "tuple":
    case "object":
    case "record":
    case "intersection":
      return [mock(schema, options)];
    case "default": {
      // unwrap — the default wrapper doesn't change the output type for boundary purposes
      const inner = getInnerType(schema);
      return coverageForType(inner, typeName(inner), options);
    }
    case "readonly":
    case "branded": {
      const inner = getInnerType(schema);
      return coverageForType(inner, typeName(inner), options);
    }
    default:
      // bigint, date, symbol, nan, void, promise, lazy, effects, pipe, etc.
      // Return 2-3 representative values via mock() with different seeds
      return coverageFallback(schema, options);
  }
}

// ---------------------------------------------------------------------------
// number
// ---------------------------------------------------------------------------

interface NumberChecks {
  min?: number;
  max?: number;
  isInt: boolean;
  minInclusive: boolean;
  maxInclusive: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNumberChecks(schema: z.ZodTypeAny): NumberChecks {
  const result: NumberChecks = { isInt: false, minInclusive: true, maxInclusive: true };

  if (isV4(schema)) {
    const def = rawDef(schema);
    // top-level format on v4-mini number
    if (def.format === "safeint" || def.format === "int" || def.format === "int32") {
      result.isInt = true;
    }
    const checks = normalizeV4Checks(getChecks(schema));
    for (const cd of checks) {
      if (cd.check === "number_format" && (cd.format === "safeint" || cd.format === "int" || cd.format === "int32")) {
        result.isInt = true;
      }
      if (cd.check === "greater_than") {
        if (cd.inclusive) {
          result.min = cd.value as number;
          result.minInclusive = true;
        } else {
          // exclusive: effective min is value+ε
          result.min = cd.value as number;
          result.minInclusive = false;
        }
      }
      if (cd.check === "less_than") {
        if (cd.inclusive) {
          result.max = cd.value as number;
          result.maxInclusive = true;
        } else {
          result.max = cd.value as number;
          result.maxInclusive = false;
        }
      }
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    for (const check of checks) {
      if (check.kind === "int") result.isInt = true;
      if (check.kind === "min") {
        result.min = check.value as number;
        result.minInclusive = check.inclusive !== false;
      }
      if (check.kind === "max") {
        result.max = check.value as number;
        result.maxInclusive = check.inclusive !== false;
      }
    }
  }

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverageNumber(schema: z.ZodTypeAny, options?: MockOptions<any>): unknown[] {
  const { min, max, isInt, minInclusive, maxInclusive } = extractNumberChecks(schema);

  const step = isInt ? 1 : 0.5;
  const effectiveMin = min === undefined ? undefined : (minInclusive ? min : min + (isInt ? 1 : Number.EPSILON));
  const effectiveMax = max === undefined ? undefined : (maxInclusive ? max : max - (isInt ? 1 : Number.EPSILON));

  const candidates: number[] = [];

  if (effectiveMin !== undefined && effectiveMax !== undefined) {
    const lo = isInt ? Math.ceil(effectiveMin) : effectiveMin;
    const hi = isInt ? Math.floor(effectiveMax) : effectiveMax;
    candidates.push(lo);
    if (lo + step <= hi) candidates.push(isInt ? lo + 1 : lo + step);
    if (hi - step >= lo) candidates.push(isInt ? hi - 1 : hi - step);
    candidates.push(hi);
    // add 0 if in range
    if (lo <= 0 && 0 <= hi) candidates.push(0);
  } else if (effectiveMin !== undefined) {
    const lo = isInt ? Math.ceil(effectiveMin) : effectiveMin;
    candidates.push(lo);
    if (isInt) {
      candidates.push(lo + 1);
      candidates.push(lo + 10);
    } else {
      candidates.push(lo + step);
      candidates.push(lo + 10);
    }
    if (lo <= 0) candidates.push(0);
  } else if (effectiveMax !== undefined) {
    const hi = isInt ? Math.floor(effectiveMax) : effectiveMax;
    candidates.push(hi);
    if (isInt) {
      candidates.push(hi - 1);
      candidates.push(hi - 10);
    } else {
      candidates.push(hi - step);
      candidates.push(hi - 10);
    }
    if (0 <= hi) candidates.push(0);
  } else {
    // no constraints
    if (isInt) {
      candidates.push(-1, 0, 1);
    } else {
      candidates.push(-1, 0, 1, 0.5);
    }
  }

  // Filter: only values that actually pass safeParse
  return candidates.filter((v) => schema.safeParse(v).success);
}

// ---------------------------------------------------------------------------
// string
// ---------------------------------------------------------------------------

interface StringChecks {
  min?: number;
  max?: number;
  hasFormat: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractStringChecks(schema: z.ZodTypeAny): StringChecks {
  const result: StringChecks = { hasFormat: false };

  if (isV4(schema)) {
    const def = rawDef(schema);
    // v4-mini top-level format
    if (def.format) result.hasFormat = true;

    const checks = normalizeV4Checks(getChecks(schema));
    for (const cd of checks) {
      if (cd.check === "string_format") result.hasFormat = true;
      if (cd.check === "min_length") result.min = cd.minimum as number;
      if (cd.check === "max_length") result.max = cd.maximum as number;
      if (cd.check === "length_equals") { result.min = cd.length as number; result.max = cd.length as number; }
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    const formatKinds = new Set([
      "email", "url", "uuid", "cuid", "cuid2", "ulid", "nanoid", "jwt",
      "datetime", "date", "time", "duration", "ip", "cidr", "emoji", "base64", "base64url",
    ]);
    for (const check of checks) {
      if (formatKinds.has(check.kind)) result.hasFormat = true;
      if (check.kind === "min") result.min = check.value as number;
      if (check.kind === "max") result.max = check.value as number;
      if (check.kind === "length") { result.min = check.value as number; result.max = check.value as number; }
    }
  }

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverageString(schema: z.ZodTypeAny, options?: MockOptions<any>): unknown[] {
  const { min, max, hasFormat } = extractStringChecks(schema);

  if (hasFormat) {
    // Generate 2-3 valid format examples
    return [
      mock(schema, { ...options, seed: (options?.seed ?? 1) }),
      mock(schema, { ...options, seed: (options?.seed ?? 1) + 1 }),
      mock(schema, { ...options, seed: (options?.seed ?? 1) + 2 }),
    ];
  }

  if (min !== undefined || max !== undefined) {
    const lo = min ?? 0;
    const hi = max ?? lo + 10;
    const candidates: string[] = [];

    // length = lo
    candidates.push("a".repeat(lo));
    // length = lo+1 (if <= hi)
    if (lo + 1 <= hi) candidates.push("a".repeat(lo + 1));
    // length = hi-1 (if >= lo)
    if (hi - 1 >= lo) candidates.push("a".repeat(hi - 1));
    // length = hi
    candidates.push("a".repeat(hi));

    // Filter by safeParse
    return candidates.filter((v) => schema.safeParse(v).success);
  }

  // no constraints
  const candidates = ["", "a", "abc"];
  return candidates.filter((v) => schema.safeParse(v).success);
}

// ---------------------------------------------------------------------------
// union
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverageUnion(schema: z.ZodTypeAny, options?: MockOptions<any>): unknown[] {
  const branches = getUnionOptions(schema);
  return branches.map((branch) => mock(branch, options));
}

// ---------------------------------------------------------------------------
// optional
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverageOptional(schema: z.ZodTypeAny, options?: MockOptions<any>): unknown[] {
  const inner = getInnerType(schema);
  const innerValues = coverageForType(inner, typeName(inner), options);
  return [undefined, ...innerValues];
}

// ---------------------------------------------------------------------------
// nullable
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverageNullable(schema: z.ZodTypeAny, options?: MockOptions<any>): unknown[] {
  const inner = getInnerType(schema);
  const innerValues = coverageForType(inner, typeName(inner), options);
  return [null, ...innerValues];
}

// ---------------------------------------------------------------------------
// array
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverageArray(schema: z.ZodTypeAny, options?: MockOptions<any>): unknown[] {
  const elementSchema = getArrayElement(schema);
  const { min, max, exact } = getArrayBounds(schema);

  if (exact !== undefined) {
    // Only one valid length
    const arr = Array.from({ length: exact }, (_, i) =>
      mock(elementSchema, { ...options, seed: options?.seed !== undefined ? options.seed + i : undefined }),
    );
    return [arr];
  }

  const lo = min ?? 0;
  const hi = max;

  const makeArr = (len: number): unknown[] =>
    Array.from({ length: len }, (_, i) =>
      mock(elementSchema, { ...options, seed: options?.seed !== undefined ? options.seed + i : undefined }),
    );

  const candidates: unknown[][] = [];

  // Empty array (if valid)
  if (lo === 0) candidates.push([]);

  // Single-item array
  if (lo <= 1 && (hi === undefined || hi >= 1)) candidates.push(makeArr(1));

  // Two-item array
  if (lo <= 2 && (hi === undefined || hi >= 2)) candidates.push(makeArr(2));

  // Min-length array (if not already covered)
  if (lo > 2) candidates.push(makeArr(lo));

  // Max-length array (if bounded and not already covered)
  if (hi !== undefined && hi > 2 && hi !== lo) candidates.push(makeArr(hi));

  return candidates.filter((v) => schema.safeParse(v).success);
}

// ---------------------------------------------------------------------------
// fallback: 2-3 mock() calls with different seeds
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverageFallback(schema: z.ZodTypeAny, options?: MockOptions<any>): unknown[] {
  const baseSeed = options?.seed ?? 1;
  return [
    mock(schema, { ...options, seed: baseSeed }),
    mock(schema, { ...options, seed: baseSeed + 1 }),
    mock(schema, { ...options, seed: baseSeed + 2 }),
  ];
}

// ---------------------------------------------------------------------------
// Deduplication by JSON.stringify
// ---------------------------------------------------------------------------

function deduplicate(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const v of values) {
    if (v === undefined) {
      // undefined: use a sentinel key so we include it exactly once
      if (!seen.has("__undefined__")) {
        seen.add("__undefined__");
        result.push(undefined);
      }
      continue;
    }
    const key = JSON.stringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }

  return result;
}
