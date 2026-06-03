import { defineConfig } from "tsup";

export default defineConfig([
  // Main library bundles (ESM + CJS)
  {
    entry: [
      "src/index.ts",
      "src/testing.ts",
      "src/fast-check.ts",
      "src/msw.ts",
      "src/seed.ts",
      "src/storybook.ts",
      "src/tanstack-query.ts",
    ],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    // splitting: true emits a shared chunk so index.js and fast-check.js don't
    // each embed a full copy of the same ~87 KB of shared generator code.
    splitting: true,
    treeshake: true,
    // esbuild minification — removes whitespace, comments, and mangles locals.
    // Cuts the shared chunk from ~87 KB to ~45 KB uncompressed.
    minify: true,
  },
  // CLI binary — ESM only, no splitting, shebang injected
  {
    entry: { bin: "src/bin.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    treeshake: true,
    minify: false,
    // src/bin.ts already starts with #!/usr/bin/env node — no banner needed
  },
]);
