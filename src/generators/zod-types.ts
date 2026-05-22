import { z } from "zod";
import { ZodForgeError, formatPath } from "../errors.js";
import {
  type GenerationContext,
  childCtx,
  arrayItemCtx,
} from "../context.js";
import type { GlobalConfig } from "../config.js";
import {
  generateString,
  generateNumber,
  generateBigInt,
  generateDate,
  generateEdgeString,
  generateEdgeNumber,
  generateEdgeBigInt,
  generateEdgeDate,
  type StringConstraints,
  type NumberConstraints,
  type BigIntConstraints,
  type DateConstraints,
} from "./constraints.js";
import { leafKey } from "./semantic.js";
import { applyCustomMatchers } from "./matchers.js";
import {
  isV4,
  rawDef,
  typeName,
  getDescription,
  getChecks,
  getInnerType,
  getShape,
  getLiteralValue,
  getUnionOptions,
  getArrayElement,
  getArrayBounds,
  getLazyGetter,
  getTupleItems,
  getRecordKeyType,
  getValueType,
  getMapKeyType,
  getIntersectionParts,
  getDefaultValue,
  getEnumValues,
  getNativeEnumObject,
  getBrandedInner,
  getEffectsInfo,
  getPipeInputSchema,
  getPipeOutputSchema,
  hasRefinementChecks,
  stripRefinementChecks,
  isV3Refinement,
  getRefinementInner,
  normalizeV4Checks,
} from "../compat.js";
import { createSeededRNG } from "../context.js";

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export function generateValue(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown {
  const leaf = leafKey(ctx.path);
  return dispatch(schema, ctx, config, leaf);
}

function dispatch(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  // Path-based generator override — checked before anything else
  if (Object.keys(ctx.generators).length > 0) {
    const pathKey = ctx.path.join(".");
    const gen = ctx.generators[pathKey];
    if (gen !== undefined) {
      const genValue = gen();
      const check = schema.safeParse(genValue);
      if (!check.success) {
        throw new ZodForgeError(
          `Generator at path "${pathKey}" returned an invalid value: ${JSON.stringify(genValue)}`,
          "INVALID_OVERRIDE",
        );
      }
      return check.data;
    }
  }

  // v4: schema has embedded refinement checks (z.refine() / z.superRefine())
  // Use generate-and-test strategy: strip custom checks, generate candidate, validate with full schema
  if (hasRefinementChecks(schema)) {
    return dispatchRefinement(schema, ctx, config, leaf, true);
  }

  // v3: ZodEffects with effect.type === "refinement"
  if (isV3Refinement(schema)) {
    return dispatchRefinement(schema, ctx, config, leaf, false);
  }

  const tn = typeName(schema);

  switch (tn) {
    case "string":
      return dispatchString(schema, ctx, config, leaf);

    case "number":
      return dispatchNumber(schema, ctx, config, leaf);

    case "bigint":
      return dispatchBigInt(schema, ctx, config);

    case "boolean":
      // Edge mode: false is the boundary value (0-like, truthy guard failures)
      return ctx.mode === "edge" ? false : ctx.rng.bool();

    case "date":
      return dispatchDate(schema, ctx, config);

    case "undefined":
      return undefined;

    case "null":
      return null;

    case "any":
    case "unknown":
      return ctx.rng.pick([
        ctx.rng.next().toString(36),
        ctx.rng.nextInt(-1000, 1000),
        ctx.rng.bool(),
      ]);

    case "never":
      throw new ZodForgeError(
        `z.never() encountered at ${formatPath(ctx.path)}. This type has no valid value.`,
        "UNSUPPORTED_SCHEMA",
      );

    case "nan":
      return NaN;

    case "literal":
      return getLiteralValue(schema);

    case "enum":
      // In v4, both z.enum() and z.nativeEnum() map to "enum".
      // getEnumValues handles both and filters reverse-map keys.
      return ctx.rng.pick(getEnumValues(schema));

    case "nativeEnum":
      // v3 only — z.nativeEnum() in v3
      return dispatchNativeEnum(schema, ctx);

    case "optional":
      return dispatchOptional(schema, ctx, config, leaf);

    case "nullable":
      return dispatchNullable(schema, ctx, config, leaf);

    case "default":
      return dispatchDefault(schema, ctx, config, leaf);

    case "catch":
      // Generate inner schema normally; catch fallback is ignored
      return dispatch(getInnerType(schema), ctx, config, leaf);

    case "array":
      return dispatchArray(schema, ctx, config);

    case "object":
      return dispatchObject(schema, ctx, config);

    case "union":
      return dispatchUnion(schema, ctx, config, leaf);

    case "discriminated_union":
      return dispatchDiscriminatedUnion(schema, ctx, config);

    case "intersection":
      return dispatchIntersection(schema, ctx, config);

    case "tuple":
      return dispatchTuple(schema, ctx, config);

    case "record":
      return dispatchRecord(schema, ctx, config);

    case "map":
      return dispatchMap(schema, ctx, config);

    case "set":
      return dispatchSet(schema, ctx, config);

    case "lazy":
      return dispatchLazy(schema, ctx, config, leaf);

    case "readonly":
      // Readonly wrapper — generate inner type
      return dispatch(getInnerType(schema), ctx, config, leaf);

    case "branded":
      // Brand is ignored — generate underlying type (v3 only; v4 branded maps to its base type)
      return dispatch(getBrandedInner(schema), ctx, config, leaf);

    case "effects": {
      // v3 ZodEffects
      const { effectType, innerSchema } = getEffectsInfo(schema);
      if (effectType === "preprocess") {
        // z.coerce.* in v3 uses preprocess. If the output is a primitive type, generate from it.
        const outType = typeName(innerSchema);
        const coercePrimitives = ["string", "number", "boolean", "bigint", "date"];
        if (coercePrimitives.includes(outType)) {
          return dispatch(innerSchema, ctx, config, leaf);
        }
        throw new ZodForgeError(
          `z.preprocess() is not supported in v1 at ${formatPath(ctx.path)}.`,
          "UNSUPPORTED_SCHEMA",
        );
      }
      // refinement is handled before the switch by the isV3Refinement() guard above.
      // If we somehow reach here with a refinement, fall through to transform handling.
      // transform — generate inner schema (output is produced by safeParse)
      return dispatch(innerSchema, ctx, config, leaf);
    }

    case "transform":
      // Some versions may expose this type explicitly
      throw new ZodForgeError(
        `z.transform() is not supported in v1 at ${formatPath(ctx.path)}.`,
        "UNSUPPORTED_SCHEMA",
      );

    case "pipe": {
      if (!isV4(schema)) {
        // v3 ZodPipeline
        throw new ZodForgeError(
          `z.pipe() is not supported in v1 at ${formatPath(ctx.path)}.`,
          "UNSUPPORTED_SCHEMA",
        );
      }
      // v4: distinguish preprocess/coerce (input is a transform) from .transform() (output is transform)
      const pipeInput = getPipeInputSchema(schema);
      if (typeName(pipeInput) === "transform") {
        // Could be z.coerce.* — if output is a primitive type, generate from output directly.
        // The coerce transform (String, Number, Boolean, …) is a no-op on the correct native type.
        const pipeOut = getPipeOutputSchema(schema);
        const outType = typeName(pipeOut);
        const coercePrimitives = ["string", "number", "boolean", "bigint", "date"];
        if (coercePrimitives.includes(outType)) {
          return dispatch(pipeOut, ctx, config, leaf);
        }
        throw new ZodForgeError(
          `z.preprocess() is not supported in v1 at ${formatPath(ctx.path)}.`,
          "UNSUPPORTED_SCHEMA",
        );
      }
      // .transform() — generate from input schema; transform runs via safeParse
      return dispatch(pipeInput, ctx, config, leaf);
    }

    case "promise": {
      const innerSchema = getInnerType(schema);
      const innerValue = dispatch(innerSchema, ctx, config, leaf);
      return Promise.resolve(innerValue);
    }

    case "symbol":
      throw new ZodForgeError(
        `z.symbol() is not supported in v1 at ${formatPath(ctx.path)}.`,
        "UNSUPPORTED_SCHEMA",
      );

    case "function":
      throw new ZodForgeError(
        `z.function() is not supported at ${formatPath(ctx.path)}.`,
        "UNSUPPORTED_SCHEMA",
      );

    case "void":
      return undefined;

    default:
      throw new ZodForgeError(
        `Unsupported Zod type "${tn}" at ${formatPath(ctx.path)}.`,
        "UNSUPPORTED_SCHEMA",
      );
  }
}

// ---------------------------------------------------------------------------
// Per-type dispatchers
// ---------------------------------------------------------------------------

function dispatchString(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): string {
  // Description takes priority over leaf name for semantic inference
  const description = getDescription(schema);
  const semanticHint = description ?? leaf;

  // Check custom matchers first (against description or leaf) — only in realistic mode
  if (ctx.mode === "realistic") {
    const custom = applyCustomMatchers(semanticHint, config.matchers);
    if (custom !== undefined) return String(custom);
  }

  const c: StringConstraints = {};

  if (isV4(schema)) {
    // v4 / v4-mini: some schemas carry their format on def.format rather than
    // in a checks array (e.g. z.email(), z.ipv4(), z.uuid() in v4-mini; z.ipv4()
    // etc. in regular v4). Map def.format to the appropriate constraint flag.
    const def = rawDef(schema);
    const topFormat = def.format as string | undefined;
    const topCheck = def.check as string | undefined;
    if (topFormat && (topCheck === "string_format" || !getChecks(schema).length)) {
      switch (topFormat) {
        case "email": c.email = true; break;
        case "url": c.url = true; break;
        case "uuid": case "guid": c.uuid = true; break;
        case "cuid": c.cuid = true; break;
        case "cuid2": c.cuid2 = true; break;
        case "ulid": c.ulid = true; break;
        case "nanoid": c.nanoid = true; break;
        case "jwt": c.jwt = true; break;
        case "datetime": c.datetime = true; break;
        case "date": c.dateOnly = true; break;
        case "time": c.timeOnly = true; break;
        case "duration": c.duration = true; break;
        case "ip": c.ip = true; break;
        case "ipv4": c.ipv4 = true; break;
        case "ipv6": c.ipv6 = true; break;
        case "cidrv4": c.cidr = true; break;
        case "cidrv6": c.cidrv6 = true; break;
        case "emoji": c.emoji = true; break;
        case "base64": c.base64 = true; break;
        case "base64url": c.base64url = true; break;
      }
    }

    // v4: checks are sub-schemas with ._zod.def
    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);

    for (const cd of checks) {
      switch (cd.check) {
        case "min_length": c.min = cd.minimum as number; break;
        case "max_length": c.max = cd.maximum as number; break;
        case "length_equals": c.length = cd.length as number; break;
        case "string_format":
          switch (cd.format as string) {
            case "email": c.email = true; break;
            case "url": c.url = true; break;
            case "uuid": c.uuid = true; break;
            case "regex":
              // cd.pattern is a RegExp in v4
              if (cd.pattern instanceof RegExp) c.regex = cd.pattern;
              break;
            case "starts_with":
              // v4 uses prefix/suffix instead of value
              c.startsWith = (cd.prefix ?? cd.value) as string | undefined;
              break;
            case "ends_with":
              c.endsWith = (cd.suffix ?? cd.value) as string | undefined;
              break;
            case "cuid": c.cuid = true; break;
            case "cuid2": c.cuid2 = true; break;
            case "ulid": c.ulid = true; break;
            case "nanoid": c.nanoid = true; break;
            case "jwt": c.jwt = true; break;
            case "datetime": c.datetime = true; break;
            case "date": c.dateOnly = true; break;
            case "time": c.timeOnly = true; break;
            case "duration": c.duration = true; break;
            case "ip": c.ip = true; break;
            case "ipv4": c.ipv4 = true; break;
            case "ipv6": c.ipv6 = true; break;
            case "cidr": c.cidr = true; break;
            case "emoji": c.emoji = true; break;
            case "base64": c.base64 = true; break;
            case "base64url": c.base64url = true; break;
          }
          break;
      }
    }
  } else {
    // v3: checks are plain objects with a 'kind' field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];

    for (const check of checks) {
      switch (check.kind) {
        case "min": c.min = check.value; break;
        case "max": c.max = check.value; break;
        case "length": c.length = check.value; break;
        case "email": c.email = true; break;
        case "url": c.url = true; break;
        case "uuid": c.uuid = true; break;
        case "regex": c.regex = check.regex; break;
        case "startsWith": c.startsWith = check.value; break;
        case "endsWith": c.endsWith = check.value; break;
        case "cuid": c.cuid = true; break;
        case "cuid2": c.cuid2 = true; break;
        case "ulid": c.ulid = true; break;
        case "nanoid": c.nanoid = true; break;
        case "jwt": c.jwt = true; break;
        case "datetime": c.datetime = true; break;
        case "date": c.dateOnly = true; break;
        case "time": c.timeOnly = true; break;
        case "duration": c.duration = true; break;
        case "ip": c.ip = true; break;
        case "ipv4": c.ipv4 = true; break;
        case "ipv6": c.ipv6 = true; break;
        case "cidr": c.cidr = true; break;
        case "emoji": c.emoji = true; break;
        case "base64": c.base64 = true; break;
        case "base64url": c.base64url = true; break;
      }
    }
  }

  if (ctx.mode === "edge") return generateEdgeString(c, ctx.rng);
  // In random mode, skip semantic (name/description) inference — pass null as hint
  const activeHint = ctx.mode === "random" ? null : semanticHint;
  return generateString(c, ctx.rng, ctx.path, activeHint);
}

function dispatchNumber(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): number {
  const semanticHint = getDescription(schema) ?? leaf;
  // Only apply custom matchers and semantic inference in realistic mode
  if (ctx.mode === "realistic") {
    const custom = applyCustomMatchers(semanticHint, config.matchers);
    if (custom !== undefined) return Number(custom);
  }

  const c: NumberConstraints = {};

  if (isV4(schema)) {
    // v4-mini: z.int(), z.float32(), etc. store their format at the top level
    // of def rather than in a checks array.
    const topDef = rawDef(schema);
    if (topDef.check === "number_format") {
      const fmt = topDef.format as string | undefined;
      if (fmt === "safeint" || fmt === "int" || fmt === "int32" || fmt === "int64" ||
          fmt === "uint32" || fmt === "uint64") {
        c.int = true;
      }
      // float32/float64 are just ordinary floats — no special constraint needed
    }

    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);

    for (const cd of checks) {
      switch (cd.check as string) {
        case "greater_than":
          if (cd.inclusive) {
            c.gte = cd.value as number;
            c.min = cd.value as number;
            if ((cd.value as number) > 0) c.positive = true;
            if ((cd.value as number) === 0) c.nonnegative = true;
          } else {
            c.gt = cd.value as number;
            if ((cd.value as number) >= 0) c.positive = true;
          }
          break;
        case "less_than":
          if (cd.inclusive) {
            c.lte = cd.value as number;
            c.max = cd.value as number;
            if ((cd.value as number) < 0) c.negative = true;
            if ((cd.value as number) === 0) c.nonpositive = true;
          } else {
            c.lt = cd.value as number;
            if ((cd.value as number) <= 0) c.negative = true;
          }
          break;
        case "number_format":
          if (cd.format === "safeint" || cd.format === "int") c.int = true;
          if (cd.format === "finite") c.finite = true;
          break;
        case "multiple_of":
          c.multipleOf = cd.value as number;
          break;
      }
    }
  } else {
    // v3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];

    for (const check of checks) {
      switch (check.kind) {
        case "min": c.gte = check.value; c.min = check.value; break;
        case "max": c.lte = check.value; c.max = check.value; break;
        case "int": c.int = true; break;
        case "multipleOf": c.multipleOf = check.value; break;
        case "finite": c.finite = true; break;
      }
    }

    // Handle nonnegative / nonpositive in v3
    for (const check of checks) {
      if (check.kind === "min" && check.value > 0) c.positive = true;
      if (check.kind === "min" && check.value === 0) c.nonnegative = true;
      if (check.kind === "max" && check.value < 0) c.negative = true;
      if (check.kind === "max" && check.value === 0 && check.inclusive === false) c.negative = true;
      if (check.kind === "max" && check.value === 0 && check.inclusive !== false) c.nonpositive = true;
    }
  }

  if (ctx.mode === "edge") return generateEdgeNumber(c);
  // In random mode, skip semantic (name/description) inference — pass null as hint
  const activeHint = ctx.mode === "random" ? null : semanticHint;
  return generateNumber(c, ctx.rng, ctx.path, activeHint);
}

function dispatchBigInt(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  _config: GlobalConfig,
): bigint {
  const c: BigIntConstraints = {};

  if (isV4(schema)) {
    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);

    for (const cd of checks) {
      switch (cd.check as string) {
        case "greater_than":
          if (cd.inclusive) c.min = cd.value as bigint;
          else c.gt = cd.value as bigint;
          break;
        case "less_than":
          if (cd.inclusive) c.max = cd.value as bigint;
          else c.lt = cd.value as bigint;
          break;
        case "multiple_of":
          c.multipleOf = cd.value as bigint;
          break;
      }
    }
  } else {
    // v3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];

    for (const check of checks) {
      switch (check.kind) {
        case "min": c.min = check.value; break;
        case "max": c.max = check.value; break;
        case "multipleOf": c.multipleOf = check.value; break;
      }
    }
  }

  if (ctx.mode === "edge") return generateEdgeBigInt(c);
  return generateBigInt(c, ctx.rng, ctx.path);
}

function dispatchDate(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  _config: GlobalConfig,
): Date {
  const c: DateConstraints = {};

  if (isV4(schema)) {
    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);

    for (const cd of checks) {
      switch (cd.check as string) {
        case "greater_than":
          c.min = new Date(cd.value as string | number);
          break;
        case "less_than":
          c.max = new Date(cd.value as string | number);
          break;
      }
    }
  } else {
    // v3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];

    for (const check of checks) {
      switch (check.kind) {
        case "min": c.min = new Date(check.value); break;
        case "max": c.max = new Date(check.value); break;
      }
    }
  }

  if (ctx.mode === "edge") return generateEdgeDate(c);
  return generateDate(c, ctx.rng, ctx.path);
}

function dispatchNativeEnum(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
): unknown {
  const enumObj = getNativeEnumObject(schema);
  // Native enums can have numeric reverse mappings — only take values that
  // are NOT numeric-string keys pointing to a string (i.e., filter reverse map)
  const values = Object.values(enumObj).filter(
    (v) => typeof v === "string" || typeof enumObj[v as number] !== "string",
  );
  return ctx.rng.pick(values);
}

function dispatchOptional(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  // Edge mode: always produce undefined (the boundary case)
  if (ctx.mode === "edge") return undefined;
  // Decide BEFORE generating inner value
  if (!ctx.rng.bool(0.7)) return undefined;
  const inner = getInnerType(schema);
  return dispatch(inner, ctx, config, leaf);
}

function dispatchNullable(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  // Edge mode: always produce null (the boundary case)
  if (ctx.mode === "edge") return null;
  // Decide BEFORE generating inner value — null 20% of the time, inner value 80%
  if (ctx.rng.bool(0.2)) return null;
  const inner = getInnerType(schema);
  return dispatch(inner, ctx, config, leaf);
}

function dispatchDefault(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  const defaultVal = getDefaultValue(schema);
  if (ctx.useDefaults) {
    return typeof defaultVal === "function" ? (defaultVal as () => unknown)() : defaultVal;
  }
  // Generate dynamically from inner schema
  return dispatch(getInnerType(schema), ctx, config, leaf);
}

function dispatchArray(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown[] {
  const { min, max, exact } = getArrayBounds(schema);
  const exactLen = exact;
  const minLen = exactLen ?? min ?? 1;
  const maxLen = exactLen ?? max ?? 5;

  if (minLen > maxLen) {
    throw new ZodForgeError(
      `Unsatisfiable array constraint at ${formatPath(ctx.path)}: min(${minLen}) > max(${maxLen})`,
      "GENERATION_FAILED",
    );
  }

  // Edge mode: use 0 (empty) if no explicit min, otherwise the min
  const edgeLen = min !== undefined ? minLen : 0;
  const len = exactLen !== undefined ? exactLen : ctx.mode === "edge" ? edgeLen : ctx.rng.nextInt(minLen, maxLen);
  const itemCtx = arrayItemCtx(ctx);
  const element = getArrayElement(schema);

  return Array.from({ length: len }, () => dispatch(element, itemCtx, config, leafKey(itemCtx.path)));
}

function dispatchObject(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): Record<string, unknown> {
  const shape = getShape(schema);
  const result: Record<string, unknown> = {};

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const fieldCtx = childCtx(ctx, key);
    result[key] = dispatch(fieldSchema as z.ZodTypeAny, fieldCtx, config, key);
  }

  // catchall support: if the schema has a catchall that isn't ZodNever,
  // generate 1–3 extra key-value pairs whose values conform to the catchall schema.
  const catchallDef = rawDef(schema).catchall as z.ZodTypeAny | undefined;
  if (catchallDef) {
    const catchallTypeName = typeName(catchallDef);
    const hasCatchall = catchallTypeName !== "never" && catchallTypeName !== "ZodNever";
    if (hasCatchall) {
      // Edge mode: generate 0 extra keys (minimal valid object)
      const extraCount = ctx.mode === "edge" ? 0 : ctx.rng.nextInt(1, 3);
      for (let i = 0; i < extraCount; i++) {
        const key = `extra${i}_${ctx.rng.nextInt(100, 999)}`;
        const valCtx = { ...ctx, path: [...ctx.path, key] };
        result[key] = dispatch(catchallDef, valCtx, config, key);
      }
    }
  }

  return result;
}

function dispatchUnion(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  const options = getUnionOptions(schema);

  // Shuffle to try in random order (each branch at most once)
  const indices = Array.from({ length: options.length }, (_, i) => i);
  shuffleInPlace(indices, ctx.rng);

  for (const idx of indices) {
    try {
      const result = dispatch(options[idx]!, ctx, config, leaf);
      return result;
    } catch {
      // Try next branch
    }
  }

  throw new ZodForgeError(
    `All union branches failed at ${formatPath(ctx.path)}. Could not generate a valid value for any branch.`,
    "GENERATION_FAILED",
  );
}

function dispatchDiscriminatedUnion(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown {
  const options = getUnionOptions(schema);
  const chosen = ctx.rng.pick(options);
  return dispatchObject(chosen, ctx, config);
}

function dispatchIntersection(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown {
  const { left, right } = getIntersectionParts(schema);
  const leftVal = dispatch(left, ctx, config, leafKey(ctx.path));
  const rightVal = dispatch(right, ctx, config, leafKey(ctx.path));

  const merged = deepMergeForIntersection(leftVal, rightVal);

  // Return the merged value directly. The outer pipeline's safeParse call will
  // validate the combined result — calling schema.safeParse here would cause a
  // double-parse, executing any transforms twice in violation of the core invariant.
  return merged;
}

function deepMergeForIntersection(a: unknown, b: unknown): unknown {
  if (isPlainObject(a) && isPlainObject(b)) {
    const result: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      if (isPlainObject(result[k]) && isPlainObject(v)) {
        result[k] = deepMergeForIntersection(result[k], v);
      } else {
        result[k] = v; // B overrides A on scalar conflicts; arrays replace
      }
    }
    return result;
  }
  return b; // scalar or array: B wins
}

function dispatchTuple(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown[] {
  const items = getTupleItems(schema);
  const result: unknown[] = items.map((item, i) => {
    const itemCtx = childCtx(ctx, String(i));
    return dispatch(item, itemCtx, config, leafKey(itemCtx.path));
  });

  // Handle rest element (e.g. z.tuple([z.string()]).rest(z.boolean()))
  const restSchema = rawDef(schema).rest as z.ZodTypeAny | undefined;
  if (restSchema) {
    const restCount = ctx.mode === "edge" ? 0 : ctx.rng.nextInt(1, 3);
    for (let i = 0; i < restCount; i++) {
      const restCtx = { ...ctx, path: [...ctx.path, `${result.length}`] };
      result.push(dispatch(restSchema, restCtx, config, null));
    }
  }

  return result;
}

function dispatchRecord(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): Record<string, unknown> {
  const keyType = getRecordKeyType(schema);
  const valType = getValueType(schema);
  // Edge mode: empty record is a valid boundary value for z.record()
  const count = ctx.mode === "edge" ? 0 : ctx.rng.nextInt(2, 4);
  const result: Record<string, unknown> = {};

  // Generate initial pairs
  for (let i = 0; i < count; i++) {
    const keyCtx = childCtx(ctx, `key${i}`);
    const key = String(dispatch(keyType, keyCtx, config, null));
    const valCtx = childCtx(ctx, key);
    result[key] = dispatch(valType, valCtx, config, leafKey(valCtx.path));
  }

  // Deduplicate: if collisions reduced the key count, retry to fill up to `count`
  const maxRetries = count * 3;
  let retries = 0;
  while (Object.keys(result).length < count && retries < maxRetries) {
    const keyCtx = childCtx(ctx, `keyRetry${retries}`);
    const key = String(dispatch(keyType, keyCtx, config, null));
    if (!(key in result)) {
      const valCtx = childCtx(ctx, key);
      result[key] = dispatch(valType, valCtx, config, leafKey(valCtx.path));
    }
    retries++;
  }

  if (Object.keys(result).length < count) {
    throw new ZodForgeError(
      `Could not generate ${count} unique record keys at ${formatPath(ctx.path)} after ${maxRetries} retries. ` +
        `The key type may have too few distinct values.`,
      "GENERATION_FAILED",
    );
  }

  return result;
}

function getSetOrMapBounds(schema: z.ZodTypeAny): {
  min?: number;
  max?: number;
} {
  if (isV4(schema)) {
    const def = rawDef(schema);
    const checks = (def.checks ?? []) as unknown[];
    let min: number | undefined;
    let max: number | undefined;

    for (const check of checks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = check as any;
      if (!c._zod) continue;
      const cd = c._zod.def;
      if (cd.check === "min_size") min = cd.minimum as number;
      else if (cd.check === "max_size") max = cd.maximum as number;
    }

    return { min, max };
  }

  // v3: Set and Map store bounds as def.minSize / def.maxSize
  const def = rawDef(schema);
  return {
    min: (def.minSize?.value as number | undefined) ?? undefined,
    max: (def.maxSize?.value as number | undefined) ?? undefined,
  };
}

function dispatchMap(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): Map<unknown, unknown> {
  const keyType = getMapKeyType(schema);
  const valType = getValueType(schema);

  const { min, max } = getSetOrMapBounds(schema);
  const minCount = min ?? 2;
  const maxCount = max ?? 4;

  if (minCount > maxCount) {
    throw new ZodForgeError(
      `Unsatisfiable map constraint at ${formatPath(ctx.path)}: min(${minCount}) > max(${maxCount})`,
      "GENERATION_FAILED",
    );
  }

  // Edge mode: use 0 (empty) if no explicit min, otherwise the min
  const edgeCount = min !== undefined ? minCount : 0;
  const target = ctx.mode === "edge" ? edgeCount : ctx.rng.nextInt(minCount, maxCount);
  const map = new Map<unknown, unknown>();

  // Generate extra attempts to account for duplicate keys
  for (let i = 0; map.size < target && i < target * 4; i++) {
    const keyCtx = childCtx(ctx, `mapKey${i}`);
    const key = dispatch(keyType, keyCtx, config, null);
    const valCtx = childCtx(ctx, `mapVal${i}`);
    const val = dispatch(valType, valCtx, config, null);
    map.set(key, val);
  }

  return map;
}

function dispatchSet(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): Set<unknown> {
  const valType = getValueType(schema);

  const { min, max } = getSetOrMapBounds(schema);
  const minCount = min ?? 2;
  const maxCount = max ?? 4;

  if (minCount > maxCount) {
    throw new ZodForgeError(
      `Unsatisfiable set constraint at ${formatPath(ctx.path)}: min(${minCount}) > max(${maxCount})`,
      "GENERATION_FAILED",
    );
  }

  // Edge mode: use 0 (empty) if no explicit min, otherwise the min
  const edgeCount = min !== undefined ? minCount : 0;
  const count = ctx.mode === "edge" ? edgeCount : ctx.rng.nextInt(minCount, maxCount);
  const set = new Set<unknown>();
  const maxAttempts = count * 3;

  // Generate more than needed to get unique values
  for (let i = 0; i < maxAttempts && set.size < count; i++) {
    const itemCtx = arrayItemCtx(ctx);
    const val = dispatch(valType, itemCtx, config, null);
    set.add(val);
  }

  if (set.size < count) {
    throw new ZodForgeError(
      `Could not generate ${count} unique set items at ${formatPath(ctx.path)} after ${maxAttempts} attempts. ` +
        `The value type may have too few distinct values (e.g. z.boolean().min(3)).`,
      "GENERATION_FAILED",
    );
  }

  return set;
}

function dispatchLazy(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  if (ctx.depth >= ctx.maxDepth) {
    // Check what the lazy resolves to
    const getter = getLazyGetter(schema);
    const inner = getter();
    const innerType = typeName(inner);

    // Optional at max depth → undefined
    if (innerType === "optional") return undefined;
    // Array at max depth → []
    if (innerType === "array") return [];
    // Nullable at max depth → null
    if (innerType === "nullable") return null;

    // Required object at max depth → error
    throw new ZodForgeError(
      `Required object at ${formatPath(ctx.path)} exceeded maxDepth of ${ctx.maxDepth}. ` +
        `Increase maxDepth or make the schema optional to allow termination.`,
      "MAX_DEPTH_EXCEEDED",
    );
  }

  const getter = getLazyGetter(schema);
  const inner = getter();
  // The caller's childCtx/arrayItemCtx already incremented depth before reaching
  // dispatchLazy. Do not increment again here — pass ctx directly to avoid
  // double-incrementing and premature MAX_DEPTH_EXCEEDED errors.
  return dispatch(inner, ctx, config, leaf);
}

// ---------------------------------------------------------------------------
// Refinement dispatcher (generate-and-test strategy)
// ---------------------------------------------------------------------------

/**
 * Generates a value for a schema containing refinements by repeatedly
 * generating candidates from the base schema (without refinements) and
 * checking whether they satisfy the full refined schema via safeParse.
 *
 * @param schema  - The full refined schema (used for safeParse validation)
 * @param ctx     - Current generation context (ctx.refinementRetries controls max attempts)
 * @param config  - Global config
 * @param leaf    - Leaf key hint for semantic generation
 * @param isV4Schema - If true, use stripRefinementChecks to get base schema;
 *                     if false, use getRefinementInner (v3 ZodEffects path)
 */
function dispatchRefinement(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
  isV4Schema: boolean,
): unknown {
  const baseSchema = isV4Schema ? stripRefinementChecks(schema) : getRefinementInner(schema);
  const maxAttempts = ctx.refinementRetries;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Derive a new seed from the current RNG so each attempt gets a distinct candidate
    const attemptSeed = ctx.rng.nextInt(0, 2 ** 31);
    const attemptCtx: GenerationContext = {
      ...ctx,
      rng: createSeededRNG(attemptSeed),
    };

    const candidate = dispatch(baseSchema, attemptCtx, config, leaf);
    const result = schema.safeParse(candidate);
    if (result.success) return result.data;
  }

  throw new ZodForgeError(
    `Could not satisfy refinement at ${formatPath(ctx.path)} after ${maxAttempts} attempts. ` +
      `Consider using a path-based generator to provide a valid value directly.`,
    "GENERATION_FAILED",
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Map) && !(v instanceof Set);
}

function shuffleInPlace<T>(arr: T[], rng: { nextInt(min: number, max: number): number }): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

export { dispatch, deepMergeForIntersection, rawDef };
