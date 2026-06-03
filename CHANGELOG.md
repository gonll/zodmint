# Changelog

All notable changes to zodmint are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.7.0] - 2026-06-03

### Added
- **`zodmint/hono`** — new sub-entry for testing Hono routes with schema-valid mock data. `mockHonoHandler(schema, options?)` returns a Hono `Handler` that responds with `c.json(mock(schema))`. `mockHonoApp(specs)` builds a complete stub Hono app from a route spec array (`"METHOD /path"`). Supports `status`, `headers`, all `MockOptions`. Invalid method or malformed route throws `ZodForgeError`. Peer dep: `hono >= 3.0.0`.
- **`zodmint/trpc`** — new sub-entry for mocking tRPC callers. `mockTrpcCaller(procedureMap)` returns a Proxy-based caller where any procedure chain resolves to `Promise<z.infer<S>>`. No `@trpc/server` peer dependency required. Procedure map values can be bare schemas or `{ schema, options }` for per-procedure `MockOptions`. Unknown procedures return `Promise<undefined>`. `mockProcedureOutput(schema, options?)` is a synchronous named wrapper around `mock()` for one-off output generation.

---

## [2.6.0] - 2026-06-03

### Added
- **`zodmint/tanstack-query`** — new sub-entry for pre-populating `QueryClient` cache in tests. Framework-agnostic: imports only from `@tanstack/query-core`, works with React, Vue, Svelte, and Solid.
  - `mockQueryClient(entries, defaultOptions?)` — creates a `QueryClient` with synchronously pre-populated cache via `setQueryData`. Applies test-friendly defaults (`retry: false`, `staleTime: Infinity`, `gcTime: Infinity`). Each entry maps a query key array to a Zod schema plus optional `MockOptions`.
  - `mockQueryFn(schema, options?)` — returns a `queryFn`-compatible function for use directly inside `useQuery`. Useful when you want zodmint data without bypassing the query lifecycle.
  - `mockInfiniteQueryClient(entries, defaultOptions?)` — same as `mockQueryClient` but produces TanStack Query v5 infinite data shape (`{ pages: [items[]], pageParams: [undefined] }`). Configurable `pageSize` per entry.
- `@tanstack/query-core >= 5.0.0` added as optional peer dependency.

---

## [2.5.1] - 2026-06-03

### Fixed
- `examples/16-storybook.ts` import corrected to `zodmint/storybook` (was pointing at `../src/storybook.js`)
- `playground/index.ts` updated with `mockAll` and `zodArgTypes`/`mockArgs` sections

---

## [2.5.0] - 2026-06-03

### Added
- **`mockAll(schema, options?)`** — returns the full boundary set for a schema. For numbers, generates min, min+1, max-1, max (plus 0 if in range). For enums, returns every value. For booleans, always `[true, false]`. For optionals/nullables, includes `undefined`/`null` alongside the inner type's boundary values. For unions, one value per branch. For arrays, empty/1/2-item variants plus length-constrained boundaries. Duplicates are removed. Every returned value passes `schema.safeParse(v).success === true`. Accepts the same options as `mock()` (`seed`, `session`, `generators`); the `mode` option is ignored.
- **`zodmint/storybook`** — new sub-entry with `zodArgTypes(schema)` and `mockArgs(schema, options?)`. `zodArgTypes` maps a Zod object schema to a Storybook `ArgTypes` record — string→text, number→number (range when both min and max are present), boolean→boolean, enum→select, date→date, object/array→object. `z.optional()` and `z.nullable()` are transparently unwrapped. `z.describe()` populates the `description` field. `mockArgs` is a typed wrapper around `mock()` for generating story `args`. Zero runtime dependencies — no `@storybook/*` import required.

---

## [2.4.0] - 2026-05-29

### Added
- **`zodmint/seed`** — new sub-entry for schema-driven database seeding. `seed(inserter, schema, options?)` generates `count` valid fixtures and inserts them via any async function. Returns the full array of generated items for chaining.
- **`prismaInserter(model)`** — wraps a Prisma model delegate (`createMany`) into a `SeedInserter`. Zero runtime dependency: uses duck typing, so no `@prisma/client` import is required in `zodmint/seed` itself.
- **`drizzleInserter(db, table)`** — wraps a Drizzle `db.insert(table).values()` call into a `SeedInserter`. Same approach: duck typed, no drizzle-orm import.
- **`SeedOptions`** — extends `MockOptions` with `count` (default 10), `batchSize` (default: single batch), and `async` (uses `mockAsync()` when true, for schemas with async refinements).
- **Batched inserts** — when `batchSize < count`, records are split into chunks and inserted sequentially, respecting ORM and DB row limits per statement.
- **Seeded determinism** — when a `seed` value is provided, each item receives an offset seed (`seed + i`) so items are distinct but the full result set is reproducible.
- `@prisma/client >= 5.0.0` and `drizzle-orm >= 0.29.0` added as optional peer dependencies.

---

## [2.3.0] - 2026-05-29

### Added
- **`factory.async(callOptions?)`** — async counterpart to calling a `MockFactory` directly. Uses `mockAsync()` internally, so it correctly handles schemas with async `z.superRefine()` predicates (which would throw "Encountered Promise during synchronous parse" via the sync path in Zod v4). Returns `Promise<z.infer<S>>`.
- **Async `afterBuild` support** — `afterBuild` may now return `Promise<z.infer<S>>` when the factory is called via `.async()`. The sync `factory()` call detects a returned `Promise` and throws `ZodForgeError [GENERATION_FAILED]` with a clear message pointing to `.async()`. This prevents silent async-in-sync bugs.
- **`afterBuild` chaining is async-aware** — `factory.extend()` chains `afterBuild` hooks in a Promise-transparent way: if the base hook returns a `Promise`, the chain awaits it before passing the result to the extend hook. Two sync hooks chain synchronously as before.

### Fixed
- Empty merged overrides (`{}`) from factory state resolution are now normalized to `undefined` before being passed to `mock()`/`mockAsync()`. Previously, calling a factory with no base overrides, no states, and no per-call overrides still passed `overrides: {}` to the pipeline, causing it to throw `INVALID_OVERRIDE` instead of retrying when a refinement failed.

---

## [2.0.0] - 2026-05-26

### Added
- **`mockAsync(schema, options?)`** — async counterpart to `mock()` for schemas containing `z.superRefine()` with async predicates. Uses `schema.safeParseAsync()` internally, retries up to `refinementRetries` times (default 10) when async predicates fail, and resolves with a fully valid `z.infer<S>` value.
- **`withGenerate(schema, () => value)`** — attaches a generation hint to any schema. For schemas with refinements that are hard or impossible to satisfy by random generation (e.g. DB uniqueness checks), the hint factory is called first; if the value passes validation it is used directly, bypassing the retry loop. Works with both `mock()` and `mockAsync()`. The hint is stored in a `WeakMap` (zero GC overhead).
- `mockAsync` and `withGenerate` are now exported from the main package.

### Changed
- `asyncMode` field added to `GenerationContext` (internal). When `true`, `dispatch()` skips internal synchronous refinement loops to prevent "Encountered Promise during synchronous parse" in Zod v4.

---

## [1.9.0] - 2026-05-25

### Added
- **Overrides on transform schemas** — `mock(schema, { overrides })` now works when the schema contains `.transform()`. Overrides are applied to the pre-transform input value; `safeParse` then runs the transform exactly once. The most common case (object transform adding computed fields) works intuitively. Type-changing transforms (e.g. `z.string().transform(s => parseInt(s))`) throw `INVALID_OVERRIDE` if the override is incompatible with the input type. Previously threw `UNSUPPORTED_SCHEMA`.
- **`z.preprocess()` with non-primitive output** — `z.preprocess(fn, z.object({...}))` and similar schemas with complex output types (object, array, union, etc.) now generate valid values from the output schema directly. Previously threw `UNSUPPORTED_SCHEMA`.

### Fixed
- **Semantic inference ignoring `z.string().length(n)` exact-length constraint** — semantic values (e.g. a full country name for a field named `country`) were not checked against `c.length`, so they could pass through even when they violated an exact-length constraint. The semantic validity check now includes `exactOk = c.length === undefined || semanticValue.length === c.length`.

### Changed
- Error semantics: passing an incompatible override to a transform schema now throws `INVALID_OVERRIDE` (not `UNSUPPORTED_SCHEMA`).

---

## [1.8.1] - 2026-05-25

### Fixed
- **Numeric `z.nativeEnum()`** - generated string key names instead of numeric values due to an inverted filter. Now correctly returns the numeric member values.
- **`z.string().includes()`** - the constraint was parsed but never applied. Generated strings now always contain the required substring.
- **`z.bigint().positive()` / `.negative()`** - v3 exclusive bounds (`.positive()` = `min(0, exclusive)`) were treated as inclusive, allowing `0n` which fails `safeParse`. Now maps to `gt`/`lt` correctly.
- **Double `safeParse` on path-based generators** - when a generator matched a field with `.transform()`, the transform ran twice: once inside `dispatch()` and again in the outer pipeline. The inner `safeParse` call is removed; the pipeline's single outer `safeParse` handles validation.
- **`dispatchDiscriminatedUnion` bypassed pipeline** - called `dispatchObject()` directly, skipping refinement retry logic. Now routes through `dispatch()` so `.refine()` on a branch object retries correctly.
- **`arb()` set/map size constraints ignored** - `arbSet` and `arbMap` hardcoded `{min:2, max:4}`. Now read constraints from the schema. Both also switch to `fc.uniqueArray` so shrinking cannot collapse the collection below the minimum.
- **`arb()` tuple `.rest()` elements ignored** - `arbTuple` only generated fixed items. Now appends 0–3 rest elements when the schema has a `.rest()` schema.
- **`lazyDepth` module-level state** - replaced with a closure parameter threaded through `arbAny` to prevent corruption across concurrent `arb()` calls.
- **Custom matchers not applied to `z.bigint()` / `z.date()`** - `dispatchBigInt` and `dispatchDate` now call `applyCustomMatchers()` in realistic mode, matching the behavior of `dispatchString` and `dispatchNumber`.
- Removed dead `UNSUPPORTED_MODE` error code (never thrown).
- Fixed misleading "alternate between low and high boundary" comment in `generateEdgeNumber` (always returned the lowest candidate).
- Fixed CLAUDE.md pipeline step ordering — overrides are applied before `safeParse`, not after.

## [1.8.0] - 2026-05-25

### Added
- Session/scope threading (`createSession()`, `session` option on `mock()`) - threads mutable state through generators and matchers across multiple `mock()` calls. Accessible via `MatcherContext.session`.
- `seq(key, session?)` - incrementing integer sequence per key, backed by the session. Starts at 1, independent per key.
- fast-check integration (`zodmint/fast-check`, `arb(schema)`) - converts any Zod schema to a real `fc.Arbitrary` with proper shrinking. Maps each Zod type to native fast-check primitives. Requires `fast-check >= 3.0.0` as a peer dependency.
- Violation testing (`violate` option on `mock()`) - `mock(schema, { violate: ["email", "age"] })` generates intentionally invalid values at specified paths for testing validation error handling. Non-violated fields remain valid.

### Changed
- `z.custom()` no longer throws `UNSUPPORTED_SCHEMA` - now generates a random primitive (string, number, or boolean) as best-effort. Use a path-based generator for a specific valid value.

### Fixed
- `z.preprocess()` with non-primitive output now emits an actionable error message including the path-based generator workaround.

---

## [1.7.0] - 2026-05-24

### Added
- examples/ directory with practical usage examples covering mock(), mockFactory(), states, plugins, and MSW integration

### Fixed
- Removed null byte from package.json
- Added sideEffects: false field (already in 1.5.2 entry, but this was the original fix commit)

---

## [1.6.0] - 2026-05-22

### Added
- z.symbol() support - generates a Symbol with a seeded label derived from the path for debuggability
- Plugin system (definePlugin(), configure({ plugins })) - bundles field matchers into reusable distributable packages. Plugin matchers have lower priority than explicit matchers but higher than built-in semantic inference.
- MatcherContext parameter on FieldMatcher.generate - matchers now receive { path, leaf } for path-aware value generation. Backward compatible: existing generate: () => value matchers continue to work unchanged.

---

## [1.5.2] — 2026-05-22

### Fixed
- Malformed `package.json` — removed stray entries from `keywords` array
- Added `sideEffects: false` for correct tree-shaking in bundled apps
- Added `engines: { "node": ">=18" }` to document minimum runtime requirement
- `CHANGELOG.md` added to published `files`

---

## [1.5.0] — 2026-05-01

### Added
- `z.promise(T)` support — generates `Promise.resolve(value)` where value is derived from `T`
- `z.coerce.*` support (`string`, `number`, `boolean`, `bigint`, `date`) — generates the target type directly
- `z.preprocess()` with primitive output now treated as coerce (no longer throws `UNSUPPORTED_SCHEMA`)

### Changed
- `UNSUPPORTED_MODE` error code retired — all three modes (`realistic`, `edge`, `random`) are now fully implemented

---

## [1.4.0] — 2026-04-10

### Added
- Broad regex support for `z.string().regex()`: literals, character classes, shorthands (`\d`, `\w`, `\s`), alternation, quantifiers, anchors, lazy variants
- `REGEX_UNSUPPORTED` error code for unsupported patterns (lookahead, backreferences, named groups, unicode properties)

### Fixed
- Semantic generators now fall back to generic constraint-safe generation when name-based heuristic conflicts with active constraints (e.g. `age` field with `.max(5)`)

---

## [1.3.0] — 2026-03-18

### Added
- `mode: "edge"` — boundary value generation (min-length strings, `0` for numbers, `false` for booleans, `[]` for unconstrained arrays, epoch for dates)
- `mode: "random"` — disables all semantic inference; only hard format constraints are respected
- `z.object({}).catchall(T)` — generates declared fields plus 1–3 additional key-value pairs conforming to `T`

---

## [1.2.0] — 2026-02-20

### Added
- `withConfig(options, fn)` — scoped config that restores previous state after the callback, even on throw; preferred over `configure()` + `resetConfig()` in tests
- `afterBuild` hook on `mockFactory` — runs after all overrides are applied; receives the fully-resolved value
- `factory.extend(options)` — derives a new factory; chains `afterBuild`, merges `states` by key, deep-merges `overrides`

### Changed
- Merge priority for factories clarified: `base overrides → state overrides (left-to-right) → per-call overrides`

---

## [1.1.0] — 2026-01-30

### Added
- `states` support on `mockFactory` — named override presets activated at call time via `states: string | string[]`
- Schema description as semantic hint — `z.describe("email")` takes priority over field name inference
- `generators` option on `mock()` and `mockList()` — dot-separated path-based generator overrides with `*` for array positions
- `zodForgeMatchers` (`toMatchSchema`) for vitest/jest, exported from `zodmint/testing`

### Fixed
- `z.discriminatedUnion` now correctly sets the discriminator key on the selected branch
- `z.intersection` deep-merge: arrays now replace rather than concatenate

---

## [1.0.0] — 2026-01-08

### Added
- `mock(schema, options?)` — generates a single schema-valid value; always typed as `z.infer<typeof schema>`
- `mockFactory(schema, options?)` — returns a reusable typed factory callable with per-call overrides
- `mockList(schema, options?)` — generates an array of independent fixtures
- `configure(options)` / `resetConfig()` — global defaults with immutable per-call snapshot
- Seeded deterministic RNG (`seed` option) — same seed on same schema always produces same output
- Deep partial override merge — objects recurse, arrays replace, `undefined` is a no-op
- Semantic inference for string and numeric field names (`email`, `age`, `price`, `url`, etc.)
- Custom matcher registration via `configure({ matchers: [...] })`
- All standard Zod constraint handling: `.min()`, `.max()`, `.int()`, `.positive()`, `.email()`, `.uuid()`, `.regex()`, and more
- `z.refine()` / `z.superRefine()` via generate-and-test loop (configurable `refinementRetries`, default 10)
- Full Zod type coverage: primitives, `literal`, `enum`, `nativeEnum`, `optional`, `nullable`, `default`, `catch`, `object`, `array`, `tuple`, `union`, `discriminatedUnion`, `intersection`, `record`, `map`, `set`, `lazy`, `readonly`, `brand`, `unknown`, `any`, `nan`, `void`
- `ZodForgeError` with typed error codes: `UNSUPPORTED_SCHEMA`, `INVALID_OVERRIDE`, `REGEX_UNSUPPORTED`, `MAX_DEPTH_EXCEEDED`, `GENERATION_FAILED`
- Zod v3 and v4 compatibility
