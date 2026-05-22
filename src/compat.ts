/**
 * compat.ts — Zod v3/v4 compatibility layer
 *
 * Provides a unified API for accessing Zod schema internals regardless of
 * whether the installed zod is v3 (schema._def) or v4 (schema._zod.def).
 *
 * Detect v4 via: '_zod' in schema
 */

import { z } from "zod";
import { ZodForgeError } from "./errors.js";

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

/** Returns true if the schema is from Zod v4 */
export function isV4(schema: z.ZodTypeAny): boolean {
  return "_zod" in schema;
}

// ---------------------------------------------------------------------------
// Raw def access
// ---------------------------------------------------------------------------

/** Returns the raw def object (v3: schema._def, v4: schema._zod.def) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rawDef(schema: z.ZodTypeAny): any {
  if (isV4(schema)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (schema as any)._zod.def;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (schema as any)._def;
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

/**
 * Returns the schema's description string, if any.
 * z.string().describe("email") → "email"
 *
 * v3: stored in def.description
 * v4: stored in z.globalRegistry (not in def)
 */
export function getDescription(schema: z.ZodTypeAny): string | undefined {
  if (isV4(schema)) {
    // v4 uses the global registry for metadata set via .describe()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = (z as any).globalRegistry?.get?.(schema) as { description?: string } | undefined;
      return meta?.description ?? undefined;
    } catch {
      return undefined;
    }
  }
  // v3: def.description
  return (rawDef(schema).description as string | undefined) ?? undefined;
}

// ---------------------------------------------------------------------------
// V3 type name mapping
// ---------------------------------------------------------------------------

const V3_TYPE_MAP: Record<string, string> = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBigInt: "bigint",
  ZodBoolean: "boolean",
  ZodDate: "date",
  ZodUndefined: "undefined",
  ZodNull: "null",
  ZodAny: "any",
  ZodUnknown: "unknown",
  ZodNever: "never",
  ZodVoid: "void",
  ZodArray: "array",
  ZodObject: "object",
  ZodUnion: "union",
  ZodDiscriminatedUnion: "discriminated_union",
  ZodIntersection: "intersection",
  ZodTuple: "tuple",
  ZodRecord: "record",
  ZodMap: "map",
  ZodSet: "set",
  ZodLiteral: "literal",
  ZodEnum: "enum",
  ZodNativeEnum: "nativeEnum",
  ZodOptional: "optional",
  ZodNullable: "nullable",
  ZodDefault: "default",
  ZodCatch: "catch",
  ZodLazy: "lazy",
  ZodEffects: "effects",
  ZodReadonly: "readonly",
  ZodBranded: "branded",
  ZodPipeline: "pipe",
  ZodPromise: "promise",
  ZodSymbol: "symbol",
  ZodFunction: "function",
  ZodNaN: "nan",
};

// ---------------------------------------------------------------------------
// Type name normalization
// ---------------------------------------------------------------------------

/**
 * Returns a normalized lowercase type name.
 * - v3: maps ZodXxx → lowercase string using V3_TYPE_MAP
 * - v4: returns def.type directly, except discriminated unions → "discriminated_union"
 */
export function typeName(schema: z.ZodTypeAny): string {
  if (isV4(schema)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = (schema as any)._zod.def;
    const t = def.type as string;
    // Discriminated union is union with a discriminator field
    if (t === "union" && def.discriminator != null) {
      return "discriminated_union";
    }
    return t;
  }
  // v3
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tn = ((schema as any)._def as { typeName?: string }).typeName ?? "";
  return V3_TYPE_MAP[tn] ?? tn;
}

// ---------------------------------------------------------------------------
// Checks access
// ---------------------------------------------------------------------------

/**
 * Returns the checks array for a schema.
 * v3: _def.checks
 * v4: _zod.def.checks — each check is itself a sub-schema with _zod.def
 *
 * Returns a normalized array where each element has a `kind` field (like v3)
 * and additional constraint fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getChecks(schema: z.ZodTypeAny): any[] {
  const def = rawDef(schema);
  if (!def.checks) return [];
  return def.checks;
}

// ---------------------------------------------------------------------------
// Inner type access
// ---------------------------------------------------------------------------

/**
 * Returns the inner/wrapped schema.
 * v3: def.innerType or def.schema (for ZodEffects)
 * v4: def.innerType
 */
export function getInnerType(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = rawDef(schema);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = def.innerType ?? def.schema;
  if (inner === undefined) {
    throw new ZodForgeError(
      `Cannot unwrap schema at path: unexpected schema structure (missing innerType/schema)`,
      "UNSUPPORTED_SCHEMA",
    );
  }
  return inner as z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// Object shape
// ---------------------------------------------------------------------------

/**
 * Returns the object shape.
 * v3: def.shape() (function call)
 * v4: def.shape (plain property)
 */
export function getShape(schema: z.ZodTypeAny): z.ZodRawShape {
  const def = rawDef(schema);
  if (typeof def.shape === "function") {
    return def.shape() as z.ZodRawShape;
  }
  return def.shape as z.ZodRawShape;
}

// ---------------------------------------------------------------------------
// Literal value
// ---------------------------------------------------------------------------

/**
 * Returns the literal value.
 * v3: def.value (single value)
 * v4: first item of def.values (an Array)
 */
export function getLiteralValue(schema: z.ZodTypeAny): unknown {
  const def = rawDef(schema);
  // v4: values is an Array
  if (Array.isArray(def.values)) {
    return def.values[0];
  }
  // v4 (older builds): values is a Set
  if (def.values instanceof Set) {
    const [first] = def.values as Set<unknown>;
    return first;
  }
  // v3: def.value
  return def.value;
}

// ---------------------------------------------------------------------------
// Union options
// ---------------------------------------------------------------------------

/** Returns the union options array */
export function getUnionOptions(schema: z.ZodTypeAny): z.ZodTypeAny[] {
  const def = rawDef(schema);
  return (def.options ?? []) as z.ZodTypeAny[];
}

// ---------------------------------------------------------------------------
// Discriminator
// ---------------------------------------------------------------------------

/** Returns the discriminator key string for discriminated unions */
export function getDiscriminator(schema: z.ZodTypeAny): string {
  const def = rawDef(schema);
  return def.discriminator as string;
}

// ---------------------------------------------------------------------------
// Array element
// ---------------------------------------------------------------------------

/**
 * Returns the array element schema.
 * v3: def.type
 * v4: def.element
 */
export function getArrayElement(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = rawDef(schema);
  // v4 uses 'element', v3 uses 'type'
  return (def.element ?? def.type) as z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// Array bounds
// ---------------------------------------------------------------------------

/**
 * Returns array bounds { min?, max?, exact? }.
 * v3: def.minLength?.value, def.maxLength?.value, def.exactLength?.value
 * v4: stored in def.checks as min_length / max_length checks
 */
export function getArrayBounds(schema: z.ZodTypeAny): {
  min?: number;
  max?: number;
  exact?: number;
} {
  if (isV4(schema)) {
    const def = rawDef(schema);
    const checks = (def.checks ?? []) as unknown[];
    let min: number | undefined;
    let max: number | undefined;
    let exact: number | undefined;

    for (const check of checks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = check as any;
      if (!c._zod) continue;
      const cd = c._zod.def;
      if (cd.check === "min_length") min = cd.minimum as number;
      else if (cd.check === "max_length") max = cd.maximum as number;
      else if (cd.check === "length_equals") exact = cd.length as number;
    }

    return { min, max, exact };
  }

  // v3
  const def = rawDef(schema);
  return {
    min: def.minLength?.value as number | undefined,
    max: def.maxLength?.value as number | undefined,
    exact: def.exactLength?.value as number | undefined,
  };
}

// ---------------------------------------------------------------------------
// Lazy getter
// ---------------------------------------------------------------------------

/** Returns the getter function for a lazy schema */
export function getLazyGetter(schema: z.ZodTypeAny): () => z.ZodTypeAny {
  const def = rawDef(schema);
  return def.getter as () => z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// Tuple items
// ---------------------------------------------------------------------------

/** Returns the tuple items array */
export function getTupleItems(schema: z.ZodTypeAny): z.ZodTypeAny[] {
  const def = rawDef(schema);
  return (def.items ?? []) as z.ZodTypeAny[];
}

// ---------------------------------------------------------------------------
// Record key type
// ---------------------------------------------------------------------------

/** Returns the key schema for a record */
export function getRecordKeyType(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = rawDef(schema);
  return def.keyType as z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// Value type (record, map, set)
// ---------------------------------------------------------------------------

/** Returns the value schema for record/map/set */
export function getValueType(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = rawDef(schema);
  return def.valueType as z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// Map key type
// ---------------------------------------------------------------------------

/** Returns the key schema for a map */
export function getMapKeyType(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = rawDef(schema);
  return def.keyType as z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// Intersection parts
// ---------------------------------------------------------------------------

/** Returns left and right schemas for an intersection */
export function getIntersectionParts(schema: z.ZodTypeAny): {
  left: z.ZodTypeAny;
  right: z.ZodTypeAny;
} {
  const def = rawDef(schema);
  return {
    left: def.left as z.ZodTypeAny,
    right: def.right as z.ZodTypeAny,
  };
}

// ---------------------------------------------------------------------------
// Default value
// ---------------------------------------------------------------------------

/**
 * Returns the default value or factory function.
 * v3: def.defaultValue (may be a function)
 * v4: def.defaultValue (same)
 */
export function getDefaultValue(schema: z.ZodTypeAny): unknown {
  const def = rawDef(schema);
  return def.defaultValue;
}

// ---------------------------------------------------------------------------
// Enum values
// ---------------------------------------------------------------------------

/**
 * Returns an array of enum values.
 * v3: def.values (array of strings)
 * v4: Object.values(def.entries) — covers both z.enum() and z.nativeEnum()
 */
export function getEnumValues(schema: z.ZodTypeAny): unknown[] {
  if (isV4(schema)) {
    const def = rawDef(schema);
    // def.entries is an object mapping key→value
    const entries = def.entries as Record<string, unknown>;
    // Filter out numeric reverse-mapping keys (for numeric enums)
    return Object.values(entries).filter(
      (v) => typeof v === "string" || typeof entries[v as number] !== "string",
    );
  }
  // v3
  const def = rawDef(schema);
  return (def.values ?? []) as unknown[];
}

// ---------------------------------------------------------------------------
// Native enum object
// ---------------------------------------------------------------------------

/**
 * Returns the native enum object for native enum filtering.
 * v3: def.values (the original enum object)
 * v4: def.entries (same purpose)
 */
export function getNativeEnumObject(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = rawDef(schema);
  // v3 uses 'values', v4 uses 'entries'
  return (def.values ?? def.entries ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Branded inner schema
// ---------------------------------------------------------------------------

/**
 * Returns the inner schema for a branded type.
 * v3: def.type
 * v4: def.innerType (but branded in v4 doesn't change type, so we return schema itself)
 */
export function getBrandedInner(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = rawDef(schema);
  // v3: ZodBranded uses def.type
  // v4: branded doesn't wrap — schema is the inner type itself
  return (def.innerType ?? def.type ?? schema) as z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// ZodEffects info (v3 only)
// ---------------------------------------------------------------------------

/** Returns effect type and inner schema for v3 ZodEffects */
export function getEffectsInfo(schema: z.ZodTypeAny): {
  effectType: string;
  innerSchema: z.ZodTypeAny;
} {
  const def = rawDef(schema);
  return {
    effectType: (def.effect as { type: string })?.type ?? "unknown",
    innerSchema: (def.schema ?? def.innerType) as z.ZodTypeAny,
  };
}

// ---------------------------------------------------------------------------
// Pipe/pipeline input and output schemas
// ---------------------------------------------------------------------------

/**
 * Returns the input schema for a pipe/pipeline.
 * v3: ZodPipeline def.in
 * v4: ZodPipe def.in
 */
export function getPipeInputSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = rawDef(schema);
  return def.in as z.ZodTypeAny;
}

/**
 * Returns the output schema for a pipe/pipeline.
 * Used to detect z.coerce.* (pipe where input is transform, output is a primitive).
 * v3: ZodPipeline def.out
 * v4: ZodPipe def.out
 */
export function getPipeOutputSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = rawDef(schema);
  return def.out as z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// Refinement check detection (v4)
// ---------------------------------------------------------------------------

/**
 * Returns true if the v4 schema has any embedded custom/refinement checks.
 * In v4, .refine() embeds checks rather than wrapping in ZodEffects.
 */
export function hasRefinementChecks(schema: z.ZodTypeAny): boolean {
  if (!isV4(schema)) return false;
  const def = rawDef(schema);
  const checks = (def.checks ?? []) as unknown[];
  return checks.some((c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cd = (c as any)?._zod?.def;
    return cd?.check === "custom";
  });
}

// ---------------------------------------------------------------------------
// Normalized checks helper (v4)
// ---------------------------------------------------------------------------

/**
 * Reads a v4 check array and returns a normalized object for use in
 * dispatchString / dispatchNumber / dispatchBigInt / dispatchDate /
 * dispatchArray.
 *
 * Each check in v4 is itself a sub-schema with `._zod.def` containing the
 * constraint details.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeV4Checks(checks: unknown[]): any[] {
  return checks
    .map((c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const check = c as any;
      if (!check._zod) return null;
      return check._zod.def;
    })
    .filter(Boolean);
}
