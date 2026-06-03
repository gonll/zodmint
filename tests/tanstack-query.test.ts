import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  mockQueryClient,
  mockQueryFn,
  mockInfiniteQueryClient,
} from "../src/tanstack-query.js";

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
});

const PostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  userId: z.string().uuid(),
});

describe("mockQueryClient", () => {
  it("pre-populates cache — getQueryData returns generated value", () => {
    const client = mockQueryClient([
      { queryKey: ["user", "1"], schema: UserSchema },
    ]);
    const data = client.getQueryData(["user", "1"]);
    expect(data).toBeDefined();
  });

  it("every cached value passes schema.safeParse", () => {
    const client = mockQueryClient([
      { queryKey: ["user", "1"], schema: UserSchema },
    ]);
    const data = client.getQueryData(["user", "1"]);
    expect(UserSchema.safeParse(data).success).toBe(true);
  });

  it("multiple entries are all populated", () => {
    const client = mockQueryClient([
      { queryKey: ["user", "1"], schema: UserSchema },
      { queryKey: ["posts"], schema: z.array(PostSchema) },
    ]);
    expect(client.getQueryData(["user", "1"])).toBeDefined();
    expect(client.getQueryData(["posts"])).toBeDefined();
  });

  it("options.seed produces deterministic values", () => {
    const client1 = mockQueryClient([
      { queryKey: ["user"], schema: UserSchema, options: { seed: 99 } },
    ]);
    const client2 = mockQueryClient([
      { queryKey: ["user"], schema: UserSchema, options: { seed: 99 } },
    ]);
    expect(client1.getQueryData(["user"])).toEqual(
      client2.getQueryData(["user"]),
    );
  });

  it("default options include retry: false and staleTime: Infinity", () => {
    const client = mockQueryClient([
      { queryKey: ["user"], schema: UserSchema },
    ]);
    const opts = client.getDefaultOptions();
    expect(opts.queries?.retry).toBe(false);
    expect(opts.queries?.staleTime).toBe(Infinity);
  });

  it("caller can override default options via second argument", () => {
    const client = mockQueryClient(
      [{ queryKey: ["user"], schema: UserSchema }],
      { defaultOptions: { queries: { retry: 3 } } },
    );
    const opts = client.getDefaultOptions();
    expect(opts.queries?.retry).toBe(3);
  });
});

describe("mockQueryFn", () => {
  it("returns a function that returns a valid value", () => {
    const fn = mockQueryFn(UserSchema);
    const result = fn();
    expect(UserSchema.safeParse(result).success).toBe(true);
  });

  it("seed makes it deterministic", () => {
    const fn1 = mockQueryFn(UserSchema, { seed: 7 });
    const fn2 = mockQueryFn(UserSchema, { seed: 7 });
    expect(fn1()).toEqual(fn2());
  });
});

describe("mockInfiniteQueryClient", () => {
  it("cache has { pages, pageParams } shape", () => {
    const client = mockInfiniteQueryClient([
      { queryKey: ["feed"], schema: PostSchema },
    ]);
    const data = client.getQueryData(["feed"]) as {
      pages: unknown[][];
      pageParams: unknown[];
    };
    expect(Array.isArray(data.pages)).toBe(true);
    expect(Array.isArray(data.pageParams)).toBe(true);
  });

  it("pages[0] has correct length from pageSize", () => {
    const client = mockInfiniteQueryClient([
      { queryKey: ["feed"], schema: PostSchema, pageSize: 7 },
    ]);
    const data = client.getQueryData(["feed"]) as { pages: unknown[][] };
    expect(data.pages[0]).toHaveLength(7);
  });

  it("default pageSize is 5", () => {
    const client = mockInfiniteQueryClient([
      { queryKey: ["feed"], schema: PostSchema },
    ]);
    const data = client.getQueryData(["feed"]) as { pages: unknown[][] };
    expect(data.pages[0]).toHaveLength(5);
  });

  it("every item in pages passes schema.safeParse", () => {
    const client = mockInfiniteQueryClient([
      { queryKey: ["feed"], schema: PostSchema, pageSize: 4 },
    ]);
    const data = client.getQueryData(["feed"]) as { pages: unknown[][] };
    for (const item of data.pages[0]) {
      expect(PostSchema.safeParse(item).success).toBe(true);
    }
  });
});
