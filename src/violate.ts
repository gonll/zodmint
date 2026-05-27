// violate.ts - generates intentionally invalid values for testing error paths
import { z } from "zod";
import {
  typeName,
  getChecks,
  isV4,
  normalizeV4Checks,
  rawDef,
} from "./compat.js";

/** Returns a value guaranteed to fail schema.safeParse(). */
export function generateViolation(schema: z.ZodTypeAny): unknown {
  const tn = typeName(schema);

  switch (tn) {
    case "string":
      return violateString(schema);
    case "number":
      return violateNumber(schema);
    case "boolean":
      return "not-a-boolean";
    case "date":
      return "not-a-date";
    case "bigint":
      return "not-a-bigint";
    case "array":
      return violateArray(schema);
    case "object":
      return "not-an-object";
    case "literal":
      return violateLiteral(schema);
    case "enum":
    case "nativeEnum":
      return "__INVALID_ENUM_VALUE__";
    default:
      // For all other types, null is almost universally invalid for non-nullable schemas
      return null;
  }
}

function violateString(schema: z.ZodTypeAny): unknown {
  // Detect format constraints and violate them specifically
  const checks = getStringChecks(schema);

  if (checks.email) return "not-an-email";
  if (checks.url) return "not-a-url";
  if (checks.uuid) return "not-a-uuid";
  if (checks.min !== undefined && checks.min > 0) {
    // Return a string shorter than the minimum
    return "x".repeat(Math.max(0, checks.min - 1));
  }
  if (checks.max !== undefined) {
    // Return a string longer than the maximum
    return "x".repeat(checks.max + 5);
  }

  // Plain string with no constraints - return wrong type
  return 12345;
}

function violateNumber(schema: z.ZodTypeAny): unknown {
  const checks = getNumberChecks(schema);

  if (checks.int) return 1.5; // violate int constraint
  if (checks.positive) return -1;
  if (checks.negative) return 1;
  if (checks.nonnegative) return -0.1;
  if (checks.nonpositive) return 0.1;
  if (checks.min !== undefined) return checks.min - 1;
  if (checks.max !== undefined) return checks.max + 1;

  // Plain number with no constraints - return wrong type
  return "not-a-number";
}

function violateArray(schema: z.ZodTypeAny): unknown {
  // If there is a min constraint > 0, return too few items
  if (isV4(schema)) {
    const rawChecks = getChecks(schema);
    const checks = normalizeV4Checks(rawChecks);
    for (const cd of checks) {
      if (cd.check === "min_length" && (cd.minimum as number) > 0) return [];
    }
  } else {
    const def = rawDef(schema);
    if (def.minLength?.value > 0) return [];
  }
  // Plain array - return wrong type
  return "not-an-array";
}

function violateLiteral(schema: z.ZodTypeAny): unknown {
  const def = rawDef(schema);
  // v3: def.value, v4: def.values (Array or Set)
  let val: unknown;
  if (Array.isArray(def.values)) {
    val = def.values[0];
  } else if (def.values instanceof Set) {
    const [first] = def.values as Set<unknown>;
    val = first;
  } else {
    val = def.value;
  }
  // Return opposite type
  return typeof val === "string" ? 12345 : "not-the-literal";
}

// Helper: extract string constraint flags
function getStringChecks(schema: z.ZodTypeAny): {
  email?: boolean;
  url?: boolean;
  uuid?: boolean;
  min?: number;
  max?: number;
} {
  const result: { email?: boolean; url?: boolean; uuid?: boolean; min?: number; max?: number } = {};

  if (isV4(schema)) {
    const def = rawDef(schema);
    // Top-level format (v4-mini)
    if (def.format === "email") result.email = true;
    if (def.format === "url") result.url = true;
    if (def.format === "uuid" || def.format === "guid") result.uuid = true;

    const checks = normalizeV4Checks(getChecks(schema));
    for (const cd of checks) {
      if (cd.check === "string_format") {
        if (cd.format === "email") result.email = true;
        if (cd.format === "url") result.url = true;
        if (cd.format === "uuid") result.uuid = true;
      }
      if (cd.check === "min_length") result.min = cd.minimum as number;
      if (cd.check === "max_length") result.max = cd.maximum as number;
      if (cd.check === "length_equals") { result.min = cd.length as number; result.max = cd.length as number; }
    }
  } else {
    // v3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    for (const check of checks) {
      if (check.kind === "email") result.email = true;
      if (check.kind === "url") result.url = true;
      if (check.kind === "uuid") result.uuid = true;
      if (check.kind === "min") result.min = check.value;
      if (check.kind === "max") result.max = check.value;
      if (check.kind === "length") { result.min = check.value; result.max = check.value; }
    }
  }

  return result;
}

// Helper: extract number constraint flags
function getNumberChecks(schema: z.ZodTypeAny): {
  int?: boolean;
  positive?: boolean;
  negative?: boolean;
  nonnegative?: boolean;
  nonpositive?: boolean;
  min?: number;
  max?: number;
} {
  const result: {
    int?: boolean; positive?: boolean; negative?: boolean;
    nonnegative?: boolean; nonpositive?: boolean; min?: number; max?: number;
  } = {};

  if (isV4(schema)) {
    const def = rawDef(schema);
    if (def.check === "number_format") {
      const fmt = def.format as string | undefined;
      if (fmt === "safeint" || fmt === "int" || fmt === "int32") result.int = true;
    }
    const checks = normalizeV4Checks(getChecks(schema));
    for (const cd of checks) {
      if (cd.check === "number_format" && (cd.format === "safeint" || cd.format === "int")) result.int = true;
      if (cd.check === "greater_than") {
        if (cd.inclusive) {
          result.min = cd.value as number;
          if ((cd.value as number) > 0) result.positive = true;
          if ((cd.value as number) === 0) result.nonnegative = true;
        } else {
          if ((cd.value as number) >= 0) result.positive = true;
        }
      }
      if (cd.check === "less_than") {
        if (cd.inclusive) {
          result.max = cd.value as number;
          if ((cd.value as number) < 0) result.negative = true;
          if ((cd.value as number) === 0) result.nonpositive = true;
        } else {
          if ((cd.value as number) <= 0) result.negative = true;
        }
      }
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checks = getChecks(schema) as any[];
    for (const check of checks) {
      if (check.kind === "int") result.int = true;
      if (check.kind === "min") {
        result.min = check.value;
        if (check.value > 0) result.positive = true;
        else if (check.value === 0 && check.inclusive === false) result.positive = true;
        else if (check.value === 0) result.nonnegative = true;
      }
      if (check.kind === "max") {
        result.max = check.value;
        if (check.value < 0) result.negative = true;
        else if (check.value === 0 && check.inclusive === false) result.negative = true;
        else if (check.value === 0) result.nonpositive = true;
      }
    }
  }

  return result;
}
