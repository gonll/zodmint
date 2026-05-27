/**
 * Tests for withGenerate() (refinement hints, roadmap #6)
 * and mockAsync() (async refinements, roadmap #8).
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mock, mockAsync, withGenerate } from "../src/index.js";
import { ZodForgeError } from "../src/errors.js";

// ─── withGenerate (refinement hints) ─────────────────────────────────────────

describe("withGenerate()", () => {
  it("hint is used instead of brute-force retry loop", () => {
    // A highly restrictive refinement that would require many retries without a hint
    let retryCount = 0;
    const schema = withGenerate(
      z.string().refine((v) => {
        retryCount++;
        return v === "exact-match";
      }, "must be exact-match"),
      () => "exact-match",
    );

    retryCount = 0;
    const result = mock(schema);
    // Hint fires in dispatchRefinement (1 check) + outer runPipeline safeParse (1 check) = 2 total.
    // The key invariant: retries never exceed 2, meaning no brute-force loop ran.
    expect(result).toBe("exact-match");
    expect(retryCount).toBeLessThanOrEqual(2); // no brute-force retry loop
  });

  it("hint returns the correct output type", () => {
    const schema = withGenerate(
      z.number().int().refine((n) => n % 7 === 0, "must be divisible by 7"),
      () => 49,
    );
    const result = mock(schema);
    expect(result).toBe(49);
    expect(result % 7).toBe(0);
  });

  it("hint on object schema works end-to-end", () => {
    const schema = withGenerate(
      z.object({ score: z.number(), grade: z.string() }).refine(
        (v) => v.score >= 90 || v.grade !== "A",
        "grade A requires score >= 90",
      ),
      () => ({ score: 95, grade: "A" }),
    );
    const result = mock(schema);
    expect(result.score).toBe(95);
    expect(result.grade).toBe("A");
  });

  it("invalid hint falls back to retry loop", () => {
    // Hint returns something invalid; generation should still succeed via retries.
    // The schema accepts even numbers; the hint returns an odd number.
    const schema = withGenerate(
      z.number().int().min(0).max(100).refine((n) => n % 2 === 0, "must be even"),
      () => 3 as number, // intentionally invalid
    );
    // Retries should find an even number
    const result = mock(schema, { seed: 1 });
    expect(result % 2).toBe(0);
  });

  it("withGenerate does not mutate the schema — original still usable", () => {
    const base = z.string().min(3).refine((v) => v.startsWith("x"), "must start with x");
    const hinted = withGenerate(base, () => "xyz");

    // withGenerate returns the same schema object
    expect(hinted).toBe(base);

    // Both references work
    const r1 = mock(hinted);
    const r2 = mock(base);
    expect(r1).toBe("xyz");    // hint used via hinted
    expect(r2).toBe("xyz");    // hint is on the same object
  });

  it("hint works with v3 ZodEffects refinement", () => {
    // In v3, .refine() creates ZodEffects. The hint must be set on the ZodEffects wrapper.
    const schema = withGenerate(
      z.string().refine((v) => v.length > 20, "must be long"),
      () => "this-is-a-very-long-string-for-testing",
    );
    const result = mock(schema);
    expect(result.length).toBeGreaterThan(20);
  });

  it("withGenerate integrates with mockList", () => {
    const schema = withGenerate(
      z.number().int().refine((n) => n > 1000, "must be large"),
      () => 9999,
    );
    const list = mock(z.array(schema).length(3));
    expect(list.length).toBe(3);
    list.forEach((n) => expect(n).toBe(9999));
  });
});

// ─── mockAsync ───────────────────────────────────────────────────────────────

describe("mockAsync()", () => {
  it("returns a Promise", async () => {
    const result = mockAsync(z.string());
    expect(result).toBeInstanceOf(Promise);
    expect(typeof await result).toBe("string");
  });

  it("generates valid values for plain schemas", async () => {
    const schema = z.object({
      id: z.string().uuid(),
      name: z.string(),
      age: z.number().int().min(0).max(120),
    });
    const result = await mockAsync(schema);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("works with sync refinements (same as mock)", async () => {
    const schema = z.number().int().refine((n) => n % 2 === 0, "must be even");
    const result = await mockAsync(schema, { seed: 42, refinementRetries: 20 });
    expect(result % 2).toBe(0);
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("works with async superRefine (v4 / Zod-compatible)", async () => {
    // Simulated async refinement — uses a resolved promise (no real async I/O)
    const schema = z.number().int().min(0).max(100).superRefine(async (val, ctx) => {
      // Simulate an async check (e.g. checking a cache)
      await Promise.resolve();
      if (val % 2 !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be even" });
      }
    });

    // mockAsync should succeed by retrying until an even number is generated
    const result = await mockAsync(schema, { refinementRetries: 50 });
    expect(result % 2).toBe(0);
  });

  it("works with async refinement on object fields", async () => {
    // The async refinement on the score field requires score >= 50.
    // mockAsync retries the whole object until score >= 50 is satisfied.
    // Using a narrow range (50-100) makes success highly likely within a few retries.
    const schema = z.object({
      name: z.string(),
      score: z.number().int().min(50).max(100).superRefine(async (val, ctx) => {
        await Promise.resolve();
        if (val < 50) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be >= 50" });
      }),
    });

    const result = await mockAsync(schema, { refinementRetries: 5 });
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(schema.safeParseAsync(result)).resolves.toMatchObject({ success: true });
  });

  it("supports overrides", async () => {
    const schema = z.object({ name: z.string(), age: z.number().int().positive() });
    const result = await mockAsync(schema, { overrides: { name: "Alice" } });
    expect(result.name).toBe("Alice");
    expect(typeof result.age).toBe("number");
  });

  it("throws INVALID_OVERRIDE for bad overrides", async () => {
    const schema = z.object({ age: z.number().positive() });
    await expect(mockAsync(schema, { overrides: { age: -5 } })).rejects.toThrow(ZodForgeError);
    await expect(mockAsync(schema, { overrides: { age: -5 } })).rejects.toMatchObject({
      code: "INVALID_OVERRIDE",
    });
  });

  it("supports seeded generation", async () => {
    const schema = z.object({ x: z.number(), label: z.string() });
    const a = await mockAsync(schema, { seed: 99 });
    const b = await mockAsync(schema, { seed: 99 });
    // Seeded generation should be deterministic
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("withGenerate hint works with mockAsync", async () => {
    const schema = withGenerate(
      z.string().superRefine(async (val, ctx) => {
        await Promise.resolve();
        if (!val.includes("@")) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "no @" });
      }),
      () => "hint@example.com",
    );
    const result = await mockAsync(schema);
    expect(result).toBe("hint@example.com");
  });

  it("throws GENERATION_FAILED for unsatisfiable async refinements after retries", async () => {
    // Refinement that always fails
    const schema = z.number().superRefine(async (_, ctx) => {
      await Promise.resolve();
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "always fails" });
    });
    await expect(mockAsync(schema, { refinementRetries: 3 })).rejects.toThrow(ZodForgeError);
    await expect(mockAsync(schema, { refinementRetries: 3 })).rejects.toMatchObject({
      code: "GENERATION_FAILED",
    });
  });

  it("works with transform schemas (same as mock)", async () => {
    const schema = z.string().transform((s) => s.toUpperCase());
    const result = await mockAsync(schema);
    expect(typeof result).toBe("string");
    expect(result).toBe(result.toUpperCase());
  });

  it("works with z.promise() schema", async () => {
    // mockAsync returns Promise<z.infer<S>>. For z.promise(T), z.infer<S> = Promise<T>.
    // Awaiting an async function that returns Promise<Promise<T>> auto-unwraps to T.
    // So `result` here is already the inner number, not a Promise.
    const schema = z.promise(z.number().int());
    const result = await mockAsync(schema);
    expect(typeof result).toBe("number");
  });
});
