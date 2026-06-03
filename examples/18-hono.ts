// 18-hono.ts — zodmint/hono: mock handlers and apps for Hono route testing
import { z } from "zod";
import { Hono } from "hono";
import { mockHonoHandler, mockHonoApp } from "../src/hono.js";

const UserSchema = z.object({
  id:    z.string().uuid(),
  name:  z.string(),
  email: z.string().email(),
});

const PostSchema = z.object({
  id:     z.string().uuid(),
  title:  z.string(),
  userId: z.string().uuid(),
});

// --- mockHonoHandler: attach to any Hono app ---
const app = new Hono();
app.get("/users/:id", mockHonoHandler(UserSchema, { seed: 1 }));
app.post("/users",    mockHonoHandler(UserSchema, { status: 201 }));

const res  = await app.request("/users/abc");
const user = await res.json();
console.log("GET /users/:id →", user);

// --- mockHonoApp: build a complete mock API in one call ---
const mockApi = mockHonoApp([
  { route: "GET /users/:id", schema: UserSchema },
  { route: "GET /posts",     schema: z.array(PostSchema), seed: 2 },
  { route: "POST /users",    schema: UserSchema, status: 201 },
]);

const postRes  = await mockApi.request("/posts");
const posts    = await postRes.json();
console.log("GET /posts →", posts);
