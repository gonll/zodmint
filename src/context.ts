import type { Session } from "./session.js";

export type GenerationMode = "realistic" | "edge" | "random";

export interface SeededRNG {
  /** Returns a float in [0, 1) */
  next(): number;
  /** Returns an integer in [min, max] inclusive */
  nextInt(min: number, max: number): number;
  /** Returns a float in [min, max) */
  nextFloat(min: number, max: number): number;
  /** Picks a random element from an array */
  pick<T>(arr: readonly T[]): T;
  /** Returns true with given probability (0–1) */
  bool(probability?: number): boolean;
}

/**
 * Internal generation context — never exported as public API.
 * Passed through every generator call.
 */
export interface GenerationContext {
  /** Path segments to current node, e.g. ["user", "addresses", "*", "zipCode"] */
  path: string[];
  depth: number;
  maxDepth: number;
  rng: SeededRNG;
  mode: GenerationMode;
  useDefaults: boolean;
  /** Path-based generator overrides, keyed by dot-joined path (e.g. "user.address.zip") */
  generators: Record<string, () => unknown>;
  /** Maximum number of generate-and-test attempts for z.refine() / z.superRefine() schemas */
  refinementRetries: number;
  /** Optional session for coordinating state across calls and into matchers */
  session?: Session;
  /** Paths to intentionally violate. When the current path matches, generateViolation() is used. */
  violatePaths: Set<string>;
}

/** mulberry32 seeded PRNG */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** xoshiro128** — good distribution, no seed needed */
function xoshiro128ss(): () => number {
  // Random initial state using Math.random() seeding
  let a = (Math.random() * 0xffffffff) >>> 0;
  let b = (Math.random() * 0xffffffff) >>> 0;
  let c = (Math.random() * 0xffffffff) >>> 0;
  let d = (Math.random() * 0xffffffff) >>> 0;
  return function () {
    const t = b << 9;
    let r = a * 5;
    r = (((r << 7) | (r >>> 25)) * 9) >>> 0;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return (r >>> 0) / 4294967296;
  };
}

function makeRNG(raw: () => number): SeededRNG {
  return {
    next: raw,
    nextInt(min, max) {
      return Math.floor(raw() * (max - min + 1)) + min;
    },
    nextFloat(min, max) {
      return raw() * (max - min) + min;
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(raw() * arr.length)]!;
    },
    bool(probability = 0.5) {
      return raw() < probability;
    },
  };
}

export function createSeededRNG(seed: number): SeededRNG {
  return makeRNG(mulberry32(seed));
}

export function createRandomRNG(): SeededRNG {
  return makeRNG(xoshiro128ss());
}

export function childCtx(
  ctx: GenerationContext,
  key: string,
): GenerationContext {
  return {
    ...ctx,
    path: [...ctx.path, key],
    depth: ctx.depth + 1,
  };
}

export function arrayItemCtx(ctx: GenerationContext): GenerationContext {
  return {
    ...ctx,
    path: [...ctx.path, "*"],
    depth: ctx.depth + 1,
  };
}
