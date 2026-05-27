/**
 * zodmint/pin — snapshot-style fixture pinning.
 *
 * mockPin() generates a fixture from a schema + seed and locks it to a JSON
 * file. On subsequent calls it reads from the file, keeping test data stable
 * across semantic-inference changes or matcher updates.
 *
 * Set ZODMINT_UPDATE_PINS=1 (or pass { update: true }) to regenerate.
 *
 * @example
 * // First run: generates and writes __zodmint__/user-42.json
 * // Subsequent runs: reads from file
 * const user = mockPin(UserSchema, 42)
 *
 * @example
 * // Custom label and directory
 * const post = mockPin(PostSchema, 1, {
 *   label: 'featured-post',
 *   dir: 'tests/__fixtures__',
 * })
 * // → tests/__fixtures__/featured-post-1.json
 *
 * @example
 * // Fully explicit path
 * const item = mockPin(ItemSchema, 7, { file: 'tests/fixtures/item.json' })
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { mock } from "./mock.js";
import { ZodForgeError } from "./errors.js";
import type { MockOptions } from "./config.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PinOptions<S extends z.ZodTypeAny> = Omit<MockOptions<S>, "seed"> & {
  /**
   * Human-readable label used in the default filename.
   * Default filename: `<label>-<seed>.json` inside `dir`.
   * Falls back to `"pin"` if omitted.
   */
  label?: string;

  /**
   * Directory to store pin files.
   * @default "__zodmint__"
   */
  dir?: string;

  /**
   * Explicit file path (overrides label + dir).
   */
  file?: string;

  /**
   * Force regeneration even if a pin file already exists.
   * Also honoured via the ZODMINT_UPDATE_PINS=1 env var.
   * @default false
   */
  update?: boolean;
};

// ---------------------------------------------------------------------------
// Serialisation helpers — handle non-JSON-native types
// ---------------------------------------------------------------------------

/**
 * Pre-walk the value tree and encode non-JSON-native types BEFORE calling
 * JSON.stringify. This avoids Date.prototype.toJSON() firing prematurely
 * (which converts Date → string before the replacer sees it).
 */
function prepareForJSON(value: unknown): unknown {
  // Encode special types with tagged objects
  if (typeof value === "bigint") return { __zodmint_bigint: value.toString() };
  if (value instanceof Date) return { __zodmint_date: value.toISOString() };
  if (value instanceof Set)
    return { __zodmint_set: Array.from(value as Set<unknown>).map(prepareForJSON) };
  if (value instanceof Map)
    return {
      __zodmint_map: Array.from((value as Map<unknown, unknown>).entries()).map(
        ([k, v]) => [prepareForJSON(k), prepareForJSON(v)],
      ),
    };
  if (Array.isArray(value)) return value.map(prepareForJSON);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = prepareForJSON(v);
    }
    return out;
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ("__zodmint_bigint" in obj) return BigInt(obj.__zodmint_bigint as string);
    if ("__zodmint_date" in obj) return new Date(obj.__zodmint_date as string);
    if ("__zodmint_set" in obj) return new Set(obj.__zodmint_set as unknown[]);
    if ("__zodmint_map" in obj)
      return new Map(obj.__zodmint_map as [unknown, unknown][]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// mockPin
// ---------------------------------------------------------------------------

/**
 * Generates a schema-valid fixture from `seed` and locks it to a JSON file.
 *
 * - **First run**: generates, writes the file, returns the value.
 * - **Subsequent runs**: reads the file, validates it against the current
 *   schema, and returns the value.
 * - **Schema mismatch**: throws `ZodForgeError [INVALID_OVERRIDE]` with a
 *   clear message pointing at the stale pin file.
 *
 * Re-generate with `ZODMINT_UPDATE_PINS=1` or `{ update: true }`.
 */
export function mockPin<S extends z.ZodTypeAny>(
  schema: S,
  seed: number,
  options?: PinOptions<S>,
): z.infer<S> {
  const shouldUpdate =
    options?.update === true || process.env.ZODMINT_UPDATE_PINS === "1";

  // Resolve file path
  const filePath = resolveFilePath(seed, options);

  if (!shouldUpdate && fs.existsSync(filePath)) {
    return readPin(schema, filePath);
  }

  return writePin(schema, seed, filePath, options);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveFilePath(
  seed: number,
  options?: PinOptions<z.ZodTypeAny>,
): string {
  if (options?.file) return options.file;
  const dir = options?.dir ?? "__zodmint__";
  const label = options?.label ?? "pin";
  return path.join(dir, `${label}-${seed}.json`);
}

function readPin<S extends z.ZodTypeAny>(
  schema: S,
  filePath: string,
): z.infer<S> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    throw new ZodForgeError(
      `zodmint/pin: could not read pin file "${filePath}"`,
      "INVALID_OVERRIDE",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw, reviver);
  } catch {
    throw new ZodForgeError(
      `zodmint/pin: pin file "${filePath}" contains invalid JSON. ` +
        `Delete it or run with ZODMINT_UPDATE_PINS=1 to regenerate.`,
      "INVALID_OVERRIDE",
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new ZodForgeError(
      `zodmint/pin: pin file "${filePath}" no longer satisfies the schema.\n` +
        `Run with ZODMINT_UPDATE_PINS=1 or pass { update: true } to regenerate.\n\n` +
        `Validation errors:\n${issues}`,
      "INVALID_OVERRIDE",
    );
  }

  return result.data as z.infer<S>;
}

function writePin<S extends z.ZodTypeAny>(
  schema: S,
  seed: number,
  filePath: string,
  options?: PinOptions<S>,
): z.infer<S> {
  const value = mock(schema, { ...options, seed } as MockOptions<S>);

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const serialized = JSON.stringify(prepareForJSON(value), null, 2);
  fs.writeFileSync(filePath, serialized, "utf-8");

  return value;
}
