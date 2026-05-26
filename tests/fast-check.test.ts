import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as fc from "fast-check";
import { arb } from "../src/fast-check.js";

describe("arb()", () => {
  it("returns an object with a generate method (is an Arbitrary)", () => {
    const a = arb(z.string());
    expect(typeof a.generate).toBe("function");
  });

  it("arb(z.string()) - all generated values pass safeParse", () => {
    const schema = z.string();
    fc.assert(fc.property(arb(schema), v => schema.safeParse(v).success));
  });

  it("arb(z.string().email()) - all generated values pass email safeParse", () => {
    const schema = z.string().email();
    fc.assert(fc.property(arb(schema), v => schema.safeParse(v).success));
  });

  it("arb(z.number().int().min(1).max(100)) - all values in range and integers", () => {
    const schema = z.number().int().min(1).max(100);
    fc.assert(fc.property(arb(schema), v => {
      return Number.isInteger(v) && v >= 1 && v <= 100;
    }));
  });

  it("arb(z.boolean()) - all values are boolean", () => {
    fc.assert(fc.property(arb(z.boolean()), v => typeof v === "boolean"));
  });

  it("arb(z.object) - all values pass safeParse", () => {
    const schema = z.object({ name: z.string(), age: z.number().int() });
    fc.assert(fc.property(arb(schema), v => schema.safeParse(v).success));
  });

  it("arb(z.array(z.string()).min(1).max(5)) - all values pass safeParse", () => {
    const schema = z.array(z.string()).min(1).max(5);
    fc.assert(fc.property(arb(schema), v => schema.safeParse(v).success));
  });

  it("arb(z.union([z.string(), z.number()])) - all values pass safeParse", () => {
    const schema = z.union([z.string(), z.number()]);
    fc.assert(fc.property(arb(schema), v => schema.safeParse(v).success));
  });

  it("arb(z.optional(z.string())) - all values pass safeParse", () => {
    const schema = z.optional(z.string());
    fc.assert(fc.property(arb(schema), v => schema.safeParse(v).success));
  });

  it("arb(z.literal('foo')) - all values equal 'foo'", () => {
    fc.assert(fc.property(arb(z.literal("foo")), v => v === "foo"));
  });

  it("arb(z.enum) - all values are valid enum members", () => {
    const schema = z.enum(["a", "b", "c"]);
    fc.assert(fc.property(arb(schema), v => ["a", "b", "c"].includes(v)));
  });

  it("arb(z.number().int().min(0).max(100)) - property passes (shrinking demo)", () => {
    expect(() => {
      fc.assert(fc.property(arb(z.number().int().min(0).max(100)), n => n >= 0 && n <= 100));
    }).not.toThrow();
  });

  it("arb(z.bigint()) - all values are bigints", () => {
    fc.assert(fc.property(arb(z.bigint()), v => typeof v === "bigint"));
  });

  it("arb(z.date()) - all values are Date instances", () => {
    fc.assert(fc.property(arb(z.date()), v => v instanceof Date));
  });

  it("arb(z.tuple([z.string(), z.number()])) - all values pass safeParse", () => {
    const schema = z.tuple([z.string(), z.number()]);
    fc.assert(fc.property(arb(schema), v => schema.safeParse(v).success));
  });
});
