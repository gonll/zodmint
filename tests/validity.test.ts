/**
 * Core validity contract: schema.safeParse(mock(schema)).success === true
 * for a comprehensive set of schemas.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mock } from "../src/mock.js";

function valid<S extends z.ZodTypeAny>(schema: S, times = 10) {
  for (let i = 0; i < times; i++) {
    const value = mock(schema);
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new Error(
        `Validity contract violated.\nValue: ${JSON.stringify(value, null, 2)}\nErrors: ${JSON.stringify(result.error.errors, null, 2)}`
      );
    }
  }
}

describe("validity contract", () => {
  it("z.string()", () => valid(z.string()));
  it("z.string().min(5)", () => valid(z.string().min(5)));
  it("z.string().max(10)", () => valid(z.string().max(10)));
  it("z.string().min(3).max(8)", () => valid(z.string().min(3).max(8)));
  it("z.string().email()", () => valid(z.string().email()));
  it("z.string().url()", () => valid(z.string().url()));
  it("z.string().uuid()", () => valid(z.string().uuid()));
  it("z.string().startsWith('foo')", () => valid(z.string().startsWith("foo")));
  it("z.string().endsWith('bar')", () => valid(z.string().endsWith("bar")));
  it("z.string().length(7)", () => valid(z.string().length(7)));

  it("z.number()", () => valid(z.number()));
  it("z.number().int()", () => valid(z.number().int()));
  it("z.number().min(5).max(10)", () => valid(z.number().min(5).max(10)));
  it("z.number().positive()", () => valid(z.number().positive()));
  it("z.number().negative()", () => valid(z.number().negative()));
  it("z.number().multipleOf(3)", () => valid(z.number().multipleOf(3)));
  it("z.number().int().min(0).max(100)", () => valid(z.number().int().min(0).max(100)));

  it("z.bigint()", () => valid(z.bigint()));
  it("z.bigint().min(0n)", () => valid(z.bigint().min(0n)));
  it("z.bigint().max(100n)", () => valid(z.bigint().max(100n)));

  it("z.boolean()", () => valid(z.boolean()));
  it("z.date()", () => valid(z.date()));
  it("z.date().min(new Date('2020-01-01'))", () => valid(z.date().min(new Date("2020-01-01"))));
  it("z.date().max(new Date())", () => valid(z.date().max(new Date())));

  it("z.enum(['a','b','c'])", () => valid(z.enum(["a", "b", "c"])));
  it("z.literal('hello')", () => valid(z.literal("hello")));
  it("z.literal(42)", () => valid(z.literal(42)));

  it("z.array(z.string())", () => valid(z.array(z.string())));
  it("z.array(z.number()).min(2).max(4)", () => valid(z.array(z.number()).min(2).max(4)));
  it("z.array(z.string()).length(3)", () => valid(z.array(z.string()).length(3)));

  it("z.tuple([z.string(), z.number()])", () => valid(z.tuple([z.string(), z.number()])));

  it("z.object({ name: z.string(), age: z.number() })", () =>
    valid(z.object({ name: z.string(), age: z.number() })));

  it("z.object with nested object", () =>
    valid(z.object({
      user: z.object({
        name: z.string(),
        email: z.string().email(),
        age: z.number().int().min(0).max(120),
      }),
      active: z.boolean(),
    })));

  it("z.optional(z.string())", () => valid(z.optional(z.string())));
  it("z.nullable(z.string())", () => valid(z.nullable(z.string())));
  it("z.string().optional()", () => valid(z.string().optional()));
  it("z.number().nullable()", () => valid(z.number().nullable()));

  it("z.union([z.string(), z.number()])", () => valid(z.union([z.string(), z.number()])));
  it("z.discriminatedUnion", () =>
    valid(z.discriminatedUnion("type", [
      z.object({ type: z.literal("a"), value: z.string() }),
      z.object({ type: z.literal("b"), count: z.number() }),
    ])));

  it("z.record(z.string(), z.number())", () => valid(z.record(z.string(), z.number())));

  it("z.intersection of objects", () =>
    valid(z.intersection(
      z.object({ a: z.string() }),
      z.object({ b: z.number() }),
    )));

  it("z.string().default('hello')", () => valid(z.string().default("hello")));
  it("z.number().catch(0)", () => valid(z.number().catch(0)));

  it("z.unknown()", () => valid(z.unknown()));
  it("z.any()", () => valid(z.any()));

  it("z.coerce.string()", () => valid(z.coerce.string()));
  it("z.coerce.number()", () => valid(z.coerce.number()));
  it("z.coerce.boolean()", () => valid(z.coerce.boolean()));

  it("z.object().strict()", () =>
    valid(z.object({ x: z.string() }).strict()));

  it("z.object(...).readonly()", () =>
    valid(z.object({ id: z.string(), val: z.number() }).readonly()));

  it("z.string().brand<'ID'>()", () => valid(z.string().brand<"ID">()));
});
