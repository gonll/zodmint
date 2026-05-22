# zod-forge

Most test fixture libraries treat schema validation as an afterthought. You hand-write factories, sprinkle in faker calls, and somewhere down the line a test passes locally but blows up in CI because `faker.number.int()` produced a value that fails your `.positive()` constraint. zod-forge takes the opposite approach: the schema is the source of truth, and every value it generates is guaranteed to pass `schema.safeParse(output).success === true`.

No more babysitting fixtures. No more silent invalidity.

---

## How it works

You pass a Zod schema in, you get a valid value out. That's the whole contract. Internally, zod-forge walks the schema definition, resolves constraints, applies semantic inference from field names, and runs a single `safeParse` to get the fully-transformed output type. The result is always typed as `z.infer<typeof schema>` — no `any`, no casting.

```typescript
import { mock } from "zod-forge"
import { z } from "zod"

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().int().min(18).max(99),
  active: z.boolean(),
})

const user = mock(UserSchema)
// { id: "3f2e1d4c-...", email: "alice23@example.com", age: 34, active: true }
```

---

## Installation

```bash
npm install zod-forge
```

zod is a peer dependency, so make sure it's already in your project:

```bash
npm install zod
```

Requires zod `^3.23.0`.

---

## Core API

### `mock(schema, options?)`

The primary function. Generates a single value from any Zod schema.

```typescript
import { mock } from "zod-forge"

const user = mock(UserSchema)

const user = mock(UserSchema, {
  overrides: { email: "custom@test.com" },
  seed: 42,
  maxDepth: 3,
  useDefaults: true,
  mode: "realistic",
})
```

Options:

`overrides` lets you pin specific fields while letting zod-forge fill in the rest. Overrides are deep-merged, so you can target nested fields without recreating the entire object. If an override produces a value that fails schema validation, a `ZodForgeError [INVALID_OVERRIDE]` is thrown with the path and failing value clearly named.

`seed` makes generation deterministic. Same seed on the same schema produces the same output every time — useful for snapshot tests and reproducible bug reports. Determinism is guaranteed within a major version, but not across major versions (generators can be improved between releases).

`maxDepth` controls how deep recursive schemas go before terminating. Defaults to `2`. Optional objects terminate with `undefined`, arrays with `[]`, and required objects throw `MAX_DEPTH_EXCEEDED`.

`useDefaults`, when `true`, returns `.default()` values instead of generating new ones dynamically. Defaults to `false`.

`mode` accepts `"realistic"` only in v1. Passing `"edge"` or `"random"` throws `UNSUPPORTED_MODE` with a note about v2.

One thing worth understanding: `mock()` captures an immutable snapshot of the global config the moment it's called. Calling `configure()` partway through a generation run (say, inside a custom matcher) has no effect on the current call. This makes concurrent usage safe and test isolation predictable.

---

### `mockFactory(schema, options?)`

Returns a reusable factory function. Useful when you need multiple instances of the same shape with per-call variation.

```typescript
import { mockFactory } from "zod-forge"

const createUser = mockFactory(UserSchema)

const user1 = createUser()
const user2 = createUser({ overrides: { name: "Carol" } })
```

Base options provided to `mockFactory` apply to every call. Per-call options are merged on top, with per-call values winning conflicts:

```typescript
const createActiveUser = mockFactory(UserSchema, {
  overrides: { active: true },
})

const user = createActiveUser({ overrides: { name: "Dave" } })
// user.active === true (from base), user.name === "Dave" (from call)
```

---

### `mockList(schema, options?)`

Generates an array of individual fixtures — not to be confused with `mock(z.array(schema))`.

```typescript
import { mockList } from "zod-forge"

const users = mockList(UserSchema)               // 1–5 items
const users = mockList(UserSchema, { count: 10 })
const users = mockList(UserSchema, {
  count: 3,
  overrides: { active: true },
})
```

The distinction matters: `mockList(UserSchema)` calls `mock(UserSchema)` N times, each independently. `mock(z.array(UserSchema))` treats the array schema as the thing to generate, respecting `.min()`, `.max()`, and `.length()` constraints on the array itself.

---

### `configure(options)`

Sets global defaults that apply to every `mock()` call. Useful for test suite-level configuration.

```typescript
import { configure } from "zod-forge"

configure({
  maxDepth: 3,
  useDefaults: false,
  matchers: [
    { pattern: /sku/i, generate: () => `SKU-${Math.floor(Math.random() * 9999)}` },
  ],
})
```

---

### `resetConfig()`

Resets everything back to defaults. Call this in `afterEach` to keep tests isolated:

```typescript
import { resetConfig } from "zod-forge"

afterEach(() => resetConfig())
```

---

## Semantic Inference

When no explicit format constraint is present, zod-forge looks at the field name (the leaf key of the path) and tries to produce something meaningful. An `email` field gets a valid email address. An `age` field gets an integer between 18 and 80. A `createdAt` field gets an ISO date string.

This is entirely opt-in by nature — it just works based on naming conventions you probably already follow.

The priority order is: explicit format constraint (like `.email()` or `.uuid()`) → custom matcher → semantic match → generic type-based generation.

Semantic generators are constraint-aware. If a field named `age` also has `.max(5)`, the semantic generator can't satisfy both the name-based expectation (18–80) and the schema constraint (max 5), so it falls back to generic constraint-safe generation. Realism is never worth a validity violation.

### String field patterns

`email` produces a valid email. `firstName` and `first_name` produce a first name. `lastName` and `last_name` produce a last name. A standalone `name` field produces a full name. `phone` and `phoneNumber` produce a phone number. `url` and `website` produce a valid URL. `avatar` and `avatarUrl` produce an image URL. `address` produces a street address. `city`, `country`, `zipCode`, `zip`, and `postalCode` produce what you'd expect. `company` produces a company name. `description` and `bio` produce a lorem ipsum sentence. `id` and `uuid` produce a UUID v4. `username` produces a username. `password` produces a 12-character random string. `token` produces 32 hex characters. `title` produces a short title. `date`, `createdAt`, and `updatedAt` produce an ISO date string.

### Numeric field patterns

`age` produces an integer between 18 and 80. `price`, `amount`, and `cost` produce a float between 0.01 and 9999.99. `count` and `quantity` produce an integer between 1 and 100. `rating` and `score` produce a float between 0.0 and 5.0. `percentage` and `percent` produce a float between 0.0 and 100.0.

---

## Custom Matchers

If the built-in semantic patterns don't cover your domain, you can register custom matchers globally. Each matcher has a `pattern` (a regex tested against the leaf field name) and a `generate` function that returns the value.

```typescript
configure({
  matchers: [
    { pattern: /sku/i,    generate: () => `SKU-${String(Math.random()).slice(2, 6)}` },
    { pattern: /status/i, generate: () => "active" },
    { pattern: /region/i, generate: () => ["us-east", "eu-west", "ap-south"][Math.floor(Math.random() * 3)] },
  ],
})

const product = mock(ProductSchema)
// product.sku    → "SKU-4821"
// product.status → "active"
```

Matchers are tested in order and the first match wins.

---

## Constraints

zod-forge handles all standard Zod constraints. Here's the full picture:

**Strings:** `.min(n)` produces at least n characters. `.max(n)` caps at n characters. `.length(n)` produces exactly n characters. `.email()` produces a valid email. `.url()` produces a valid URL. `.uuid()` produces a UUID v4. `.startsWith(s)` and `.endsWith(s)` are respected. `.cuid()`, `.cuid2()`, `.ulid()`, `.datetime()`, `.ip()`, `.emoji()`, and `.base64()` all produce format-correct values.

**Numbers:** `.min(n)` / `.gte(n)` and `.max(n)` / `.lte(n)` set the range. `.gt(n)` and `.lt(n)` set exclusive bounds. `.int()` produces integers. `.positive()` ensures the result is greater than zero. `.negative()` ensures it's less than zero. `.nonnegative()` and `.nonpositive()` cover the boundary-inclusive variants. `.multipleOf(n)` produces a multiple of n.

**BigInts:** `.min(n)`, `.max(n)`, and `.multipleOf(n)` all work with BigInt values.

**Dates:** `.min(d)` and `.max(d)` produce a date within the given range.

**Arrays:** `.min(n)`, `.max(n)`, and `.length(n)` control item count.

Unsatisfiable combinations — `.min(10).max(5)`, `.positive().negative()`, `.email().max(5)` — throw `ZodForgeError [GENERATION_FAILED]` before any generation attempt is made.

---

## Regex Support

`z.string().regex(r)` is supported for simple patterns. The following constructs work:

Character classes like `[a-z]` or `[A-Z0-9]`. Quantifiers `+`, `*`, `?`, `{n}`, and `{n,m}`. Anchors `^` and `$`. Fixed alternation in groups like `(foo|bar|baz)`.

Complex patterns throw `ZodForgeError [REGEX_UNSUPPORTED]`. This includes `\d`, `\w`, `\s` and their inverses, lookahead and lookbehind, lazy quantifiers, negated character classes, the dot `.`, and top-level alternation without enclosing parens.

If you need to generate values for a complex regex, use a custom matcher instead:

```typescript
configure({
  matchers: [
    {
      pattern: /postalCode/i,
      generate: () => `${String(Math.floor(Math.random() * 90000) + 10000)}`,
    },
  ],
})
```

---

## Overrides and Deep Merge

Overrides use a deep partial merge. Plain objects are merged recursively. Arrays replace — they are never concatenated. Scalars replace. Setting a key to `undefined` in overrides is a no-op (the generated value is kept).

```typescript
const result = mock(UserSchema, {
  overrides: {
    address: { city: "New York" }, // only city is overridden, other address fields are generated
    tags: ["admin"],               // entire tags array is replaced
    nickname: undefined,           // ignored — generated value is used
  },
})
```

Overrides are not supported on schemas containing `.transform()`. The output of a transform is in a different domain than the input, so merging into it safely isn't possible in v1. Attempting it throws `ZodForgeError [UNSUPPORTED_SCHEMA]` with a clear explanation.

---

## Zod Type Coverage

zod-forge handles the full Zod type system with a few noted exceptions.

`z.string()`, `z.number()`, `z.boolean()`, `z.bigint()`, `z.date()` — full constraint support.

`z.literal(val)` returns the literal value. `z.enum([...])` and `z.nativeEnum(E)` pick a random value.

`z.optional(T)` generates a value 70% of the time and `undefined` 30% of the time — the decision is made before generating the inner value. `z.nullable(T)` returns `null` 20% of the time.

`z.default(val)` generates the inner schema dynamically unless `useDefaults: true` is set. `z.catch(val)` generates the inner schema and ignores the fallback.

`z.array(T)` generates 1–5 items unless constrained. `z.tuple([...])` generates each element in order. `z.object({})` recurses into each field with the field name appended to the path.

`z.union([...])` tries each branch in random order, at most once each, and returns the first success. All branches failing throws `GENERATION_FAILED`. `z.discriminatedUnion(key, [...])` picks a random branch and sets the discriminator key correctly.

`z.intersection(A, B)` generates A and B independently and deep-merges them with B overriding A on conflicts. Arrays replace. If the merged result fails schema validation, `GENERATION_FAILED` is thrown.

`z.record(K, V)` produces 2–4 key-value pairs. `z.map(K, V)` produces a Map with 2–4 entries. `z.set(T)` produces a Set with 2–4 values.

`z.lazy(T)` recurses up to `maxDepth`. Optional objects return `undefined`, arrays return `[]`, and required objects throw `MAX_DEPTH_EXCEEDED`.

`z.readonly(T)` ignores the readonly wrapper and generates from the inner type. `z.string().brand<B>()` and `z.number().brand<B>()` ignore the brand and generate the underlying type. `z.coerce.string()`, `z.coerce.number()`, `z.coerce.boolean()`, and `z.coerce.date()` generate the target type directly, bypassing coercion.

`z.unknown()` and `z.any()` produce a random primitive (string, number, or boolean). `z.nan()` returns `NaN` — see the warning below. `z.void()` returns `undefined`.

`z.string().transform(...)` is supported; the transform runs once via `safeParse`. `z.preprocess()`, `z.pipe()`, `z.promise()`, `z.symbol()`, `z.never()`, `z.refine()`, `z.superRefine()`, and `z.custom()` all throw `UNSUPPORTED_SCHEMA`.

---

## ⚠️ `z.nan()` Warning

`z.nan()` returns `NaN`. A few things to keep in mind: `NaN !== NaN` in JavaScript, which breaks deep equality checks in test assertions. `JSON.stringify({ x: NaN })` produces `'{"x":null}'`, so snapshot tests may behave unexpectedly. If you're using jest's `toEqual` or vitest's `expect().toEqual()`, NaN-containing results will need special handling.

---

## Error Handling

All errors are instances of `ZodForgeError` and carry a `code` property. Error messages always include the schema path.

```typescript
import { ZodForgeError } from "zod-forge"

try {
  mock(schema, { overrides: { address: { age: -5 } } })
} catch (e) {
  if (e instanceof ZodForgeError) {
    console.log(e.code)    // "INVALID_OVERRIDE"
    console.log(e.message) // 'Override at "address.age" failed: ...'
  }
}
```

`UNSUPPORTED_SCHEMA` is thrown for `z.never()`, `z.refine()`, `z.preprocess()`, `z.pipe()`, `z.promise()`, `z.symbol()`, `z.custom()`, and overrides on transform schemas.

`UNSUPPORTED_MODE` is thrown when `mode` is `"edge"` or `"random"` — both are coming in v2.

`INVALID_OVERRIDE` is thrown when an override produces a value that fails schema validation. The message includes the failing path and a description of the violation.

`REGEX_UNSUPPORTED` is thrown for regex patterns outside the supported subset.

`MAX_DEPTH_EXCEEDED` is thrown when a required recursive object hits `maxDepth`. The message includes the path and the configured depth.

`GENERATION_FAILED` is thrown when all union branches fail, an intersection conflict can't be resolved, or constraints are mathematically unsatisfiable.

---

## Reproducibility

Pass a `seed` to get deterministic output:

```typescript
const a = mock(UserSchema, { seed: 42 })
const b = mock(UserSchema, { seed: 42 })
// a deep-equals b
```

Without a seed, each call uses a fresh random state. Determinism is guaranteed within a major version. Breaking changes to generators (improving realism, fixing edge cases) may change output between major releases — if you're relying on specific seeded values across upgrades, regenerate your snapshots after upgrading.

---

## Why not just use faker?

faker is great for generating realistic-looking data but it knows nothing about your schema. A `faker.number.int()` call doesn't know about `.positive()`. `faker.internet.email()` doesn't know about `.max(10)`. Keeping faker-based fixtures valid under schema changes is a constant maintenance burden — and failures are silent until a test runs.

zod-forge derives the data from the schema itself, so constraints are always satisfied by construction. When the schema changes, the fixtures automatically adapt.

---

## Roadmap

Two modes are planned for v2. Edge case mode (`mode: "edge"`) will generate boundary values: empty strings, maximum lengths, `0`, `-1`, `MAX_SAFE_INTEGER`, `null`-heavy object trees, and pathological unicode. Random mode (`mode: "random"`) will disable semantic inference entirely and generate maximally varied output within type constraints. Both are currently behind `UNSUPPORTED_MODE` with a clear message pointing to v2.

---

## License

MIT
