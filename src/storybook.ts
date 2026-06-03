/**
 * zodmint/storybook — Storybook argTypes adapter.
 *
 * Zero-dependency utility: no imports from @storybook/*.
 * Maps Zod schemas to Storybook ArgTypes objects for use in story default exports.
 *
 * @example
 * import { zodArgTypes, mockArgs } from "zodmint/storybook";
 *
 * export default {
 *   title: "Components/Button",
 *   argTypes: zodArgTypes(ButtonPropsSchema),
 * };
 *
 * export const Default = {
 *   args: mockArgs(ButtonPropsSchema),
 * };
 */

import { z } from "zod";
import {
  typeName,
  getDescription,
  getInnerType,
  getShape,
  getEnumValues,
  getUnionOptions,
  isV4,
  rawDef,
  getChecks,
  normalizeV4Checks,
} from "./compat.js";
import { mock } from "./mock.js";
import type { MockOptions } from "./config.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single Storybook argType entry */
export interface ZodArgType {
  control: string | { type: string; min?: number; max?: number; step?: number };
  options?: unknown[];
  description?: string;
}

/** The full ArgTypes map — keyed by field name */
export type ZodArgTypes = Record<string, ZodArgType>;

// ---------------------------------------------------------------------------
// Number constraint extraction (min/max for range control)
// ---------------------------------------------------------------------------

function getNumberBounds(schema: z.ZodTypeAny): { min?: number; max?: number } {
  let min: number | undefined;
  let max: number | undefined;

  if (isV4(schema)) {
    const checks = normalizeV4Checks(getChecks(schema));
    for (const cd of checks) {
      if (cd.check === "greater_than") {
        min = cd.inclusive ? (cd.value as number) : (cd.value as number) + Number.EPSILON;
      } else if (cd.check === "less_than") {
        max = cd.inclusive ? (cd.value as number) : (cd.value as number) - Number.EPSILON;
      }
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    for (const check of checks) {
      if (check.kind === "min") min = check.value as number;
      if (check.kind === "max") max = check.value as number;
    }
  }

  return { min, max };
}

// ---------------------------------------------------------------------------
// Single schema → ZodArgType
// ---------------------------------------------------------------------------

function schemaToArgType(schema: z.ZodTypeAny): ZodArgType {
  const description = getDescription(schema);
  const base = buildControl(schema);
  return description ? { ...base, description } : base;
}

function buildControl(schema: z.ZodTypeAny): Omit<ZodArgType, "description"> {
  const tn = typeName(schema);

  switch (tn) {
    case "string":
      return { control: "text" };

    case "number": {
      const { min, max } = getNumberBounds(schema);
      if (min !== undefined && max !== undefined) {
        return { control: { type: "range", min, max } };
      }
      return { control: "number" };
    }

    case "boolean":
      return { control: "boolean" };

    case "date":
      return { control: "date" };

    case "enum":
    case "nativeEnum": {
      const options = getEnumValues(schema);
      return { control: "select", options };
    }

    case "optional":
    case "nullable":
    case "default":
    case "catch":
    case "readonly":
    case "branded":
      return buildControl(getInnerType(schema));

    case "union":
    case "discriminated_union": {
      // Best-effort: generate one mock value per branch as options
      const branches = getUnionOptions(schema);
      const options = branches.map((branch) => {
        try {
          return mock(branch);
        } catch {
          return undefined;
        }
      }).filter((v) => v !== undefined);
      return { control: "select", options };
    }

    case "object":
    case "array":
    case "record":
    case "map":
    case "set":
    case "tuple":
      return { control: "object" };

    case "literal": {
      // A literal is a single option
      const def = rawDef(schema);
      const value = isV4(schema)
        ? (Array.isArray(def.values) ? def.values[0] : def.value)
        : def.value;
      return { control: "select", options: [value] };
    }

    default:
      return { control: "text" };
  }
}

// ---------------------------------------------------------------------------
// Public API: zodArgTypes
// ---------------------------------------------------------------------------

/**
 * Maps a Zod object schema to a Storybook ArgTypes object.
 *
 * If the top-level schema is not a `z.object()`, returns a single-entry map:
 * `{ value: { control: "text" } }`.
 *
 * @example
 * export default {
 *   title: "Components/Button",
 *   argTypes: zodArgTypes(ButtonPropsSchema),
 * };
 */
export function zodArgTypes(schema: z.ZodTypeAny): ZodArgTypes {
  // Unwrap optional/nullable at the top level
  let unwrapped = schema;
  let tn = typeName(unwrapped);
  while (tn === "optional" || tn === "nullable" || tn === "default" || tn === "catch" || tn === "readonly" || tn === "branded") {
    unwrapped = getInnerType(unwrapped);
    tn = typeName(unwrapped);
  }

  if (tn !== "object") {
    // Not an object schema — return a single fallback entry
    return { value: schemaToArgType(schema) };
  }

  const shape = getShape(unwrapped);
  const result: ZodArgTypes = {};

  for (const [key, fieldSchema] of Object.entries(shape)) {
    result[key] = schemaToArgType(fieldSchema as z.ZodTypeAny);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API: mockArgs
// ---------------------------------------------------------------------------

/**
 * Generates a single mock value from the schema using `mock()`.
 * Named `mockArgs` for clarity in Storybook story context.
 *
 * @example
 * export const Default = {
 *   args: mockArgs(ButtonPropsSchema),
 * };
 */
export function mockArgs<S extends z.ZodTypeAny>(
  schema: S,
  options?: MockOptions<S>,
): z.infer<S> {
  return mock(schema, options);
}
