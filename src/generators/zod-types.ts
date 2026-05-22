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
  type StringConstraints,
  type NumberConstraints,
  type BigIntConstraints,
  type DateConstraints,
} from "./constraints.js";
import { leafKey } from "./semantic.js";
import { applyCustomMatchers } from "./matchers.js";

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export function generateValue(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown {
  // 1. Custom matchers take highest priority (after format constraints)
  const leaf = leafKey(ctx.path);

  // Unwrap common wrappers first so inner type determines dispatch
  return dispatch(schema, ctx, config, leaf);
}

function dispatch(
  schema: z.ZodTypeAny,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  const def = schema._def as z.ZodTypeDef & { typeName: z.ZodFirstPartyTypeKind };

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString:
      return dispatchString(schema as z.ZodString, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodNumber:
      return dispatchNumber(schema as z.ZodNumber, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodBigInt:
      return dispatchBigInt(schema as z.ZodBigInt, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return ctx.rng.bool();

    case z.ZodFirstPartyTypeKind.ZodDate:
      return dispatchDate(schema as z.ZodDate, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodUndefined:
      return undefined;

    case z.ZodFirstPartyTypeKind.ZodNull:
      return null;

    case z.ZodFirstPartyTypeKind.ZodAny:
    case z.ZodFirstPartyTypeKind.ZodUnknown:
      return ctx.rng.pick([
        ctx.rng.next().toString(36),
        ctx.rng.nextInt(-1000, 1000),
        ctx.rng.bool(),
      ]);

    case z.ZodFirstPartyTypeKind.ZodNever:
      throw new ZodForgeError(
        `z.never() encountered at ${formatPath(ctx.path)}. This type has no valid value.`,
        "UNSUPPORTED_SCHEMA",
      );

    case z.ZodFirstPartyTypeKind.ZodNaN:
      return NaN;

    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return (def as z.ZodLiteralDef).value;

    case z.ZodFirstPartyTypeKind.ZodEnum:
      return ctx.rng.pick((def as z.ZodEnumDef).values as unknown as unknown[]);

    case z.ZodFirstPartyTypeKind.ZodNativeEnum:
      return dispatchNativeEnum(schema as z.ZodNativeEnum<z.EnumLike>, ctx);

    case z.ZodFirstPartyTypeKind.ZodOptional:
      return dispatchOptional(schema as z.ZodOptional<z.ZodTypeAny>, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodNullable:
      return dispatchNullable(schema as z.ZodNullable<z.ZodTypeAny>, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodDefault:
      return dispatchDefault(schema as z.ZodDefault<z.ZodTypeAny>, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodCatch:
      // Generate inner schema normally; catch fallback is ignored
      return dispatch((def as z.ZodCatchDef<z.ZodTypeAny>).innerType, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodArray:
      return dispatchArray(schema as z.ZodArray<z.ZodTypeAny>, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodObject:
      return dispatchObject(schema as z.ZodObject<z.ZodRawShape>, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodUnion:
      return dispatchUnion(schema as z.ZodUnion<z.ZodUnionOptions>, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return dispatchDiscriminatedUnion(schema as z.ZodDiscriminatedUnion<string, z.ZodDiscriminatedUnionOption<string>[]>, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodIntersection:
      return dispatchIntersection(schema as z.ZodIntersection<z.ZodTypeAny, z.ZodTypeAny>, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodTuple:
      return dispatchTuple(schema as z.ZodTuple, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodRecord:
      return dispatchRecord(schema as z.ZodRecord, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodMap:
      return dispatchMap(schema as z.ZodMap, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodSet:
      return dispatchSet(schema as z.ZodSet, ctx, config);

    case z.ZodFirstPartyTypeKind.ZodLazy:
      return dispatchLazy(schema as z.ZodLazy<z.ZodTypeAny>, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodReadonly:
      // Readonly wrapper — generate inner type
      return dispatch((def as z.ZodReadonlyDef).innerType, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodBranded:
      // Brand is ignored — generate underlying type
      return dispatch((def as z.ZodBrandedDef<z.ZodTypeAny>).type, ctx, config, leaf);

    case z.ZodFirstPartyTypeKind.ZodEffects: {
      const effectsDef = def as z.ZodEffectsDef<z.ZodTypeAny>;
      if (effectsDef.effect.type === "preprocess") {
        throw new ZodForgeError(
          `z.preprocess() is not supported in v1 at ${formatPath(ctx.path)}.`,
          "UNSUPPORTED_SCHEMA",
        );
      }
      // transform or refinement
      if (effectsDef.effect.type === "refinement") {
        throw new ZodForgeError(
          `z.refine()/z.superRefine() is not supported at ${formatPath(ctx.path)}. ` +
            `zod-forge cannot satisfy arbitrary refinement predicates.`,
          "UNSUPPORTED_SCHEMA",
        );
      }
      // transform — generate inner schema (output is produced by safeParse)
      return dispatch(effectsDef.schema, ctx, config, leaf);
    }

    case z.ZodFirstPartyTypeKind.ZodPipeline:
      throw new ZodForgeError(
        `z.pipe() is not supported in v1 at ${formatPath(ctx.path)}.`,
        "UNSUPPORTED_SCHEMA",
      );

    case z.ZodFirstPartyTypeKind.ZodPromise:
      throw new ZodForgeError(
        `z.promise() is not supported at ${formatPath(ctx.path)}. Use mock(innerSchema) directly.`,
        "UNSUPPORTED_SCHEMA",
      );

    case z.ZodFirstPartyTypeKind.ZodSymbol:
      throw new ZodForgeError(
        `z.symbol() is not supported in v1 at ${formatPath(ctx.path)}.`,
        "UNSUPPORTED_SCHEMA",
      );

    case z.ZodFirstPartyTypeKind.ZodFunction:
      throw new ZodForgeError(
        `z.function() is not supported at ${formatPath(ctx.path)}.`,
        "UNSUPPORTED_SCHEMA",
      );

    case z.ZodFirstPartyTypeKind.ZodVoid:
      return undefined;

    default:
      throw new ZodForgeError(
        `Unsupported Zod type "${def.typeName}" at ${formatPath(ctx.path)}.`,
        "UNSUPPORTED_SCHEMA",
      );
  }
}

// ---------------------------------------------------------------------------
// Per-type dispatchers
// ---------------------------------------------------------------------------

function dispatchString(
  schema: z.ZodString,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): string {
  // Check custom matchers first
  const custom = applyCustomMatchers(leaf, config.matchers);
  if (custom !== undefined) return String(custom);

  const checks = (schema._def as z.ZodStringDef).checks;
  const c: StringConstraints = {};

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
      case "datetime": c.datetime = true; break;
      case "ip": c.ip = true; break;
      case "emoji": c.emoji = true; break;
      case "base64": c.base64 = true; break;
      // "includes", "trim", "toLowerCase", "toUpperCase" — ignore for generation
    }
  }

  return generateString(c, ctx.rng, ctx.path, leaf);
}

function dispatchNumber(
  schema: z.ZodNumber,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): number {
  const custom = applyCustomMatchers(leaf, config.matchers);
  if (custom !== undefined) return Number(custom);

  const checks = (schema._def as z.ZodNumberDef).checks;
  const c: NumberConstraints = {};

  for (const check of checks) {
    switch (check.kind) {
      case "min": c.gte = check.value; c.min = check.value; break;
      case "max": c.lte = check.value; c.max = check.value; break;
      case "int": c.int = true; break;
      case "multipleOf": c.multipleOf = check.value; break;
      case "finite": c.finite = true; break;
    }
  }

  // Zod number checks also include gt/gte/lt/lte but they're stored as min/max in older versions
  // Handle nonnegative / nonpositive
  for (const check of checks) {
    if (check.kind === "min" && check.value > 0) c.positive = true;
    if (check.kind === "min" && check.value === 0) c.nonnegative = true;
    if (check.kind === "max" && check.value < 0) c.negative = true;
    if (check.kind === "max" && check.value === 0 && check.inclusive === false) c.negative = true;
    if (check.kind === "max" && check.value === 0 && check.inclusive !== false) c.nonpositive = true;
  }

  return generateNumber(c, ctx.rng, ctx.path, leaf);
}

function dispatchBigInt(
  schema: z.ZodBigInt,
  ctx: GenerationContext,
  _config: GlobalConfig,
): bigint {
  const checks = (schema._def as z.ZodBigIntDef).checks;
  const c: BigIntConstraints = {};

  for (const check of checks) {
    switch (check.kind) {
      case "min": c.min = check.value; break;
      case "max": c.max = check.value; break;
      case "multipleOf": c.multipleOf = check.value; break;
    }
  }

  return generateBigInt(c, ctx.rng, ctx.path);
}

function dispatchDate(
  schema: z.ZodDate,
  ctx: GenerationContext,
  _config: GlobalConfig,
): Date {
  const checks = (schema._def as z.ZodDateDef).checks;
  const c: DateConstraints = {};

  for (const check of checks) {
    switch (check.kind) {
      case "min": c.min = new Date(check.value); break;
      case "max": c.max = new Date(check.value); break;
    }
  }

  return generateDate(c, ctx.rng, ctx.path);
}

function dispatchNativeEnum(
  schema: z.ZodNativeEnum<z.EnumLike>,
  ctx: GenerationContext,
): unknown {
  const enumObj = (schema._def as z.ZodNativeEnumDef).values;
  // Native enums can have numeric reverse mappings — only take values that
  // are NOT numeric-string keys pointing to a string (i.e., filter reverse map)
  const values = Object.values(enumObj).filter(
    (v) => typeof v === "string" || typeof enumObj[v as number] !== "string",
  );
  return ctx.rng.pick(values);
}

function dispatchOptional(
  schema: z.ZodOptional<z.ZodTypeAny>,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  // Decide BEFORE generating inner value
  if (!ctx.rng.bool(0.7)) return undefined;
  const inner = (schema._def as z.ZodOptionalDef).innerType;
  return dispatch(inner, ctx, config, leaf);
}

function dispatchNullable(
  schema: z.ZodNullable<z.ZodTypeAny>,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  // Decide BEFORE generating inner value
  if (!ctx.rng.bool(0.8)) return null;
  const inner = (schema._def as z.ZodNullableDef).innerType;
  return dispatch(inner, ctx, config, leaf);
}

function dispatchDefault(
  schema: z.ZodDefault<z.ZodTypeAny>,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  const def = schema._def as z.ZodDefaultDef;
  if (ctx.useDefaults) {
    // Return the default value
    return typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue;
  }
  // Generate dynamically from inner schema
  return dispatch(def.innerType, ctx, config, leaf);
}

function dispatchArray(
  schema: z.ZodArray<z.ZodTypeAny>,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown[] {
  const def = schema._def as z.ZodArrayDef;
  const exactLen = def.exactLength?.value;
  const minLen = exactLen ?? def.minLength?.value ?? 1;
  const maxLen = exactLen ?? def.maxLength?.value ?? 5;

  if (minLen > maxLen) {
    throw new ZodForgeError(
      `Unsatisfiable array constraint at ${formatPath(ctx.path)}: min(${minLen}) > max(${maxLen})`,
      "GENERATION_FAILED",
    );
  }

  const len = exactLen !== undefined ? exactLen : ctx.rng.nextInt(minLen, maxLen);
  const itemCtx = arrayItemCtx(ctx);

  return Array.from({ length: len }, () => dispatch(def.type, itemCtx, config, leafKey(itemCtx.path)));
}

function dispatchObject(
  schema: z.ZodObject<z.ZodRawShape>,
  ctx: GenerationContext,
  config: GlobalConfig,
): Record<string, unknown> {
  const shape = schema.shape as z.ZodRawShape;
  const result: Record<string, unknown> = {};

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const fieldCtx = childCtx(ctx, key);
    result[key] = dispatch(fieldSchema as z.ZodTypeAny, fieldCtx, config, key);
  }

  return result;
}

function dispatchUnion(
  schema: z.ZodUnion<z.ZodUnionOptions>,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  const options = (schema._def as z.ZodUnionDef).options;

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
  schema: z.ZodDiscriminatedUnion<string, z.ZodDiscriminatedUnionOption<string>[]>,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown {
  const def = schema._def as z.ZodDiscriminatedUnionDef<string>;
  const options = def.options;
  const discriminator = def.discriminator;

  const chosen = ctx.rng.pick(options);
  return dispatchObject(chosen, ctx, config);
}

type ZodDiscriminatedUnionDef<T extends string> = {
  discriminator: T;
  options: z.ZodDiscriminatedUnionOption<T>[];
};

function dispatchIntersection(
  schema: z.ZodIntersection<z.ZodTypeAny, z.ZodTypeAny>,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown {
  const def = schema._def as z.ZodIntersectionDef;
  const left = dispatch(def.left, ctx, config, leafKey(ctx.path));
  const right = dispatch(def.right, ctx, config, leafKey(ctx.path));

  const merged = deepMergeForIntersection(left, right);

  // Validate merged result
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    throw new ZodForgeError(
      `Intersection at ${formatPath(ctx.path)} produced an irreconcilable conflict: ${parsed.error.message}`,
      "GENERATION_FAILED",
    );
  }

  return parsed.data;
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
  schema: z.ZodTuple,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown[] {
  const def = schema._def as z.ZodTupleDef;
  return def.items.map((item, i) => {
    const itemCtx = childCtx(ctx, String(i));
    return dispatch(item as z.ZodTypeAny, itemCtx, config, leafKey(itemCtx.path));
  });
}

function dispatchRecord(
  schema: z.ZodRecord,
  ctx: GenerationContext,
  config: GlobalConfig,
): Record<string, unknown> {
  const def = schema._def as z.ZodRecordDef;
  const count = ctx.rng.nextInt(2, 4);
  const result: Record<string, unknown> = {};

  for (let i = 0; i < count; i++) {
    const keyCtx = childCtx(ctx, `key${i}`);
    const key = String(dispatch(def.keyType, keyCtx, config, null));
    const valCtx = childCtx(ctx, key);
    result[key] = dispatch(def.valueType, valCtx, config, leafKey(valCtx.path));
  }

  return result;
}

function dispatchMap(
  schema: z.ZodMap,
  ctx: GenerationContext,
  config: GlobalConfig,
): Map<unknown, unknown> {
  const def = schema._def as z.ZodMapDef;
  const target = ctx.rng.nextInt(2, 4);
  const map = new Map<unknown, unknown>();

  // Generate extra attempts to account for duplicate keys
  for (let i = 0; map.size < target && i < target * 4; i++) {
    const keyCtx = childCtx(ctx, `mapKey${i}`);
    const key = dispatch(def.keyType, keyCtx, config, null);
    const valCtx = childCtx(ctx, `mapVal${i}`);
    const val = dispatch(def.valueType, valCtx, config, null);
    map.set(key, val);
  }

  return map;
}

function dispatchSet(
  schema: z.ZodSet,
  ctx: GenerationContext,
  config: GlobalConfig,
): Set<unknown> {
  const def = schema._def as z.ZodSetDef;
  const count = ctx.rng.nextInt(2, 4);
  const set = new Set<unknown>();

  // Generate more than needed to get unique values
  for (let i = 0; i < count * 3 && set.size < count; i++) {
    const itemCtx = arrayItemCtx(ctx);
    const val = dispatch(def.valueType, itemCtx, config, null);
    // Only add primitives or stringifiable values that we can dedupe
    set.add(val);
  }

  return set;
}

function dispatchLazy(
  schema: z.ZodLazy<z.ZodTypeAny>,
  ctx: GenerationContext,
  config: GlobalConfig,
  leaf: string | null,
): unknown {
  if (ctx.depth >= ctx.maxDepth) {
    // Check what the lazy resolves to
    const inner = schema._def.getter();
    const innerDef = (inner._def as z.ZodTypeDef & { typeName: z.ZodFirstPartyTypeKind }).typeName;

    // Optional at max depth → undefined
    if (innerDef === z.ZodFirstPartyTypeKind.ZodOptional) return undefined;
    // Array at max depth → []
    if (innerDef === z.ZodFirstPartyTypeKind.ZodArray) return [];
    // Nullable at max depth → null
    if (innerDef === z.ZodFirstPartyTypeKind.ZodNullable) return null;

    // Required object at max depth → error
    throw new ZodForgeError(
      `Required object at ${formatPath(ctx.path)} exceeded maxDepth of ${ctx.maxDepth}. ` +
        `Increase maxDepth or make the schema optional to allow termination.`,
      "MAX_DEPTH_EXCEEDED",
    );
  }

  const inner = schema._def.getter();
  // Depth was already incremented by the caller's childCtx/arrayItemCtx.
  // We increment here specifically for lazy since lazy is the recursion boundary.
  const deeperCtx: GenerationContext = { ...ctx, depth: ctx.depth + 1 };
  return dispatch(inner, deeperCtx, config, leaf);
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

export { dispatch, deepMergeForIntersection };
