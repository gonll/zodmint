import { z } from "zod";

/**
 * Custom vitest/jest matcher. Call expect.extend(zodForgeMatchers) in your
 * test setup file to enable expect(value).toMatchSchema(schema).
 *
 * @example
 * // vitest.setup.ts
 * import { zodForgeMatchers } from "zod-mock-forge/testing";
 * expect.extend(zodForgeMatchers);
 *
 * // in tests:
 * expect(mock(UserSchema)).toMatchSchema(UserSchema);
 */
export const zodForgeMatchers = {
  toMatchSchema(received: unknown, schema: z.ZodTypeAny) {
    const result = schema.safeParse(received);
    if (result.success) {
      return {
        message: () => `Expected value NOT to match schema, but it did`,
        pass: true,
      };
    }
    const issues = result.error.issues
      .map(i => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    return {
      message: () => `Expected value to match schema, but got errors:\n${issues}`,
      pass: false,
    };
  },
};
