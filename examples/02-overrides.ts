/**
 * Overrides and generation modes
 *
 * Run: npx tsx examples/02-overrides.ts
 */
import { z } from "zod";
import { mock } from "zodmint";

const OrderSchema = z.object({
  id: z.uuid(),
  status: z.enum(["pending", "shipped", "delivered", "cancelled"]),
  total: z.number().positive(),
  items: z.array(
    z.object({
      productId: z.uuid(),
      quantity: z.number().int().min(1).max(100),
      price: z.number().positive(),
    })
  ),
});

// Override specific fields — rest is still generated
const pendingOrder = mock(OrderSchema, {
  overrides: { status: "pending", total: 99.99 },
});
console.log("Pending order:", pendingOrder);

// Edge mode — boundary values (min/max, empty strings, zero, etc.)
const edgeOrder = mock(OrderSchema, { mode: "edge" });
console.log("Edge order:", edgeOrder);

// Seeded — same seed always produces same output
const a = mock(OrderSchema, { seed: 42 });
const b = mock(OrderSchema, { seed: 42 });
console.log("Same seed equals:", JSON.stringify(a) === JSON.stringify(b)); // true
