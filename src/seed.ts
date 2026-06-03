/**
 * zodmint/seed — schema-driven database seeding.
 *
 * Generates batches of valid fixtures from a Zod schema and inserts them via
 * any async inserter function. First-class adapters are provided for Prisma and
 * Drizzle; any function with signature `(items: T[]) => Promise<unknown>` works.
 *
 * @example
 * // Plain function — works with any ORM or custom writer
 * await seed((data) => prisma.user.createMany({ data }), UserSchema, { count: 50 });
 *
 * @example
 * // Prisma adapter — auto-detects createMany
 * import { prismaInserter } from 'zodmint/seed';
 * await seed(prismaInserter(prisma.user), UserSchema, { count: 100 });
 *
 * @example
 * // Drizzle adapter
 * import { drizzleInserter } from 'zodmint/seed';
 * await seed(drizzleInserter(db, users), UserSchema, { count: 50 });
 *
 * @example
 * // With seq() for unique fields
 * import { createSession, seq } from 'zodmint';
 * const session = createSession();
 * await seed(
 *   prismaInserter(prisma.user),
 *   UserSchema,
 *   {
 *     count: 20,
 *     session,
 *     generators: { 'email': () => `user-${seq('email', session)}@example.com` },
 *   },
 * );
 */

import { z } from "zod";
import { mock } from "./mock.js";
import { mockAsync } from "./mock.js";
import type { MockOptions } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A function that inserts an array of items and returns a Promise.
 * The resolved value is ignored — use the return value of `seed()` for the
 * generated items.
 */
export type SeedInserter<T> = (items: T[]) => Promise<unknown>;

/**
 * Duck-typed Prisma model delegate shape.
 * Matches any object that has a `createMany` method.
 */
export interface PrismaModelDelegate<T> {
  createMany(args: { data: T[]; skipDuplicates?: boolean }): Promise<unknown>;
}

/**
 * Duck-typed Drizzle database + table pair.
 * Matches any object with an `insert` method that accepts a table and returns
 * an object with a `values` method.
 */
export interface DrizzleDb {
  insert(table: unknown): { values(data: unknown[]): Promise<unknown> };
}

/** Options for `seed()`. Extends `MockOptions` with seeding-specific fields. */
export interface SeedOptions<S extends z.ZodTypeAny> extends MockOptions<S> {
  /**
   * Number of records to generate and insert. Defaults to 10.
   */
  count?: number;
  /**
   * Maximum number of items per insert call. Useful for large counts where
   * the ORM or DB has a row limit per statement. Defaults to `count` (single batch).
   */
  batchSize?: number;
  /**
   * When true, each record is generated via `mockAsync()` instead of `mock()`.
   * Required when the schema contains async `z.superRefine()` predicates.
   * Defaults to false.
   */
  async?: boolean;
}

// ---------------------------------------------------------------------------
// ORM adapters
// ---------------------------------------------------------------------------

/**
 * Wraps a Prisma model delegate into a `SeedInserter`.
 * Uses `createMany` under the hood.
 *
 * @example
 * await seed(prismaInserter(prisma.user), UserSchema, { count: 50 });
 */
export function prismaInserter<T>(model: PrismaModelDelegate<T>): SeedInserter<T> {
  return (items) => model.createMany({ data: items });
}

/**
 * Wraps a Drizzle db + table into a `SeedInserter`.
 *
 * @example
 * await seed(drizzleInserter(db, users), UserSchema, { count: 50 });
 */
export function drizzleInserter<T>(db: DrizzleDb, table: unknown): SeedInserter<T> {
  return (items) => db.insert(table).values(items);
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Splits an array into chunks of at most `size` items.
 * Returns a single-element array when `size >= items.length`.
 */
function chunk<T>(items: T[], size: number): T[][] {
  if (size >= items.length) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Generates `count` valid fixtures from `schema` and inserts them via `inserter`.
 *
 * Each item is generated independently with an offset seed (when a seed is
 * provided) so results are deterministic and non-identical across items.
 *
 * Returns the full array of generated items — useful for chaining with
 * `mockRelated()` or for asserting against in tests.
 *
 * @param inserter - An async function that receives an array of items.
 *   Use `prismaInserter()` or `drizzleInserter()` for first-class ORM support,
 *   or pass any `(items: T[]) => Promise<unknown>` directly.
 * @param schema   - The Zod schema to generate from. Every item satisfies
 *   `schema.safeParse(item).success === true`.
 * @param options  - Generation options plus `count` and `batchSize`.
 *
 * @example
 * const users = await seed(
 *   prismaInserter(prisma.user),
 *   UserSchema,
 *   { count: 50, seed: 1, mode: 'realistic' },
 * );
 * // users.length === 50, each passes UserSchema.safeParse
 */
export async function seed<S extends z.ZodTypeAny>(
  inserter: SeedInserter<z.infer<S>>,
  schema: S,
  options?: SeedOptions<S>,
): Promise<z.infer<S>[]> {
  const count = options?.count ?? 10;
  const batchSize = options?.batchSize ?? count;
  const useAsync = options?.async ?? false;

  // Generate all items upfront. Each item gets an offset seed so that a
  // seeded run produces distinct (but deterministic) values per record.
  const { count: _c, batchSize: _b, async: _a, ...mockOpts } = options ?? {};

  const items: z.infer<S>[] = useAsync
    ? await Promise.all(
        Array.from({ length: count }, (_, i) =>
          mockAsync(schema, {
            ...mockOpts,
            seed: mockOpts.seed !== undefined ? mockOpts.seed + i : undefined,
          }),
        ),
      )
    : Array.from({ length: count }, (_, i) =>
        mock(schema, {
          ...mockOpts,
          seed: mockOpts.seed !== undefined ? mockOpts.seed + i : undefined,
        }),
      );

  // Insert in batches, sequentially to respect DB connection limits.
  for (const batch of chunk(items, batchSize)) {
    await inserter(batch);
  }

  return items;
}
