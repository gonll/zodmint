/**
 * Custom matchers and plugins
 *
 * Run: npx tsx examples/04-matchers-and-plugins.ts
 */
import { z } from "zod";
import { mock, configure, definePlugin, resetConfig } from "zodmint";

// ─── Inline custom matchers ────────────────────────────────────────────────────

configure({
  matchers: [
    { pattern: /sku/i, generate: () => `SKU-${Math.floor(Math.random() * 9000 + 1000)}` },
    { pattern: /currency/i, generate: () => "USD" },
  ],
});

const ProductSchema = z.object({
  sku: z.string(),
  currency: z.string(),
  price: z.number().positive(),
});

console.log("Product with matchers:", mock(ProductSchema));
// { sku: 'SKU-4821', currency: 'USD', price: 18.32 }

resetConfig();

// ─── Path-aware matchers (MatcherContext) ──────────────────────────────────────

configure({
  matchers: [
    {
      pattern: /id$/i,
      generate: (ctx) => {
        // Generate different ID formats based on where in the schema we are
        if (ctx?.path.includes("order")) return `ORD-${Math.floor(Math.random() * 10000)}`;
        if (ctx?.path.includes("product")) return `PRD-${Math.floor(Math.random() * 10000)}`;
        return `ID-${Math.floor(Math.random() * 10000)}`;
      },
    },
  ],
});

const OrderSchema = z.object({
  orderId: z.string(),
  product: z.object({
    productId: z.string(),
  }),
});

console.log("Order with path-aware IDs:", mock(OrderSchema));
resetConfig();

// ─── Plugin ────────────────────────────────────────────────────────────────────

const acmePlugin = definePlugin({
  matchers: [
    { pattern: /department/i, generate: () => "Engineering" },
    { pattern: /employeeId/i, generate: () => `EMP-${Math.floor(Math.random() * 9000 + 1000)}` },
  ],
});

configure({ plugins: [acmePlugin] });

const EmployeeSchema = z.object({
  employeeId: z.string(),
  name: z.string(),
  department: z.string(),
});

console.log("Employee with plugin:", mock(EmployeeSchema));
resetConfig();
