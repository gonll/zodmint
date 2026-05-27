import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mockHandler, mockHandlers } from "../src/msw.js";

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
});

const PostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
});

describe("mockHandler", () => {
  it("returns an MSW HttpHandler (has public info property)", () => {
    const handler = mockHandler(UserSchema, "GET /api/users/:id");
    // MSW v2 handlers expose .info with method and path
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("object");
    // Check it looks like an MSW RequestHandler
    expect(handler).toHaveProperty("info");
  });

  it("encodes the method in handler.info", () => {
    const handler = mockHandler(UserSchema, "POST /api/users");
    const info = (handler as { info: { method: string } }).info;
    expect(info.method.toLowerCase()).toBe("post");
  });

  it("supports all HTTP methods", () => {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"] as const;
    for (const method of methods) {
      expect(() =>
        mockHandler(UserSchema, `${method} /api/resource`),
      ).not.toThrow();
    }
  });

  it("throws TypeError for missing space in route", () => {
    expect(() => mockHandler(UserSchema, "/api/users")).toThrow(TypeError);
    expect(() => mockHandler(UserSchema, "/api/users")).toThrow(
      "zodmint/msw: invalid route",
    );
  });

  it("throws TypeError for unknown HTTP method", () => {
    expect(() => mockHandler(UserSchema, "BREW /api/coffee")).toThrow(TypeError);
    expect(() => mockHandler(UserSchema, "BREW /api/coffee")).toThrow(
      "unknown HTTP method",
    );
  });

  it("accepts seed option for deterministic fixtures", () => {
    const h1 = mockHandler(UserSchema, "GET /api/users/:id", { seed: 42 });
    const h2 = mockHandler(UserSchema, "GET /api/users/:id", { seed: 42 });
    // Both handlers created without error; seeding is tested in integration
    expect(h1).toBeDefined();
    expect(h2).toBeDefined();
  });

  it("accepts status option", () => {
    const handler = mockHandler(PostSchema, "POST /api/posts", { status: 201 });
    expect(handler).toBeDefined();
  });

  it("accepts delay option as a number", () => {
    const handler = mockHandler(UserSchema, "GET /api/users", { delay: 100 });
    expect(handler).toBeDefined();
  });

  it("accepts delay option as 'infinite'", () => {
    const handler = mockHandler(UserSchema, "GET /api/users", { delay: "infinite" });
    expect(handler).toBeDefined();
  });

  it("accepts headers option", () => {
    const handler = mockHandler(UserSchema, "GET /api/users", {
      headers: { "X-Custom": "zodmint" },
    });
    expect(handler).toBeDefined();
  });
});

describe("mockHandlers", () => {
  it("returns an array of handlers", () => {
    const handlers = mockHandlers([
      { schema: UserSchema, route: "GET /api/users/:id" },
      { schema: PostSchema, route: "POST /api/posts", status: 201 },
    ]);
    expect(Array.isArray(handlers)).toBe(true);
    expect(handlers).toHaveLength(2);
  });

  it("each handler has the correct method", () => {
    const handlers = mockHandlers([
      { schema: UserSchema, route: "GET /api/users" },
      { schema: PostSchema, route: "DELETE /api/posts/:id" },
    ]);
    const [get, del] = handlers as Array<{ info: { method: string } }>;
    expect(get.info.method.toLowerCase()).toBe("get");
    expect(del.info.method.toLowerCase()).toBe("delete");
  });
});
