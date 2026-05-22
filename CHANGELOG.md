# Changelog

All notable changes to zodmint are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
