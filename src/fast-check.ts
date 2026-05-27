// fast-check.ts - arb(schema) converts Zod schemas to real fc.Arbitrary instances.
// Complex formats and transforms fall back to fc.constant(mock(schema)).

import * as fc from "fast-check";
import { z } from "zod";
import {
  typeName,
  getChecks,
  getInnerType,
  getShape,
  getLiteralValue,
  getUnionOptions,
  getEnumValues,
  getArrayElement,
  getArrayBounds,
  getTupleItems,
  getIntersectionParts,
  getRecordKeyType,
  getValueType,
  getMapKeyType,
  getBrandedInner,
  getLazyGetter,
  isV4,
  rawDef,
  normalizeV4Checks,
} from "./compat.js";
import { deepMerge } from "./merge.js";
import { mock } from "./mock.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Converts a Zod schema to a fast-check Arbitrary with real shrinking support. */
export function arb<S extends z.ZodTypeAny>(schema: S): fc.Arbitrary<z.infer<S>> {
  return arbAny(schema) as fc.Arbitrary<z.infer<S>>;
}

// ---------------------------------------------------------------------------
// Internal dispatcher
// ---------------------------------------------------------------------------

function arbAny(schema: z.ZodTypeAny, lazyDepth = 0): fc.Arbitrary<unknown> {
  const tn = typeName(schema);

  switch (tn) {
    case "string":
      return arbString(schema);

    case "number":
      return arbNumber(schema);

    case "boolean":
      return fc.boolean();

    case "bigint":
      return arbBigInt(schema);

    case "date":
      return arbDate(schema);

    case "literal":
      return fc.constant(getLiteralValue(schema));

    case "enum":
    case "nativeEnum": {
      const values = getEnumValues(schema);
      if (values.length === 0) return fc.constant(undefined);
      return fc.constantFrom(...values);
    }

    case "optional":
      // freq: 3 means roughly 75% chance of value, 25% nil -- close to mock()'s 70/30
      return fc.option(arbAny(getInnerType(schema), lazyDepth), { nil: undefined, freq: 3 });

    case "nullable":
      // freq: 4 means roughly 80% chance of value -- close to mock()'s 80/20
      return fc.option(arbAny(getInnerType(schema), lazyDepth), { nil: null, freq: 4 });

    case "default":
      return arbAny(getInnerType(schema), lazyDepth);

    case "catch":
      return arbAny(getInnerType(schema), lazyDepth);

    case "readonly":
      return arbAny(getInnerType(schema), lazyDepth);

    case "branded":
      return arbAny(getBrandedInner(schema), lazyDepth);

    case "array":
      return arbArray(schema, lazyDepth);

    case "object":
      return arbObject(schema, lazyDepth);

    case "tuple":
      return arbTuple(schema, lazyDepth);

    case "union":
      return arbUnion(schema, lazyDepth);

    case "discriminated_union":
      // Treat the same as union -- fc.oneof over all options
      return arbUnion(schema, lazyDepth);

    case "intersection":
      return arbIntersection(schema, lazyDepth);

    case "record":
      return arbRecord(schema, lazyDepth);

    case "map":
      return arbMap(schema, lazyDepth);

    case "set":
      return arbSet(schema, lazyDepth);

    case "lazy":
      return arbLazy(schema, lazyDepth);

    case "any":
    case "unknown":
      // Generate a mix of primitives for any/unknown
      return fc.oneof(fc.string(), fc.integer(), fc.boolean());

    case "void":
    case "undefined":
      return fc.constant(undefined);

    case "null":
      return fc.constant(null);

    case "nan":
      return fc.constant(NaN);

    case "symbol":
      return fc.constant(Symbol("zodmint-arb"));

    case "promise":
      return arbAny(getInnerType(schema), lazyDepth).map((v) => Promise.resolve(v));

    case "effects": {
      // v3 ZodEffects: may be a transform, preprocess, or refinement.
      // We cannot model transform output domains in fc. Fall back to mock().
      // This loses shrinking on this node but preserves it on parent structures.
      return fc.constant(mock(schema));
    }

    case "pipe": {
      if (!isV4(schema)) {
        // v3 ZodPipeline -- not supported, fall back
        return fc.constant(mock(schema));
      }
      // v4 pipe: distinguish preprocess/coerce from .transform()
      const pipeInput = rawDef(schema).in as z.ZodTypeAny;
      const pipeInputType = typeName(pipeInput);
      if (pipeInputType === "transform") {
        // Could be z.coerce.* -- generate output type directly if it is a primitive
        const pipeOut = rawDef(schema).out as z.ZodTypeAny;
        const outType = typeName(pipeOut);
        const coercePrimitives = ["string", "number", "boolean", "bigint", "date"];
        if (coercePrimitives.includes(outType)) {
          return arbAny(pipeOut, lazyDepth);
        }
        // Complex preprocess output -- fall back to mock()
        return fc.constant(mock(schema));
      }
      // .transform() -- transforms change the output domain in ways fc cannot model.
      // Fall back to zodmint's own generator. This loses shrinking on this node
      // but preserves it on parent structures.
      return fc.constant(mock(schema));
    }

    case "function":
    case "never":
    case "custom":
      // These have no representable values in the fc type system
      return fc.constant(undefined as unknown);

    default:
      // Safe fallback for unknown types
      return fc.constant(mock(schema));
  }
}

// ---------------------------------------------------------------------------
// String
// ---------------------------------------------------------------------------

function arbString(schema: z.ZodTypeAny): fc.Arbitrary<string> {
  // Collect constraints the same way zod-types.ts does
  let format: string | undefined;
  let min: number | undefined;
  let max: number | undefined;
  let length: number | undefined;
  let regex: RegExp | undefined;

  if (isV4(schema)) {
    const def = rawDef(schema);
    const topFormat = def.format as string | undefined;
    const topCheck = def.check as string | undefined;
    if (topFormat && (topCheck === "string_format" || !getChecks(schema).length)) {
      format = topFormat;
    }

    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);

    for (const cd of checks) {
      switch (cd.check) {
        case "min_length": min = cd.minimum as number; break;
        case "max_length": max = cd.maximum as number; break;
        case "length_equals": length = cd.length as number; break;
        case "string_format":
          if (!format) format = cd.format as string;
          if (cd.format === "regex" && cd.pattern instanceof RegExp) {
            regex = cd.pattern;
          }
          break;
      }
    }
  } else {
    // v3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    for (const check of checks) {
      switch (check.kind) {
        case "min": min = check.value; break;
        case "max": max = check.value; break;
        case "length": length = check.value; break;
        case "email": format = "email"; break;
        case "url": format = "url"; break;
        case "uuid": format = "uuid"; break;
        case "regex": regex = check.regex; break;
        case "cuid": format = "cuid"; break;
        case "cuid2": format = "cuid2"; break;
        case "ulid": format = "ulid"; break;
        case "nanoid": format = "nanoid"; break;
        case "jwt": format = "jwt"; break;
        case "datetime": format = "datetime"; break;
        case "date": format = "date"; break;
        case "time": format = "time"; break;
        case "duration": format = "duration"; break;
        case "ip": format = "ip"; break;
        case "ipv4": format = "ipv4"; break;
        case "ipv6": format = "ipv6"; break;
        case "cidr": format = "cidr"; break;
        case "emoji": format = "emoji"; break;
        case "base64": format = "base64"; break;
        case "base64url": format = "base64url"; break;
      }
    }
  }

  // Map format to a native fc arbitrary when possible.
  if (format === "email") {
    // fc.emailAddress() generates RFC 5321 emails with special chars that Zod rejects.
    // Build simple user@domain.tld emails from safe alphanumeric parts instead.
    const alphaLower = fc.stringOf(fc.mapToConstant(
      { num: 26, build: (n) => String.fromCharCode(97 + n) },
      { num: 10, build: (n) => String.fromCharCode(48 + n) },
    ), { minLength: 1, maxLength: 10 });
    const tld = fc.constantFrom("com", "org", "net", "io", "dev");
    return fc.tuple(alphaLower, alphaLower, tld).map(([u, d, t]) => `${u}@${d}.${t}`);
  }
  if (format === "uuid" || format === "guid") return fc.uuid();
  if (format === "url") return fc.webUrl();

  // Complex formats: fc has no native arbitrary for these.
  // Fall back to fc.constant(mock(schema)) -- this loses shrinking on this
  // specific node but is the only correct option for these formats.
  const complexFormats = new Set([
    "cuid", "cuid2", "ulid", "nanoid", "jwt",
    "datetime", "date", "time", "duration",
    "ip", "ipv4", "ipv6", "cidr", "cidrv4", "cidrv6",
    "base64", "base64url", "emoji",
  ]);
  if (format && complexFormats.has(format)) {
    return fc.constant(mock(schema) as string);
  }

  // Regex pattern
  if (regex) {
    // fc.stringMatching generates strings matching the regex with real shrinking
    try {
      return fc.stringMatching(regex) as fc.Arbitrary<string>;
    } catch {
      // If fc does not support the pattern, fall back to filter-based approach.
      // This is still a real arbitrary (not constant), just less efficient.
      return fc.string({ minLength: min ?? 0, maxLength: max ?? 100 }).filter(
        (s) => regex.test(s),
      );
    }
  }

  // Length-constrained plain string
  if (length !== undefined) {
    return fc.string({ minLength: length, maxLength: length });
  }
  if (min !== undefined || max !== undefined) {
    return fc.string({ minLength: min ?? 0, maxLength: max ?? 100 });
  }

  return fc.string();
}

// ---------------------------------------------------------------------------
// Number
// ---------------------------------------------------------------------------

function arbNumber(schema: z.ZodTypeAny): fc.Arbitrary<number> {
  let isInt = false;
  let min: number | undefined;
  let max: number | undefined;
  let gt: number | undefined;
  let lt: number | undefined;
  let multipleOf: number | undefined;

  if (isV4(schema)) {
    const topDef = rawDef(schema);
    if (topDef.check === "number_format") {
      const fmt = topDef.format as string | undefined;
      if (fmt === "safeint" || fmt === "int" || fmt === "int32" || fmt === "int64" ||
          fmt === "uint32" || fmt === "uint64") {
        isInt = true;
      }
    }

    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);

    for (const cd of checks) {
      switch (cd.check as string) {
        case "greater_than":
          if (cd.inclusive) { min = cd.value as number; }
          else { gt = cd.value as number; }
          break;
        case "less_than":
          if (cd.inclusive) { max = cd.value as number; }
          else { lt = cd.value as number; }
          break;
        case "number_format":
          if (cd.format === "safeint" || cd.format === "int") isInt = true;
          break;
        case "multiple_of":
          multipleOf = cd.value as number;
          break;
      }
    }
  } else {
    // v3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    for (const check of checks) {
      switch (check.kind) {
        case "min": min = check.value; break;
        case "max": max = check.value; break;
        case "int": isInt = true; break;
        case "multipleOf": multipleOf = check.value; break;
      }
    }
    // Interpret exclusive min/max from v3 inclusive flags
    for (const check of checks) {
      if (check.kind === "min" && check.inclusive === false) {
        gt = check.value;
        min = undefined;
      }
      if (check.kind === "max" && check.inclusive === false) {
        lt = check.value;
        max = undefined;
      }
    }
  }

  // Resolve effective bounds
  let effectiveMin: number | undefined = min;
  let effectiveMax: number | undefined = max;

  if (gt !== undefined) {
    const exclusiveMin = isInt ? gt + 1 : gt + Number.EPSILON;
    effectiveMin = effectiveMin !== undefined ? Math.max(effectiveMin, exclusiveMin) : exclusiveMin;
  }
  if (lt !== undefined) {
    const exclusiveMax = isInt ? lt - 1 : lt - Number.EPSILON;
    effectiveMax = effectiveMax !== undefined ? Math.min(effectiveMax, exclusiveMax) : exclusiveMax;
  }

  // multipleOf: map integers to multiples
  if (multipleOf !== undefined) {
    const m = multipleOf;
    const lo = effectiveMin !== undefined ? Math.ceil(effectiveMin / m) : -100;
    const hi = effectiveMax !== undefined ? Math.floor(effectiveMax / m) : 100;
    if (isInt) {
      return fc.integer({ min: lo, max: hi }).map((n) => n * m);
    }
    return fc.integer({ min: lo, max: hi }).map((n) => {
      const raw = n * m;
      const precision = (m.toString().split(".")[1] ?? "").length;
      return precision > 0 ? parseFloat(raw.toFixed(precision)) : raw;
    });
  }

  if (isInt) {
    const intMin = effectiveMin !== undefined ? Math.ceil(effectiveMin) : -1000;
    const intMax = effectiveMax !== undefined ? Math.floor(effectiveMax) : 1000;
    return fc.integer({ min: intMin, max: intMax });
  }

  // Float
  if (effectiveMin !== undefined || effectiveMax !== undefined) {
    return fc.double({
      min: effectiveMin ?? -1e6,
      max: effectiveMax ?? 1e6,
      noNaN: true,
      noDefaultInfinity: true,
    });
  }

  return fc.double({ noNaN: true, noDefaultInfinity: true });
}

// ---------------------------------------------------------------------------
// BigInt
// ---------------------------------------------------------------------------

function arbBigInt(schema: z.ZodTypeAny): fc.Arbitrary<bigint> {
  let min: bigint | undefined;
  let max: bigint | undefined;

  if (isV4(schema)) {
    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);
    for (const cd of checks) {
      switch (cd.check as string) {
        case "greater_than":
          min = cd.inclusive ? (cd.value as bigint) : (cd.value as bigint) + 1n;
          break;
        case "less_than":
          max = cd.inclusive ? (cd.value as bigint) : (cd.value as bigint) - 1n;
          break;
      }
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    for (const check of checks) {
      switch (check.kind) {
        case "min": min = check.value; break;
        case "max": max = check.value; break;
      }
    }
  }

  if (min !== undefined || max !== undefined) {
    return fc.bigInt({ min: min ?? -1000n, max: max ?? 1000n });
  }
  return fc.bigInt();
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

function arbDate(schema: z.ZodTypeAny): fc.Arbitrary<Date> {
  let min: Date | undefined;
  let max: Date | undefined;

  if (isV4(schema)) {
    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);
    for (const cd of checks) {
      switch (cd.check as string) {
        case "greater_than":
          min = new Date(cd.value as string | number);
          break;
        case "less_than":
          max = new Date(cd.value as string | number);
          break;
      }
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    for (const check of checks) {
      switch (check.kind) {
        case "min": min = new Date(check.value); break;
        case "max": max = new Date(check.value); break;
      }
    }
  }

  if (min !== undefined || max !== undefined) {
    return fc.date({ min: min ?? new Date(0), max: max ?? new Date() });
  }
  return fc.date();
}

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

function arbArray(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<unknown[]> {
  const { min, max, exact } = getArrayBounds(schema);
  const minLen = exact ?? min ?? 1;
  const maxLen = exact ?? max ?? 5;
  return fc.array(arbAny(getArrayElement(schema), lazyDepth), { minLength: minLen, maxLength: maxLen });
}

// ---------------------------------------------------------------------------
// Object
// ---------------------------------------------------------------------------

function arbObject(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<Record<string, unknown>> {
  const shape = getShape(schema);
  const fieldArbs: Record<string, fc.Arbitrary<unknown>> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    fieldArbs[key] = arbAny(fieldSchema as z.ZodTypeAny, lazyDepth);
  }
  return fc.record(fieldArbs);
}

// ---------------------------------------------------------------------------
// Tuple
// ---------------------------------------------------------------------------

function arbTuple(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<unknown[]> {
  const items = getTupleItems(schema);
  const restSchema = rawDef(schema).rest as z.ZodTypeAny | undefined;

  const fixedArbs = items.map((item) => arbAny(item as z.ZodTypeAny, lazyDepth));

  if (restSchema) {
    // Generate 0–3 rest elements appended after the fixed items
    const restArb = fc.array(arbAny(restSchema, lazyDepth), { minLength: 0, maxLength: 3 });
    if (fixedArbs.length === 0) {
      return restArb;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fixedArb = (fc.tuple as any)(...fixedArbs) as fc.Arbitrary<unknown[]>;
    return fc.tuple(fixedArb, restArb).map(([fixed, rest]) => [...fixed, ...rest]);
  }

  if (items.length === 0) return fc.constant([]);
  // fc.tuple requires at least one element and returns a typed tuple
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fc.tuple as any)(...fixedArbs) as fc.Arbitrary<unknown[]>;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

function arbUnion(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<unknown> {
  const options = getUnionOptions(schema);
  if (options.length === 0) return fc.constant(undefined);
  const arbs = options.map((opt) => arbAny(opt as z.ZodTypeAny, lazyDepth));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fc.oneof as any)(...arbs) as fc.Arbitrary<unknown>;
}

// ---------------------------------------------------------------------------
// Intersection
// ---------------------------------------------------------------------------

function arbIntersection(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<unknown> {
  const { left, right } = getIntersectionParts(schema);
  return fc.tuple(arbAny(left, lazyDepth), arbAny(right, lazyDepth)).map(
    ([a, b]) => deepMerge(a as object, b as object),
  );
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

function arbRecord(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<Record<string, unknown>> {
  const keySchema = getRecordKeyType(schema);
  const valSchema = getValueType(schema);
  const keyType = typeName(keySchema);

  // fc.dictionary requires string keys -- if the key schema is not string-compatible,
  // fall back to fc.constant(mock(schema))
  const stringCompatible = keyType === "string" || keyType === "enum" || keyType === "nativeEnum" || keyType === "literal";
  if (!stringCompatible) {
    // Non-string key type -- cannot map to fc.dictionary
    return fc.constant(mock(schema) as Record<string, unknown>);
  }

  return fc.dictionary(
    arbAny(keySchema, lazyDepth) as fc.Arbitrary<string>,
    arbAny(valSchema, lazyDepth),
  );
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function arbMap(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<Map<unknown, unknown>> {
  const keySchema = getMapKeyType(schema);
  const valSchema = getValueType(schema);

  // Read size constraints from the schema
  let min: number | undefined;
  let max: number | undefined;
  if (isV4(schema)) {
    const def = rawDef(schema);
    const checks = (def.checks ?? []) as unknown[];
    for (const check of checks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = check as any;
      if (!c._zod) continue;
      const cd = c._zod.def;
      if (cd.check === "min_size") min = cd.minimum as number;
      else if (cd.check === "max_size") max = cd.maximum as number;
    }
  } else {
    const def = rawDef(schema);
    min = (def.minSize?.value as number | undefined) ?? undefined;
    max = (def.maxSize?.value as number | undefined) ?? undefined;
  }
  const minCount = min ?? 2;
  const maxCount = max ?? Math.max(minCount, 4);

  // Use fc.uniqueArray with a key selector so duplicate keys can't shrink the Map below minCount.
  // Plain fc.array can produce duplicate keys which collapse when inserted into the Map.
  const entryArb = fc.tuple(
    arbAny(keySchema, lazyDepth),
    arbAny(valSchema, lazyDepth),
  ) as fc.Arbitrary<[unknown, unknown]>;

  return fc
    .uniqueArray(entryArb, {
      minLength: minCount,
      maxLength: maxCount,
      selector: (entry) => entry[0],
    })
    .map((entries) => new Map(entries));
}

// ---------------------------------------------------------------------------
// Set
// ---------------------------------------------------------------------------

function arbSet(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<Set<unknown>> {
  const valSchema = getValueType(schema);

  // Read size constraints from the schema
  let min: number | undefined;
  let max: number | undefined;
  if (isV4(schema)) {
    const def = rawDef(schema);
    const checks = (def.checks ?? []) as unknown[];
    for (const check of checks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = check as any;
      if (!c._zod) continue;
      const cd = c._zod.def;
      if (cd.check === "min_size") min = cd.minimum as number;
      else if (cd.check === "max_size") max = cd.maximum as number;
    }
  } else {
    const def = rawDef(schema);
    min = (def.minSize?.value as number | undefined) ?? undefined;
    max = (def.maxSize?.value as number | undefined) ?? undefined;
  }
  const minCount = min ?? 2;
  const maxCount = max ?? Math.max(minCount, 4);

  // Use fc.uniqueArray so that after converting to a Set the size constraint is preserved.
  // Plain fc.array can produce duplicates which shrink the effective Set size below minCount.
  return fc
    .uniqueArray(arbAny(valSchema, lazyDepth), { minLength: minCount, maxLength: maxCount })
    .map((arr) => new Set(arr));
}

// ---------------------------------------------------------------------------
// Lazy
// ---------------------------------------------------------------------------

const MAX_LAZY_DEPTH = 3;

// lazyDepth is passed as a parameter (not module-level state) so that concurrent
// or interleaved arb() calls don't corrupt each other's recursion counter.
function arbLazy(schema: z.ZodTypeAny, lazyDepth: number): fc.Arbitrary<unknown> {
  if (lazyDepth >= MAX_LAZY_DEPTH) {
    // Prevent infinite recursion for self-referential schemas.
    // Fall back to zodmint's depth-limited generator at this node.
    return fc.constant(mock(schema));
  }

  const getter = getLazyGetter(schema);
  const inner = getter();
  return arbAny(inner, lazyDepth + 1);
}
