/**
 * fast-check integration — property-based testing with real shrinking
 *
 * Run: npx tsx examples/07-fast-check.ts
 * Requires: fast-check >= 3.0.0
 */
import { z } from "zod";
import * as fc from "fast-check";
import { arb } from "zodmint/fast-check";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().int().min(0).max(120),
  score: z.number().min(0).max(100),
  tags: z.array(z.string()).min(1).max(5),
});

// ─── Basic validity property ───────────────────────────────────────────────────

fc.assert(
  fc.property(arb(UserSchema), (user) => {
    return UserSchema.safeParse(user).success;
  }),
);
console.log("All generated users are schema-valid ✓");

// ─── Business logic property ───────────────────────────────────────────────────

function isEligibleForPremium(user: { age: number; score: number }): boolean {
  return user.age >= 18 && user.score >= 50;
}

fc.assert(
  fc.property(arb(UserSchema), (user) => {
    // If eligible, score must be >= 50 and age >= 18
    if (isEligibleForPremium(user)) {
      return user.score >= 50 && user.age >= 18;
    }
    return true;
  }),
);
console.log("Premium eligibility logic is consistent ✓");

// ─── Composing arb() with fc primitives ───────────────────────────────────────

const ProductSchema = z.object({
  id: z.string().uuid(),
  price: z.number().positive(),
  inStock: z.boolean(),
});

// Pair a product with a quantity using fc.tuple
const orderArb = fc.tuple(arb(ProductSchema), fc.integer({ min: 1, max: 100 }));

fc.assert(
  fc.property(orderArb, ([product, qty]) => {
    const total = product.price * qty;
    return total > 0;
  }),
);
console.log("Order totals are always positive ✓");

// ─── Shrinking in action ───────────────────────────────────────────────────────
// When a property fails, fast-check shrinks the input to the minimal failing case.
// This is why arb() returns real Arbitrary instances rather than fc.constant().

const NumberSchema = z.number().int().min(0).max(1000);

try {
  fc.assert(
    fc.property(arb(NumberSchema), (n) => {
      return n < 42; // deliberately wrong
    }),
    { seed: 1 },
  );
} catch (e) {
  // fast-check will report the minimal counterexample (42), not a random large number
  console.log("Shrunk counterexample found (expected: 42):", (e as Error).message.match(/counterexample: \[(\d+)\]/)?.[1]);
}
