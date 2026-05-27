import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mockRelated, mockRelatedMany, mockRelatedThree } from "../src/related.js";

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
});

const PostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  userId: z.string().uuid(),
  authorEmail: z.string().email(),
});

const CommentSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  postId: z.string().uuid(),
  authorId: z.string().uuid(),
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
  price: z.number().positive(),
});

const OrderSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
});

describe("mockRelated", () => {
  it("returns a tuple of two schema-valid mocks", () => {
    const [user, post] = mockRelated(UserSchema, PostSchema, {});
    expect(UserSchema.safeParse(user).success).toBe(true);
    expect(PostSchema.safeParse(post).success).toBe(true);
  });

  it("links a field via a key reference", () => {
    const [user, post] = mockRelated(UserSchema, PostSchema, { userId: "id" });
    expect(post.userId).toBe(user.id);
  });

  it("links multiple fields", () => {
    const [user, post] = mockRelated(UserSchema, PostSchema, {
      userId: "id",
      authorEmail: "email",
    });
    expect(post.userId).toBe(user.id);
    expect(post.authorEmail).toBe(user.email);
  });

  it("links a field via a mapper function", () => {
    const [org, member] = mockRelated(OrgSchema, MemberSchema, {
      orgId: "id",
      displayName: (org) => `Member of ${org.name}`,
    });
    expect(member.orgId).toBe(org.id);
    expect(member.displayName).toBe(`Member of ${org.name}`);
  });

  it("generated B is still schema-valid after applying links", () => {
    const [, post] = mockRelated(UserSchema, PostSchema, {
      userId: "id",
      authorEmail: "email",
    });
    expect(PostSchema.safeParse(post).success).toBe(true);
  });

  it("derived overrides take priority over optionsB overrides", () => {
    const [user, post] = mockRelated(
      UserSchema,
      PostSchema,
      { userId: "id" },
      undefined,
      { overrides: { userId: "00000000-0000-0000-0000-000000000000" } },
    );
    // links win
    expect(post.userId).toBe(user.id);
  });

  it("no links — A and B are independent", () => {
    const [user, post] = mockRelated(UserSchema, PostSchema, {});
    // Should still be valid
    expect(UserSchema.safeParse(user).success).toBe(true);
    expect(PostSchema.safeParse(post).success).toBe(true);
  });

  it("accepts seed options for determinism", () => {
    const [u1, p1] = mockRelated(
      UserSchema, PostSchema, { userId: "id" },
      { seed: 1 }, { seed: 2 },
    );
    const [u2, p2] = mockRelated(
      UserSchema, PostSchema, { userId: "id" },
      { seed: 1 }, { seed: 2 },
    );
    expect(u1).toEqual(u2);
    expect(p1).toEqual(p2);
  });
});

describe("mockRelatedMany", () => {
  it("returns the requested number of pairs", () => {
    const pairs = mockRelatedMany(UserSchema, PostSchema, { userId: "id" }, 4);
    expect(pairs).toHaveLength(4);
  });

  it("each pair satisfies the link constraint", () => {
    const pairs = mockRelatedMany(UserSchema, PostSchema, { userId: "id" }, 3);
    for (const [user, post] of pairs) {
      expect(post.userId).toBe(user.id);
    }
  });

  it("each pair is schema-valid", () => {
    const pairs = mockRelatedMany(UserSchema, PostSchema, { userId: "id" }, 3);
    for (const [user, post] of pairs) {
      expect(UserSchema.safeParse(user).success).toBe(true);
      expect(PostSchema.safeParse(post).success).toBe(true);
    }
  });
});

describe("mockRelatedThree", () => {
  it("returns a valid triple", () => {
    const [user, product, order] = mockRelatedThree(
      UserSchema,
      ProductSchema,
      OrderSchema,
      {
        userId: { from: "a", key: "id" },
        productId: { from: "b", key: "id" },
      },
    );
    expect(UserSchema.safeParse(user).success).toBe(true);
    expect(ProductSchema.safeParse(product).success).toBe(true);
    expect(OrderSchema.safeParse(order).success).toBe(true);
  });

  it("links from A and B into C", () => {
    const [user, product, order] = mockRelatedThree(
      UserSchema,
      ProductSchema,
      OrderSchema,
      {
        userId: { from: "a", key: "id" },
        productId: { from: "b", key: "id" },
      },
    );
    expect(order.userId).toBe(user.id);
    expect(order.productId).toBe(product.id);
  });

  it("supports mapper functions with access to both A and B", () => {
    const [user, product, order] = mockRelatedThree(
      UserSchema,
      ProductSchema,
      OrderSchema,
      {
        userId: (u) => u.id,
        productId: (_, p) => p.id,
      },
    );
    expect(order.userId).toBe(user.id);
    expect(order.productId).toBe(product.id);
  });

  it("order satisfies schema after links", () => {
    const [, , order] = mockRelatedThree(
      UserSchema,
      ProductSchema,
      OrderSchema,
      {
        userId: { from: "a", key: "id" },
        productId: { from: "b", key: "id" },
      },
    );
    expect(OrderSchema.safeParse(order).success).toBe(true);
  });
});
