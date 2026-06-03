import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mockHonoHandler, mockHonoApp } from "../src/hono.js";
import { ZodForgeError } from "../src/errors.js";
import { Hono } from "hono";

const UserSchema = z.object({
  id:    z.string().uuid(),
  name:  z.string(),
  email: z.string().email(),
});

const PostSchema = z.object({
  id:    z.string().uuid(),
  title: z.string(),
});

describe("mockHonoHandler", () => {
  it("response status is 200 by default", async () => {
    const app = new Hono();
    app.get("/users/:id", mockHonoHandler(UserSchema));
    const res = await app.request("/users/1");
    expect(res.status).toBe(200);
  });

  it("response body passes schema.safeParse", async () => {
    const app = new Hono();
    app.get("/users/:id", mockHonoHandler(UserSchema));
    const res = await app.request("/users/1");
    const data = await res.json();
    expect(UserSchema.safeParse(data).success).toBe(true);
  });

  it("custom status option is respected", async () => {
    const app = new Hono();
    app.post("/users", mockHonoHandler(UserSchema, { status: 201 }));
    const res = await app.request("/users", { method: "POST" });
    expect(res.status).toBe(201);
  });

  it("custom headers appear in response", async () => {
    const app = new Hono();
    app.get("/users/:id", mockHonoHandler(UserSchema, {
      headers: { "x-custom-header": "test-value" },
    }));
    const res = await app.request("/users/1");
    expect(res.headers.get("x-custom-header")).toBe("test-value");
  });

  it("seed option produces deterministic output", async () => {
    const app = new Hono();
    app.get("/users/a", mockHonoHandler(UserSchema, { seed: 42 }));
    app.get("/users/b", mockHonoHandler(UserSchema, { seed: 42 }));
    const [res1, res2] = await Promise.all([
      app.request("/users/a"),
      app.request("/users/b"),
    ]);
    const [data1, data2] = await Promise.all([res1.json(), res2.json()]);
    expect(data1).toEqual(data2);
  });
});

describe("mockHonoApp", () => {
  it("builds an app, GET request returns valid data", async () => {
    const app = mockHonoApp([
      { route: "GET /users/:id", schema: UserSchema },
    ]);
    const res = await app.request("/users/1");
    const data = await res.json();
    expect(UserSchema.safeParse(data).success).toBe(true);
  });

  it("POST with status 201 returns 201", async () => {
    const app = mockHonoApp([
      { route: "POST /users", schema: UserSchema, status: 201 },
    ]);
    const res = await app.request("/users", { method: "POST" });
    expect(res.status).toBe(201);
  });

  it("multiple routes all work", async () => {
    const app = mockHonoApp([
      { route: "GET /users/:id", schema: UserSchema },
      { route: "GET /posts",     schema: z.array(PostSchema) },
      { route: "POST /users",    schema: UserSchema, status: 201 },
    ]);

    const [userRes, postsRes, createRes] = await Promise.all([
      app.request("/users/1"),
      app.request("/posts"),
      app.request("/users", { method: "POST" }),
    ]);

    expect(userRes.status).toBe(200);
    const userData = await userRes.json();
    expect(UserSchema.safeParse(userData).success).toBe(true);

    expect(postsRes.status).toBe(200);
    const postsData = await postsRes.json();
    expect(z.array(PostSchema).safeParse(postsData).success).toBe(true);

    expect(createRes.status).toBe(201);
  });

  it("invalid method throws ZodForgeError", () => {
    expect(() =>
      mockHonoApp([{ route: "BREW /coffee", schema: UserSchema }])
    ).toThrow(ZodForgeError);
  });

  it("invalid route format (no space) throws ZodForgeError", () => {
    expect(() =>
      mockHonoApp([{ route: "GET/users", schema: UserSchema }])
    ).toThrow(ZodForgeError);
  });
});
