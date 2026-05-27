#!/usr/bin/env node
/**
 * zodmint CLI — generate fixture JSON from Zod schemas without a test harness.
 *
 * Usage:
 *   zodmint gen <file> [options]
 *
 * Options:
 *   --schema <name>   Schema export name to use (required if multiple exports found)
 *   --count <n>       Number of fixtures to generate (default: 1)
 *   --seed <n>        Seed for deterministic output
 *   --mode <mode>     realistic | edge | random (default: realistic)
 *   --compact         Compact JSON output (default: pretty-printed)
 *   --help, -h        Show this help
 *
 * Examples:
 *   zodmint gen ./src/schemas/user.ts --schema UserSchema
 *   zodmint gen ./schemas/post.ts --count 5 --seed 42 --mode edge
 *   zodmint gen ./schemas/order.ts --schema OrderSchema --compact
 *
 * TypeScript files:
 *   The CLI imports schema files via Node's native module loader (JS only).
 *   For TypeScript source files, run through tsx or ts-node:
 *     npx tsx ./node_modules/.bin/zodmint gen ./src/schemas/user.ts
 *   Or add a script in package.json:
 *     "gen": "tsx ./node_modules/.bin/zodmint gen"
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { mock, mockList } from "./mock.js";
import type { GenerationMode } from "./context.js";

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const HELP = `
zodmint gen — generate fixture JSON from Zod schemas

Usage:
  zodmint gen <file> [options]

Options:
  --schema <name>   Schema export name (required if multiple found)
  --count <n>       Number of fixtures (default: 1)
  --seed <n>        Seed for deterministic output
  --mode <mode>     realistic | edge | random (default: realistic)
  --compact         Compact JSON output
  --help, -h        Show this help

Examples:
  zodmint gen ./src/schemas/user.ts --schema UserSchema
  zodmint gen ./schemas/order.ts --count 3 --seed 42
  zodmint gen ./schemas/post.ts --mode edge --compact
`.trim();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const [subcommand, ...rest] = argv;

  if (subcommand !== "gen") {
    console.error(
      `Unknown command "${subcommand}". Did you mean: zodmint gen <file>?`,
    );
    process.exit(1);
  }

  // Parse positional + flags
  const parsed = parseArgs(rest);

  if (parsed.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!parsed.file) {
    console.error("Error: missing <file> argument.\n\n" + HELP);
    process.exit(1);
  }

  // Resolve the schema file
  const filePath = path.resolve(parsed.file);
  let mod: Record<string, unknown>;

  try {
    mod = (await import(pathToFileURL(filePath).href)) as Record<
      string,
      unknown
    >;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.includes("Unknown file extension") ||
      msg.includes("ERR_UNKNOWN_FILE_EXTENSION")
    ) {
      console.error(
        `Error: Cannot import TypeScript file directly.\n` +
          `Run the CLI through tsx:\n\n` +
          `  npx tsx ${process.argv[1]} gen ${parsed.file} ${rest.slice(1).join(" ")}\n\n` +
          `Or add to package.json scripts:\n` +
          `  "gen": "tsx ./node_modules/.bin/zodmint gen"`,
      );
    } else {
      console.error(`Error loading "${filePath}":\n${msg}`);
    }
    process.exit(1);
  }

  // Find Zod schemas
  const schemas = findSchemas(mod);

  if (schemas.length === 0) {
    console.error(
      `No Zod schemas found in "${filePath}".\n` +
        `Make sure your schemas are exported named exports.`,
    );
    process.exit(1);
  }

  // Resolve target schema
  let targetSchema: z.ZodTypeAny;
  let targetName: string;

  if (parsed.schema) {
    const found = schemas.find(([name]) => name === parsed.schema);
    if (!found) {
      const available = schemas.map(([n]) => n).join(", ");
      console.error(
        `Schema "${parsed.schema}" not found in "${filePath}".\n` +
          `Available: ${available}`,
      );
      process.exit(1);
    }
    [targetName, targetSchema] = found;
  } else if (schemas.length === 1) {
    [targetName, targetSchema] = schemas[0];
  } else {
    const names = schemas.map(([n]) => n).join(", ");
    console.error(
      `Multiple schemas found: ${names}\n` +
        `Specify one with --schema <name>`,
    );
    process.exit(1);
  }

  // Validate mode
  const validModes: GenerationMode[] = ["realistic", "edge", "random"];
  const mode: GenerationMode = (parsed.mode as GenerationMode) ?? "realistic";
  if (!validModes.includes(mode)) {
    console.error(
      `Unknown mode "${mode}". Valid: ${validModes.join(", ")}`,
    );
    process.exit(1);
  }

  // Generate
  const count = parsed.count ?? 1;
  const seed = parsed.seed;

  let result: unknown;

  try {
    if (count === 1) {
      result = mock(targetSchema, { seed, mode });
    } else {
      result = mockList(targetSchema, { count, seed, mode });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Generation failed for "${targetName}":\n${msg}`);
    process.exit(1);
  }

  const indent = parsed.compact ? undefined : 2;
  console.log(JSON.stringify(result, jsonReplacer, indent));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedArgs {
  file?: string;
  schema?: string;
  count?: number;
  seed?: number;
  mode?: string;
  compact: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { compact: false, help: false };
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--compact":
        out.compact = true;
        break;
      case "--schema":
        out.schema = args[++i];
        break;
      case "--count": {
        const n = parseInt(args[++i], 10);
        if (isNaN(n) || n < 1) {
          console.error(`--count must be a positive integer (got "${args[i]}")`);
          process.exit(1);
        }
        out.count = n;
        break;
      }
      case "--seed": {
        const s = parseInt(args[++i], 10);
        if (isNaN(s)) {
          console.error(`--seed must be an integer (got "${args[i]}")`);
          process.exit(1);
        }
        out.seed = s;
        break;
      }
      case "--mode":
        out.mode = args[++i];
        break;
      default:
        if (!arg.startsWith("-") && !out.file) {
          out.file = arg;
        } else if (arg.startsWith("--")) {
          console.error(`Unknown option "${arg}". Use --help for usage.`);
          process.exit(1);
        }
    }
    i++;
  }

  return out;
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return (
    value !== null &&
    typeof value === "object" &&
    "_def" in value &&
    typeof (value as Record<string, unknown>).safeParse === "function"
  );
}

function findSchemas(
  mod: Record<string, unknown>,
): [string, z.ZodTypeAny][] {
  return Object.entries(mod).filter(([, v]) => isZodSchema(v)) as [
    string,
    z.ZodTypeAny,
  ][];
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString() + "n";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Set) return Array.from(value as Set<unknown>);
  if (value instanceof Map)
    return Object.fromEntries(value as Map<string, unknown>);
  return value;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
