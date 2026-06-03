import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { seed, prismaInserter, drizzleInserter } from "../src/seed.js";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  age: z.number().int().min(18).max(99),
});

// ---------------------------------------------------------------------------
// Core — seed()
// ---------------------------------------------------------------------------

describe("seed() — core", () => {
  it("generates the requested count and calls inserter once", async () => {
    const calls: unknown[][] = [];
    const inserter = async (items: unknown[]) => { calls.push(items); };

    const result = await seed(inserter, UserSchema, { count: 5 });

    expect(result).toHaveLength(5);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(5);
  });

  it("defaults to count 10 when not specified", async () => {
    const captured: unknown[][] = [];
    await seed(async (items) => { captured.push(items); }, UserSchema);
    expect(captured[0]).toHaveLength(10);
  });

  it("all generated items pass schema.safeParse", async () => {
    await seed(
      async (items) => {
        for (const item of items) {
          expect(UserSchema.safeParse(item).success).toBe(true);
        }
      },
      UserSchema,
      { count: 10 },
    );
  });

  it("returns the generated items", async () => {
    const result = await seed(async () => {}, UserSchema, { count: 3 });
    expect(result).toHaveLength(3);
    for (const item of result) {
      expect(UserSchema.safeParse(item).success).toBe(true);
    }
  });

  it("same seed produces same output", async () => {
    const r1 = await seed(async () => {}, UserSchema, { count: 3, seed: 42 });
    const r2 = await seed(async () => {}, UserSchema, { count: 3, seed: 42 });
    expect(r1).toEqual(r2);
  });

  it("different seeds produce different items", async () => {
    const r1 = await seed(async () => {}, UserSchema, { count: 3, seed: 1 });
    const r2 = await seed(async () => {}, UserSchema, { count: 3, seed: 99 });
    expect(r1).not.toEqual(r2);
  });

  it("seeded items are distinct from each other", async () => {
    const result = await seed(async () => {}, UserSchema, { count: 5, seed: 7 });
    const ids = result.map((u) => u.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("overrides are applied to every item", async () => {
    const result = await seed(async () => {}, UserSchema, {
      count: 5,
      overrides: { age: 21 },
    });
    for (const item of result) {
      expect(item.age).toBe(21);
    }
  });

  it("mode option is forwarded", async () => {
    // edge mode generates boundary values — age should be at the boundary
    const result = await seed(async () => {}, UserSchema, {
      count: 3,
      mode: "edge",
    });
    for (const item of result) {
      expect(UserSchema.safeParse(item).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

describe("seed() — batchSize", () => {
  it("splits into correct number of batches", async () => {
    const calls: number[] = [];
    const inserter = async (items: unknown[]) => { calls.push(items.length); };

    await seed(inserter, UserSchema, { count: 10, batchSize: 3 });

    // 10 items in batches of 3: [3, 3, 3, 1]
    expect(calls).toEqual([3, 3, 3, 1]);
  });

  it("single batch when batchSize >= count", async () => {
    const calls: number[] = [];
    await seed(async (items) => { calls.push(items.length); }, UserSchema, {
      count: 5,
      batchSize: 100,
    });
    expect(calls).toEqual([5]);
  });

  it("batches are inserted sequentially", async () => {
    const order: string[] = [];
    let idx = 0;
    const inserter = async (items: unknown[]) => {
      const id = `batch-${idx++}`;
      order.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, 1));
      order.push(`end:${id}`);
    };

    await seed(inserter, UserSchema, { count: 6, batchSize: 2 });

    // Sequential: each batch fully completes before the next starts
    expect(order).toEqual([
      "start:batch-0", "end:batch-0",
      "start:batch-1", "end:batch-1",
      "start:batch-2", "end:batch-2",
    ]);
  });

  it("all items are present across batches", async () => {
    const all: unknown[] = [];
    await seed(async (items) => { all.push(...items); }, UserSchema, {
      count: 7,
      batchSize: 3,
    });
    expect(all).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Async mode
// ---------------------------------------------------------------------------

describe("seed() — async option", () => {
  it("handles schemas with async refinements", async () => {
    const EvenAge = z.object({
      name: z.string(),
      age: z.number().int().min(18).max(98).superRefine(async (n, ctx) => {
        if (n % 2 !== 0) ctx.addIssue({ code: "custom", message: "must be even" });
      }),
    });

    const result = await seed(async () => {}, EvenAge, { count: 5, async: true });
    expect(result).toHaveLength(5);
    for (const item of result) {
      expect(item.age % 2).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ORM adapters
// ---------------------------------------------------------------------------

describe("prismaInserter()", () => {
  it("calls model.createMany with data array", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const model = { createMany };

    const inserter = prismaInserter(model);
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
    await inserter(items as never);

    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledWith({ data: items });
  });

  it("integrates with seed()", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 5 });
    const model = { createMany };

    const result = await seed(prismaInserter(model), UserSchema, { count: 5 });

    expect(result).toHaveLength(5);
    expect(createMany).toHaveBeenCalledOnce();
  });

  it("batched seed calls createMany once per batch", async () => {
    const createMany = vi.fn().mockResolvedValue({});
    const model = { createMany };

    await seed(prismaInserter(model), UserSchema, { count: 6, batchSize: 2 });

    expect(createMany).toHaveBeenCalledTimes(3);
  });
});

describe("drizzleInserter()", () => {
  it("calls db.insert(table).values(items)", async () => {
    const values = vi.fn().mockResolvedValue([]);
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert };
    const usersTable = Symbol("users");

    const inserter = drizzleInserter(db, usersTable);
    const items = [{ id: "1" }];
    await inserter(items as never);

    expect(insert).toHaveBeenCalledWith(usersTable);
    expect(values).toHaveBeenCalledWith(items);
  });

  it("integrates with seed()", async () => {
    const values = vi.fn().mockResolvedValue([]);
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert };

    const result = await seed(drizzleInserter(db, "users"), UserSchema, { count: 4 });

    expect(result).toHaveLength(4);
    expect(insert).toHaveBeenCalledOnce();
  });
});
