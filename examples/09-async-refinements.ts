/**
 * Example 09 — Async refinements with mockAsync() and withGenerate()
 *
 * mockAsync() is the async counterpart to mock(). Use it when your schema
 * contains z.superRefine() predicates that return Promises (async refinements).
 *
 * For async refinements that check external state (DB uniqueness, API calls)
 * and cannot be satisfied by random generation, attach a generation hint with
 * withGenerate() to bypass the retry loop entirely.
 */

import { z } from "zod";
import { mockAsync, withGenerate } from "../src/index.js";

// ─── 1. Simple async superRefine ─────────────────────────────────────────────

// mockAsync retries until an even number is generated (probabilistic predicate)
const EvenNumber = z.number().int().min(0).max(100).superRefine(async (val, ctx) => {
  await Promise.resolve(); // simulate async check (e.g. cache lookup)
  if (val % 2 !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be even" });
  }
});

const n = await mockAsync(EvenNumber, { refinementRetries: 50 });
console.log("even number:", n); // e.g. 42

// ─── 2. Async refinement on an object field ───────────────────────────────────

// The field-level async refinement gates on score >= 50.
// We constrain the base range to 50–100 so the predicate is always satisfiable.
const ScoredResult = z.object({
  name: z.string(),
  score: z.number().int().min(50).max(100).superRefine(async (val, ctx) => {
    await Promise.resolve();
    if (val < 50) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be >= 50" });
  }),
});

const result = await mockAsync(ScoredResult, { refinementRetries: 5 });
console.log("scored result:", result); // { name: "...", score: 73 }

// ─── 3. withGenerate() for deterministically unsatisfiable async refinements ──

// Imagine a schema that checks DB uniqueness — brute-force retries will never work.
// withGenerate() attaches a hint factory that bypasses the retry loop.
const UniqueEmail = withGenerate(
  z.string().superRefine(async (val, ctx) => {
    // Simulates an async uniqueness check (in real code this would hit the DB)
    await Promise.resolve();
    if (!val.includes("@")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not an email" });
    }
  }),
  // Hint: always returns a valid email — no retries needed
  () => `user-${Math.random().toString(36).slice(2)}@example.com`,
);

const email = await mockAsync(UniqueEmail);
console.log("unique email:", email); // e.g. user-k3h7x@example.com

// ─── 4. mockAsync + overrides ─────────────────────────────────────────────────

const User = z.object({
  id: z.string().uuid(),
  name: z.string(),
  age: z.number().int().min(18).max(99).superRefine(async (val, ctx) => {
    await Promise.resolve();
    if (val < 18) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be adult" });
  }),
});

const alice = await mockAsync(User, { overrides: { name: "Alice" } });
console.log("user:", alice); // { id: "...", name: "Alice", age: 34 }

// ─── 5. Seeded deterministic generation ───────────────────────────────────────

const schema = z.object({ x: z.number(), label: z.string() });
const a = await mockAsync(schema, { seed: 42 });
const b = await mockAsync(schema, { seed: 42 });
console.log("same seed:", JSON.stringify(a) === JSON.stringify(b)); // true
