import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/testing.ts", "src/fast-check.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // splitting: true emits a shared chunk so index.js and fast-check.js don't
  // each embed a full copy of the same ~87 KB of shared generator code.
  splitting: true,
  treeshake: true,
  // esbuild minification — removes whitespace, comments, and mangles locals.
  // Cuts the shared chunk from ~87 KB to ~45 KB uncompressed.
  minify: true,
});
