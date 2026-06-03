import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodArgTypes, mockArgs } from "../src/storybook.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BasicSchema = z.object({
  name: z.string(),
  age: z.number(),
  score: z.number().min(0).max(100),
  active: z.boolean(),
  role: z.enum(["admin", "user", "guest"]),
  bio: z.string().optional(),
  label: z.string().describe("Button label"),
});

// ---------------------------------------------------------------------------
// zodArgTypes
// ---------------------------------------------------------------------------

describe("zodArgTypes", () => {
  it("returns a key for each field in the object schema", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(Object.keys(argTypes)).toEqual(
      expect.arrayContaining(["name", "age", "score", "active", "role", "bio", "label"]),
    );
  });

  it("maps z.string() to { control: 'text' }", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(argTypes.name.control).toBe("text");
  });

  it("maps z.number() (no bounds) to { control: 'number' }", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(argTypes.age.control).toBe("number");
  });

  it("maps z.number().min(x).max(y) to { control: { type: 'range', min, max } }", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(argTypes.score.control).toEqual({ type: "range", min: 0, max: 100 });
  });

  it("maps z.boolean() to { control: 'boolean' }", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(argTypes.active.control).toBe("boolean");
  });

  it("maps z.enum([...]) to { control: 'select', options: [...] }", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(argTypes.role.control).toBe("select");
    expect(argTypes.role.options).toEqual(["admin", "user", "guest"]);
  });

  it("maps z.string().optional() to a control (unwraps optional)", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(argTypes.bio).toBeDefined();
    expect(argTypes.bio.control).toBe("text");
  });

  it("includes description from schema.describe()", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(argTypes.label.description).toBe("Button label");
  });

  it("maps z.date() to { control: 'date' }", () => {
    const schema = z.object({ createdAt: z.date() });
    const argTypes = zodArgTypes(schema);
    expect(argTypes.createdAt.control).toBe("date");
  });

  it("maps z.object() nested field to { control: 'object' }", () => {
    const schema = z.object({ meta: z.object({ key: z.string() }) });
    const argTypes = zodArgTypes(schema);
    expect(argTypes.meta.control).toBe("object");
  });

  it("maps z.array() to { control: 'object' }", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const argTypes = zodArgTypes(schema);
    expect(argTypes.tags.control).toBe("object");
  });

  it("maps z.nativeEnum() to { control: 'select', options: [...] }", () => {
    enum Direction { Up = "UP", Down = "DOWN" }
    const schema = z.object({ dir: z.nativeEnum(Direction) });
    const argTypes = zodArgTypes(schema);
    expect(argTypes.dir.control).toBe("select");
    expect(argTypes.dir.options).toEqual(expect.arrayContaining(["UP", "DOWN"]));
  });

  it("returns fallback { value: { control: 'text' } } for non-object schema", () => {
    const argTypes = zodArgTypes(z.string());
    expect(argTypes).toEqual({ value: { control: "text" } });
  });

  it("maps z.union([...]) to { control: 'select', options: [...] }", () => {
    const schema = z.object({
      status: z.union([z.literal("active"), z.literal("inactive")]),
    });
    const argTypes = zodArgTypes(schema);
    expect(argTypes.status.control).toBe("select");
    expect(Array.isArray(argTypes.status.options)).toBe(true);
  });

  it("description field is absent when schema has no .describe()", () => {
    const argTypes = zodArgTypes(BasicSchema);
    expect(argTypes.name.description).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mockArgs
// ---------------------------------------------------------------------------

describe("mockArgs", () => {
  it("returns a value that passes schema.safeParse()", () => {
    const result = mockArgs(BasicSchema);
    const parsed = BasicSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("accepts MockOptions (seed) and returns deterministic output", () => {
    const a = mockArgs(BasicSchema, { seed: 42 });
    const b = mockArgs(BasicSchema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("works with a non-object schema", () => {
    const schema = z.string().email();
    const result = mockArgs(schema);
    expect(schema.safeParse(result).success).toBe(true);
  });
});
