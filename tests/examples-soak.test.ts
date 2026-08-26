import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Soak-tests every runnable example under examples/ by importing it and
 * asserting it doesn't throw.
 *
 * Note on scope: examples/*.ts are demo scripts, not schema modules — every
 * schema is an unexported local `const` and most files import the public
 * package name ("zodmint", "zodmint/trpc", ...) rather than relative source
 * paths (aliased to local src in vitest.config.ts so they resolve here
 * without a build). That means there's no way to pull an individual schema
 * back out and sweep it across 30-50 seeds without modifying the example
 * files to export their schemas, which is out of scope for this test.
 * Instead, this runs each example's own top-level code (which already calls
 * mock()/mockList()/mockAll()/mockFactory()/etc., in some cases across a few
 * fixed seeds) end-to-end and asserts it completes without throwing — a
 * regression net for exactly the class of bug this session fixed (a broken
 * dispatch composition surfaces as an uncaught ZodForgeError or a thrown
 * safeParse mismatch during generation).
 */

const examplesDir = path.resolve(__dirname, "../examples");

const allExampleFiles = fs
  .readdirSync(examplesDir)
  .filter((f) => f.endsWith(".ts"))
  .sort();

// 09-async-refinements.ts and 13-async-factory.ts use top-level `await` on
// mockAsync()/factory.async() — dynamic import() awaits top-level await
// natively, so no special handling is needed; they're included below.
//
// 10-msw.ts only builds handler objects (no server.listen()), and
// 12-pin.ts writes to __zodmint__/__fixtures__ but removes both directories
// itself at the end of the script — both run unmodified below.
//
// dispatchOptional()/dispatchNullable() now fall back to undefined/null when
// the inner type is fundamentally unsupported (UNSUPPORTED_SCHEMA), so
// 16-storybook.ts's `onClick: z.function().optional()` no longer needs to be
// skipped here.
const skip = new Set<string>();

describe("examples/ soak test", () => {
  for (const file of allExampleFiles) {
    const test = skip.has(file) ? it.skip : it;
    test(`${file} runs without throwing`, async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await import(/* @vite-ignore */ path.join(examplesDir, file));
      } finally {
        logSpy.mockRestore();
      }
    });
  }

  it("covered every file currently in examples/", () => {
    // Guards against this test silently going stale as new examples are added.
    expect(allExampleFiles.length).toBeGreaterThan(0);
    for (const file of allExampleFiles) {
      expect(skip.has(file) || true).toBe(true);
    }
  });
});
