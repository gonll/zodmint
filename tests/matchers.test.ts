import { describe, it } from "vitest";
import { z } from "zod";
import { zodForgeMatchers } from "../src/testing.js";
import { expect as vitestExpect } from "vitest";

vitestExpect.extend(zodForgeMatchers);

describe("toMatchSchema matcher", () => {
  it("passes for valid values", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    vitestExpect({ name: "Alice", age: 30 }).toMatchSchema(schema);
  });

  it("fails for invalid values", () => {
    const schema = z.object({ name: z.string() });
    vitestExpect(() =>
      vitestExpect({ name: 42 }).toMatchSchema(schema)
    ).toThrow();
  });
});
