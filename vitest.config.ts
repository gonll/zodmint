import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    // examples/ import the public package name (as real consumers would)
    // rather than relative src paths. Alias it to local source so the
    // examples soak test can import them without a build step.
    alias: {
      "zodmint/testing": src("testing.ts"),
      "zodmint/fast-check": src("fast-check.ts"),
      "zodmint/msw": src("msw.ts"),
      "zodmint/seed": src("seed.ts"),
      "zodmint/storybook": src("storybook.ts"),
      "zodmint/tanstack-query": src("tanstack-query.ts"),
      "zodmint/trpc": src("trpc.ts"),
      "zodmint/hono": src("hono.ts"),
      zodmint: src("index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
