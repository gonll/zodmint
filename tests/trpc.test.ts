import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mockTrpcCaller, mockProcedureOutput } from "../src/trpc.js";

const UserSchema = z.object({
  id:    z.string().uuid(),
  name:  z.string(),
  email: z.string().email(),
});

const PostSchema = z.object({
  id:    z.string().uuid(),
  title: z.string(),
});

describe("mockTrpcCaller", () => {
  it("single-level procedure returns valid value", async () => {
    const caller = mockTrpcCaller({ getUser: UserSchema });
    const result = await (caller as any).getUser();
    expect(UserSchema.safeParse(result).success).toBe(true);
  });

  it("nested procedure path works", async () => {
    const caller = mockTrpcCaller({ "users.getById": UserSchema });
    const result = await (caller as any).users.getById({ id: "1" });
    expect(UserSchema.safeParse(result).success).toBe(true);
  });

  it("return value passes schema.safeParse", async () => {
    const caller = mockTrpcCaller({ "posts.create": PostSchema });
    const result = await (caller as any).posts.create({ title: "hi" });
    expect(PostSchema.safeParse(result).success).toBe(true);
  });

  it("unknown procedure returns undefined", async () => {
    const caller = mockTrpcCaller({ "users.getById": UserSchema });
    const result = await (caller as any).other.unknown();
    expect(result).toBeUndefined();
  });

  it("defaultOptions.seed produces deterministic output", async () => {
    const caller1 = mockTrpcCaller({ "users.get": UserSchema }, { seed: 99 });
    const caller2 = mockTrpcCaller({ "users.get": UserSchema }, { seed: 99 });
    const r1 = await (caller1 as any).users.get();
    const r2 = await (caller2 as any).users.get();
    expect(r1).toEqual(r2);
  });

  it("per-procedure { schema, options } form works", async () => {
    const caller = mockTrpcCaller({
      "users.get": { schema: UserSchema, options: { seed: 7 } },
    });
    const result = await (caller as any).users.get();
    expect(UserSchema.safeParse(result).success).toBe(true);
  });

  it("per-procedure seed overrides default seed", async () => {
    const callerA = mockTrpcCaller(
      { "users.get": { schema: UserSchema, options: { seed: 1 } } },
      { seed: 999 },
    );
    const callerB = mockTrpcCaller(
      { "users.get": { schema: UserSchema, options: { seed: 1 } } },
      { seed: 999 },
    );
    const r1 = await (callerA as any).users.get();
    const r2 = await (callerB as any).users.get();
    // Same per-procedure seed -> same result regardless of different default
    expect(r1).toEqual(r2);

    // Confirm per-procedure seed differs from what default would produce
    const callerDefault = mockTrpcCaller({ "users.get": UserSchema }, { seed: 999 });
    const rDefault = await (callerDefault as any).users.get();
    // seed 1 vs seed 999 — they should differ (extremely unlikely to collide)
    expect(r1).not.toEqual(rDefault);
  });

  it("multiple procedures all return valid data", async () => {
    const caller = mockTrpcCaller({
      "users.list": z.array(UserSchema),
      "posts.create": PostSchema,
    });
    const users = await (caller as any).users.list();
    const post  = await (caller as any).posts.create({ title: "x" });
    expect(Array.isArray(users)).toBe(true);
    expect(PostSchema.safeParse(post).success).toBe(true);
  });

  it("deeply nested path (a.b.c) works", async () => {
    const caller = mockTrpcCaller({ "a.b.c": UserSchema });
    const result = await (caller as any).a.b.c();
    expect(UserSchema.safeParse(result).success).toBe(true);
  });
});

describe("mockProcedureOutput", () => {
  it("returns valid value synchronously", () => {
    const result = mockProcedureOutput(UserSchema);
    expect(UserSchema.safeParse(result).success).toBe(true);
  });

  it("seed makes it deterministic", () => {
    const r1 = mockProcedureOutput(UserSchema, { seed: 42 });
    const r2 = mockProcedureOutput(UserSchema, { seed: 42 });
    expect(r1).toEqual(r2);
  });

  it("return type passes schema.safeParse", () => {
    const schema = z.object({ count: z.number().int().positive() });
    const result = mockProcedureOutput(schema);
    expect(schema.safeParse(result).success).toBe(true);
  });
});
