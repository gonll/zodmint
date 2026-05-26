import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mock } from "../src/mock.js";
import { ZodForgeError } from "../src/errors.js";

describe("mock() with violate option", () => {
  it("violates a string email field", () => {
    const schema = z.object({ email: z.string().email() });
    const result = mock(schema, { violate: ["email"] });
    // The full schema should fail
    expect(schema.safeParse(result).success).toBe(false);
  });

  it("violates a number field", () => {
    const schema = z.object({ age: z.number().int().min(18) });
    const result = mock(schema, { violate: ["age"] });
    expect(schema.safeParse(result).success).toBe(false);
  });

  it("non-violated fields remain valid", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int().min(18),
    });
    const result = mock(schema, { violate: ["age"] });
    // name is untouched and valid
    expect(z.string().safeParse(result.name).success).toBe(true);
  });

  it("violates a boolean field", () => {
    const schema = z.object({ active: z.boolean() });
    const result = mock(schema, { violate: ["active"] });
    expect(schema.safeParse(result).success).toBe(false);
  });

  it("violates a nested field via dot path", () => {
    const schema = z.object({
      user: z.object({ id: z.string().uuid() }),
    });
    const result = mock(schema, { violate: ["user.id"] });
    expect(schema.safeParse(result).success).toBe(false);
  });

  it("empty violate list behaves like normal generation", () => {
    const schema = z.object({ name: z.string() });
    const result = mock(schema, { violate: [] });
    expect(schema.safeParse(result).success).toBe(true);
  });

  it("violates a positive number constraint", () => {
    const schema = z.object({ score: z.number().positive() });
    const result = mock(schema, { violate: ["score"] });
    expect(schema.safeParse(result).success).toBe(false);
  });

  it("throws INVALID_OVERRIDE when violate and overrides share a path", () => {
    const schema = z.object({ email: z.string().email() });
    expect(() =>
      mock(schema, { violate: ["email"], overrides: { email: "test@example.com" } })
    ).toThrow(ZodForgeError);
  });

  it("violates an enum field", () => {
    const schema = z.object({ status: z.enum(["active", "inactive"]) });
    const result = mock(schema, { violate: ["status"] });
    expect(schema.safeParse(result).success).toBe(false);
  });

  it("violates a string min-length constraint", () => {
    const schema = z.object({ code: z.string().min(5) });
    const result = mock(schema, { violate: ["code"] });
    expect(schema.safeParse(result).success).toBe(false);
  });
});
