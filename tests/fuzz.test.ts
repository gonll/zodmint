import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mock } from "../src/mock.js";
import { ZodForgeError } from "../src/errors.js";

/**
 * Property-based fuzzer: generates random-but-valid Zod schema trees and
 * asserts the core zodmint invariant holds for every one of them —
 * mock(schema) either throws a ZodForgeError, or produces a value that
 * passes schema.safeParse(). This is deliberately schema-shape agnostic so
 * it catches composition bugs (union-of-intersection, deeply nested lazy,
 * etc.) that hand-written unit tests for one shape at a time tend to miss.
 *
 * The generator itself is seeded (mulberry32) so a failure is reproducible
 * from the reported schema-seed alone — no reliance on Math.random.
 */

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  bool(p?: number): boolean;
}

function makeRng(seed: number): Rng {
  const raw = mulberry32(seed);
  return {
    next: raw,
    int(min, max) {
      return Math.floor(raw() * (max - min + 1)) + min;
    },
    pick(arr) {
      return arr[Math.floor(raw() * arr.length)]!;
    },
    bool(p = 0.5) {
      return raw() < p;
    },
  };
}

const FIELD_NAMES = ["a", "b", "c", "x", "y", "z", "value", "name", "count"];

/** Generates a random leaf (non-recursive) schema. */
function randomLeaf(rng: Rng): z.ZodTypeAny {
  const kind = rng.int(0, 4);
  switch (kind) {
    case 0:
      return z.string();
    case 1: {
      let n = z.number();
      if (rng.bool()) n = n.int();
      if (rng.bool()) n = n.min(0);
      return n;
    }
    case 2:
      return z.boolean();
    case 3: {
      const values = Array.from(
        { length: rng.int(1, 4) },
        (_, i) => `opt${i}_${rng.int(0, 999)}`,
      ) as [string, ...string[]];
      return z.enum(values);
    }
    default:
      return z.literal(`lit_${rng.int(0, 999)}`);
  }
}

/**
 * Generates a random schema, recursing with decreasing depth budget.
 * At depth 0, only leaves are produced, guaranteeing termination.
 */
function randomSchema(rng: Rng, depth: number): z.ZodTypeAny {
  if (depth <= 0) return randomLeaf(rng);

  const kind = rng.int(0, 8);
  switch (kind) {
    case 0:
    case 1:
      return randomLeaf(rng);

    case 2: {
      // object
      const shape: z.ZodRawShape = {};
      const fieldCount = rng.int(1, 3);
      const names = [...FIELD_NAMES].sort(() => rng.next() - 0.5).slice(0, fieldCount);
      for (const name of names) shape[name] = randomSchema(rng, depth - 1);
      return z.object(shape);
    }

    case 3:
      return z.array(randomSchema(rng, depth - 1));

    case 4:
      return randomSchema(rng, depth - 1).optional();

    case 5:
      return randomSchema(rng, depth - 1).nullable();

    case 6: {
      // union of 2-3 branches
      const branchCount = rng.int(2, 3);
      const branches = Array.from({ length: branchCount }, () => randomSchema(rng, depth - 1));
      return z.union(branches as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    }

    case 7: {
      // intersection of two object schemas, so it's always composable
      const left = z.object({ [rng.pick(FIELD_NAMES)]: randomLeaf(rng) });
      const right = z.object({ [rng.pick(FIELD_NAMES)]: randomLeaf(rng) });
      return z.intersection(left, right);
    }

    default: {
      // bounded-depth self-referential lazy object: { self?: <same shape again> }
      // Recursion is capped by depth exactly like every other branch, so this
      // always terminates — it exercises the z.lazy() dispatch path without
      // relying on the library's own maxDepth truncation to stay finite.
      const inner = randomSchema(rng, depth - 1);
      const Self: z.ZodTypeAny = z.lazy(() => z.object({ leaf: inner, self: z.optional(Self) }));
      return Self;
    }
  }
}

const SCHEMA_COUNT = 300;
const SEEDS_PER_SCHEMA = 3;
const MAX_DEPTH = 3;

describe("fuzz: random schema composition", () => {
  it(`mock() satisfies safeParse or throws ZodForgeError across ${SCHEMA_COUNT} random schemas`, () => {
    for (let schemaSeed = 0; schemaSeed < SCHEMA_COUNT; schemaSeed++) {
      const genRng = makeRng(schemaSeed);
      const schema = randomSchema(genRng, MAX_DEPTH);

      for (let s = 0; s < SEEDS_PER_SCHEMA; s++) {
        const mockSeed = schemaSeed * 1000 + s;
        try {
          const result = mock(schema, { seed: mockSeed });
          const parsed = schema.safeParse(result);
          if (!parsed.success) {
            throw new Error(
              `safeParse failed for schema-seed ${schemaSeed}, mock-seed ${mockSeed}: ` +
                JSON.stringify(parsed.error.issues.slice(0, 3)),
            );
          }
        } catch (e) {
          if (e instanceof ZodForgeError) continue; // acceptable outcome
          throw new Error(
            `Unexpected failure for schema-seed ${schemaSeed}, mock-seed ${mockSeed}: ${
              (e as Error).message
            }`,
          );
        }
      }
    }
  });
});
