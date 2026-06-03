// 16-storybook.ts — zodmint/storybook: argTypes + mockArgs for Storybook stories
import { z } from "zod";
import { zodArgTypes, mockArgs } from "../src/storybook.js";

const ButtonPropsSchema = z.object({
  label: z.string().describe("Button text"),
  disabled: z.boolean().optional(),
  size: z.enum(["sm", "md", "lg"]),
  onClick: z.function().optional(),
});

// Use in story default export:
const argTypes = zodArgTypes(ButtonPropsSchema);
console.log("argTypes:", JSON.stringify(argTypes, null, 2));

// Use for story args:
const args = mockArgs(ButtonPropsSchema);
console.log("args:", args);
