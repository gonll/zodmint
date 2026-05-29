/**
 * Async factory — factory.async() for schemas with async refinements
 * or async afterBuild hooks.
 *
 * Run: npx tsx examples/13-async-factory.ts
 */
import { z } from "zod";
import { mockFactory } from "zodmint";

// ─── Schema with async refinement ───────────────────────────────────────────

// Simulated DB or cache that tracks used emails
const usedEmails = new Set<string>();

const UniqueEmailSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().superRefine(async (v, ctx) => {
    if (usedEmails.has(v)) {
      ctx.addIssue({ code: "custom", message: "Email already registered" });
    }
  }),
  name: z.string(),
});

const userFactory = mockFactory(UniqueEmailSchema);

// factory() would throw "Encountered Promise during synchronous parse" for Zod v4
// or produce incorrect results for Zod v3 — use factory.async() instead
const user1 = await userFactory.async();
usedEmails.add(user1.email);
console.log("User 1:", user1);

const user2 = await userFactory.async();
usedEmails.add(user2.email);
console.log("User 2:", user2);

console.log("Emails are unique:", user1.email !== user2.email); // true

// ─── Async afterBuild ────────────────────────────────────────────────────────

// Simulate a DB layer
let nextId = 1;
const fakeDb = {
  async saveUser(user: { name: string; email: string }) {
    return { ...user, id: nextId++, createdAt: new Date().toISOString() };
  },
};

const BaseSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

// afterBuild can return a Promise when used with factory.async()
const persistedFactory = mockFactory(BaseSchema, {
  afterBuild: async (user) => {
    const saved = await fakeDb.saveUser(user);
    return { ...user, dbId: saved.id, createdAt: saved.createdAt };
  },
});

const persisted = await persistedFactory.async();
console.log("\nPersisted user:", persisted);
// persisted.dbId came from the fake DB layer

// ─── States + async factory ──────────────────────────────────────────────────

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["admin", "user", "guest"]),
  active: z.boolean(),
});

const factory = mockFactory(UserSchema, {
  states: {
    admin: { role: "admin", active: true },
    inactive: { active: false },
  },
  afterBuild: async (user) => {
    await new Promise((r) => setTimeout(r, 1)); // async step
    return { ...user, name: `[ASYNC] ${user.name}` };
  },
});

const adminUser = await factory.async({ states: "admin" });
console.log("\nAsync admin:", adminUser);
console.log("role is admin:", adminUser.role === "admin");
console.log("name prefixed:", adminUser.name.startsWith("[ASYNC]"));
