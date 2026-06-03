/**
 * Database seeding — zodmint/seed
 *
 * Generates batches of valid fixtures and inserts them via any async inserter.
 * First-class adapters for Prisma and Drizzle are included.
 *
 * Run: npx tsx examples/14-seed.ts
 */
import { z } from "zod";
import { createSession, seq } from "zodmint";
import { seed, prismaInserter, drizzleInserter } from "zodmint/seed";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(["admin", "user", "guest"]),
  active: z.boolean(),
});

// ─── Plain function inserter — works with anything ────────────────────────────

const db: unknown[] = [];

const users = await seed(
  async (items) => { db.push(...items); },
  UserSchema,
  { count: 5, seed: 1 },
);

console.log("Inserted via plain fn:", users.length, "users");
console.log("All valid:", users.every((u) => UserSchema.safeParse(u).success));

// ─── Prisma adapter ───────────────────────────────────────────────────────────

// In a real project: import { PrismaClient } from '@prisma/client'
// const prisma = new PrismaClient()

// Simulated Prisma model delegate (same shape as the real thing)
const prismaUserModel = {
  createMany: async (args: { data: unknown[] }) => {
    console.log("\nprisma.user.createMany called with", args.data.length, "records");
    return { count: args.data.length };
  },
};

const prismaUsers = await seed(
  prismaInserter(prismaUserModel),
  UserSchema,
  { count: 10, seed: 42 },
);

console.log("Prisma seed:", prismaUsers.length, "users");

// ─── Drizzle adapter ──────────────────────────────────────────────────────────

// In a real project:
// import { drizzle } from 'drizzle-orm/node-postgres'
// import { users } from './schema'
// const db = drizzle(pool)

// Simulated Drizzle db (same shape as the real thing)
const drizzleDb = {
  insert: (table: unknown) => ({
    values: async (data: unknown[]) => {
      console.log("\ndrizzle insert into", table, "with", data.length, "rows");
      return data;
    },
  }),
};

const drizzleUsers = await seed(
  drizzleInserter(drizzleDb, "users"),
  UserSchema,
  { count: 8, seed: 7 },
);

console.log("Drizzle seed:", drizzleUsers.length, "users");

// ─── Batched insert ───────────────────────────────────────────────────────────

let batchCount = 0;
await seed(
  async (batch) => {
    batchCount++;
    console.log(`\nBatch ${batchCount}: ${batch.length} records`);
  },
  UserSchema,
  { count: 25, batchSize: 10, seed: 100 },
);
// Batches: [10, 10, 5]

// ─── Unique fields via seq() ──────────────────────────────────────────────────

const session = createSession();

const ContactSchema = z.object({
  email: z.string().email(),
  name: z.string(),
});

const contacts = await seed(
  async () => {},
  ContactSchema,
  {
    count: 5,
    session,
    generators: {
      email: () => `user-${seq("email", session)}@example.com`,
    },
  },
);

console.log("\nUnique emails:");
contacts.forEach((c) => console.log(" ", c.email));
// user-1@example.com, user-2@example.com, ...

// ─── Async schema refinements ─────────────────────────────────────────────────

const EvenAgeSchema = z.object({
  name: z.string(),
  age: z.number().int().min(18).max(98).superRefine(async (n, ctx) => {
    if (n % 2 !== 0) ctx.addIssue({ code: "custom", message: "must be even" });
  }),
});

const evenUsers = await seed(async () => {}, EvenAgeSchema, {
  count: 3,
  async: true, // use mockAsync() internally
});

console.log("\nEven ages:", evenUsers.map((u) => u.age));
// all even numbers
