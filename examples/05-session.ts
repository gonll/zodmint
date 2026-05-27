/**
 * Sessions — cross-call state threading with createSession() and seq()
 *
 * Run: npx tsx examples/05-session.ts
 */
import { z } from "zod";
import { mock, configure, resetConfig, createSession, seq } from "zodmint";
import type { MatcherContext } from "zodmint";

// ─── Auto-incrementing IDs with seq() ─────────────────────────────────────────

const session = createSession();

configure({
  matchers: [
    {
      pattern: /userId/i,
      generate: (ctx?: MatcherContext) => seq("user", ctx?.session),
    },
  ],
});

const UserSchema = z.object({
  userId: z.number(),
  email: z.string().email(),
  name: z.string(),
});

const user1 = mock(UserSchema, { session });
const user2 = mock(UserSchema, { session });
const user3 = mock(UserSchema, { session });

console.log("user1.userId:", user1.userId); // 1
console.log("user2.userId:", user2.userId); // 2
console.log("user3.userId:", user3.userId); // 3

resetConfig();

// ─── Relational fixtures with session.store ────────────────────────────────────

const orderSession = createSession();

configure({
  matchers: [
    {
      pattern: /orderId/i,
      generate: (ctx?: MatcherContext) => {
        const id = seq("order", ctx?.session);
        return `ORD-${id.toString().padStart(4, "0")}`;
      },
    },
    {
      // Track last generated order ID so it can be referenced in related objects
      pattern: /referenceOrderId/i,
      generate: (ctx?: MatcherContext) => {
        return ctx?.session?.store.get("lastOrderId") ?? null;
      },
    },
    {
      pattern: /orderId/i,
      generate: (ctx?: MatcherContext) => {
        const id = seq("order", ctx?.session);
        const code = `ORD-${id.toString().padStart(4, "0")}`;
        ctx?.session?.store.set("lastOrderId", code);
        return code;
      },
    },
  ],
});

const OrderSchema = z.object({
  orderId: z.string(),
  total: z.number().positive(),
});

const order1 = mock(OrderSchema, { session: orderSession });
const order2 = mock(OrderSchema, { session: orderSession });

console.log("\norder1:", order1); // { orderId: 'ORD-0001', ... }
console.log("order2:", order2); // { orderId: 'ORD-0002', ... }

resetConfig();

// ─── seq() without a session always returns 1 ─────────────────────────────────

console.log("\nseq without session:", seq("x"), seq("x"), seq("x")); // 1 1 1
console.log("seq with session:", seq("x", createSession())); // 1
