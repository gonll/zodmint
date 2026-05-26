# Changelog

All notable changes to zodmint are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.9.0] - 2026-05-25

### Added
- **Overrides on transform schemas** — `mock(schema, { overrides })` now works when the schema contains `.transform()`. Overrides are applied to the pre-transform input value; `safeParse` then runs the transform exactly once. The most common case (object transform adding computed fields) works intuitively. Type-changing transforms (e.g. `z.string().transform(s => parseInt(s))`) throw `INVALID_OVERRIDE` if the override is incompatible with the input type. Previously threw `UNSUPPORTED_SCHEMA`.
- **`z.preprocess()` with non-primitive output** — `z.preprocess(fn, z.object({...}))` and similar schemas with complex output types (object, array, union, etc.) now generate valid values from the output schema directly. Previously threw `UNSUPPORTED_SCHEMA`.

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
