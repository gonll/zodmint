/**
 * Example 11 — Cross-schema consistency with mockRelated
 *
 * mockRelated generates two objects and wires fields on the second
 * to values from the first, so foreign-key relationships hold automatically.
 *
 * Run: npx tsx examples/11-related.ts
 */

import { z } from "zod";
import { mockRelated, mockRelatedMany, mockRelatedThree } from "../src/related.js";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
});

const PostSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  authorEmail: z.string().email(),
  title: z.string(),
});

const OrgSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const MemberSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  displayName: z.string(),
});

const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  price: z.number().positive(),
});

const OrderSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  totalCost: z.number().positive(),
});

// ─── 1. Key reference ────────────────────────────────────────────────────────

const [user, post] = mockRelated(
  UserSchema,
  PostSchema,
  { userId: "id", authorEmail: "email" },
);

console.log("user.id === post.userId:", user.id === post.userId);       // true
console.log("user.email === post.authorEmail:", user.email === post.authorEmail); // true

// ─── 2. Mapper function ───────────────────────────────────────────────────────

const [org, member] = mockRelated(
  OrgSchema,
  MemberSchema,
  {
    orgId: "id",
    displayName: (org) => `Member of ${org.name}`,
  },
);

console.log("org.id === member.orgId:", org.id === member.orgId);       // true
console.log("member.displayName:", member.displayName);                 // "Member of Acme Inc"

// ─── 3. mockRelatedMany — N related pairs ─────────────────────────────────────

const pairs = mockRelatedMany(UserSchema, PostSchema, { userId: "id" }, 3);

console.log("All pairs linked:", pairs.every(([u, p]) => u.id === p.userId)); // true
console.log("Pairs:", pairs.length); // 3

// ─── 4. mockRelatedThree — three-schema variant ───────────────────────────────

const [u, product, order] = mockRelatedThree(
  UserSchema,
  ProductSchema,
  OrderSchema,
  {
    userId:    { from: "a", key: "id" },
    productId: { from: "b", key: "id" },
    totalCost: (_, product) => product.price * 2,
  },
);

console.log("order.userId === user.id:",       u.id === order.userId);         // true
console.log("order.productId === product.id:", product.id === order.productId); // true
console.log("order.totalCost === price * 2:", order.totalCost === product.price * 2); // true
