/**
 * Example 10 — zodmint/msw: first-class MSW v2 handler factory
 *
 * Requires msw ^2.0.0 installed. The handlers below are ready to pass
 * to setupServer() (Node) or setupWorker() (browser).
 *
 * Run: npx tsx examples/10-msw.ts
 */

import { z } from "zod";
import { mockHandler, mockHandlers } from "../src/msw.js";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(["user", "admin"]),
});

const PostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  published: z.boolean(),
});

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

// ─── 1. Single handler ────────────────────────────────────────────────────────

// GET /api/users/:id → 200 with a valid User
const getUserHandler = mockHandler(UserSchema, "GET /api/users/:id");

// POST /api/posts → 201 Created
const createPostHandler = mockHandler(PostSchema, "POST /api/posts", {
  status: 201,
});

// Simulated server error
const errorHandler = mockHandler(ErrorSchema, "GET /api/broken", {
  status: 500,
});

// ─── 2. Deterministic fixture ─────────────────────────────────────────────────

// Same data on every test run — useful for snapshot tests
const stableUser = mockHandler(UserSchema, "GET /api/users/stable", {
  seed: 42,
});

// ─── 3. Simulated delay ───────────────────────────────────────────────────────

// 300 ms delay to test loading states
const slowHandler = mockHandler(UserSchema, "GET /api/users/slow", {
  delay: 300,
});

// Never resolves — test your loading spinner
const hangingHandler = mockHandler(UserSchema, "GET /api/users/hang", {
  delay: "infinite",
});

// ─── 4. Batch factory with mockHandlers() ─────────────────────────────────────

export const handlers = mockHandlers([
  { schema: UserSchema,  route: "GET /api/users/:id" },
  { schema: PostSchema,  route: "POST /api/posts",   status: 201 },
  { schema: ErrorSchema, route: "GET /api/error",    status: 500 },
]);

console.log("Handlers created:", handlers.length);
// In a test file:
// import { setupServer } from "msw/node";
// const server = setupServer(...handlers);
// beforeAll(() => server.listen());
// afterAll(() => server.close());
