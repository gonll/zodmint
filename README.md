# zodmint

[![CI](https://github.com/gonll/zodmint/actions/workflows/ci.yml/badge.svg)](https://github.com/gonll/zodmint/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/zodmint)](https://www.npmjs.com/package/zodmint)
[![npm downloads](https://img.shields.io/npm/dm/zodmint)](https://www.npmjs.com/package/zodmint)
[![bundle size](https://img.shields.io/bundlephobia/minzip/zodmint)](https://bundlephobia.com/package/zodmint)
[![license](https://img.shields.io/npm/l/zodmint)](https://github.com/gonll/zodmint/blob/main/LICENSE)

Your faker mocks are lying to your tests.
With Zodmint, your schema is your mock's source of truth.

You hand-write factories, sprinkle in faker calls, and somewhere down the line a test passes locally but blows up in CI because `faker.number.int()` produced a value that fails your `.positive()` constraint. zodmint takes the opposite approach: the schema is the source of truth, and every value it generates is guaranteed to pass `schema.safeParse(output).success === true`.

No more babysitting fixtures. No more silent invalidity.

---

## How it works

You pass a Zod schema in, you get a valid value out. That's the whole contract.

Do you need a user?

```typescript
const user = mock(UserSchema);
```

Internally, zodmint walks the schema definition, resolves constraints, applies semantic inference from field names, and runs a single `safeParse` to get the fully-transformed output type. The result is always typed as `z.infer<typeof schema>` — no `any`, no casting.

```typescript
import { mock } from "zodmint";
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().int().min(18).max(99),
  active: z.boolean(),
});

const user = mock(UserSchema);
// { id: "3f2e1d4c-...", email: "alice23@example.com", age: 34, active: true }
```

---

## Installation

```bash
npm install zodmint
```

zod is a peer dependency, so make sure it's already in your project:

```bash
npm install zod
```

Requires zod `>=3.23.0`. Zod v3 and v4 are both supported.

---

## Core API

### `mock(schema, options?)`

The primary function. Generates a single value from any Zod schema.

```typescript
import { mock } from "zodmint";

const user = mock(UserSchema);

const user = mock(UserSchema, {
  overrides: { email: "custom@test.com" },
  seed: 42,
  maxDepth: 3,
  useDefaults: true,
  mode: "realistic",
});
```

Options:

`overrides` lets you pin specific fields while letting zodmint fill in the rest. Overrides are deep-merged, so you can target nested fields without recreating the entire object. If an override produces a value that fails schema validation, a `ZodForgeError [INVALID_OVERRIDE]` is thrown with the path and failing value clearly named.

`seed` makes generation deterministic. Same seed on the same schema produces the same output every time — useful for snapshot tests and reproducible bug reports. Determinism is guaranteed within a major version, but not across major versions (generators can be improved between releases).

`maxDepth` controls how deep recursive schemas go before terminating. Defaults to `2`. Optional objects terminate with `undefined`, arrays with `[]`, and required objects throw `MAX_DEPTH_EXCEEDED`.

`useDefaults`, when `true`, returns `.default()` values instead of generating new ones dynamically. Defaults to `false`.

`mode` accepts `"realistic"` (default), `"edge"`, or `"random"`. See [Edge Mode](#edge-mode) and [Random Mode](#random-mode) for details.

`refinementRetries` sets how many times the generator will retry a failing `z.refine()` or `z.superRefine()` before throwing `GENERATION_FAILED`. Defaults to `10`. Override globally via `configure({ refinementRetries: N })` or per-call.

One thing worth understanding: `mock()` captures an immutable snapshot of the global config the moment it's called. Calling `configure()` partway through a generation run (say, inside a custom matcher) has no effect on the current call. This makes concurrent usage safe and test isolation predictable.

---

### `mockFactory(schema, options?)`

Returns a reusable, typed factory. Useful when you need multiple instances of the same shape with per-call variation.

```typescript
import { mockFactory } from "zodmint";

const createUser = mockFactory(UserSchema);

const user1 = createUser();
const user2 = createUser({ overrides: { name: "Carol" } });
```

Base options apply to every call. Per-call options merge on top, with per-call values winning:

```typescript
const createActiveUser = mockFactory(UserSchema, {
  overrides: { active: true },
});

const user = createActiveUser({ overrides: { name: "Dave" } });
// user.active === true (from base), user.name === "Dave" (from call)
```

#### States

States are named override presets that you can activate by name at call time. They sit between base overrides and per-call overrides in the merge priority:

```typescript
const userFactory = mockFactory(UserSchema, {
  states: {
    admin: { role: "admin" },
    guest: { role: "guest" },
    inactive: { active: false },
  },
});

userFactory({ states: "admin" });
// role === "admin"

userFactory({ states: ["admin", "inactive"] });
// role === "admin", active === false (states merged left-to-right)

userFactory({ states: "admin", overrides: { role: "guest" } });
// overrides win: role === "guest"
```

Merge priority (lowest → highest): `base overrides` → `state overrides` → `per-call overrides`.

Requesting an unknown state throws `ZodForgeError [INVALID_OVERRIDE]` with the list of available states in the message.

#### `afterBuild`

A post-generation hook that runs after all overrides have been applied. Use it for derived fields, cross-field logic, or anything you can't express as a static override:

```typescript
const postFactory = mockFactory(PostSchema, {
  afterBuild: (post) => ({
    ...post,
    slug: post.title.toLowerCase().replace(/\s+/g, "-"),
  }),
});

const post = postFactory();
// post.slug === post.title.toLowerCase().replace(/\s+/g, "-")
```

The hook receives the fully-generated, override-merged value and must return the same type. When using `factory.async()` (see below), `afterBuild` may also return a `Promise`.

#### `factory.async(callOptions?)`

The async counterpart to calling the factory directly. Use this when:

- the schema contains async `z.superRefine()` refinements, or
- `afterBuild` needs to perform async work (database writes, ID hydration, API calls).

```typescript
// Schema with async refinement
const UniqueEmail = z.object({
  email: z.string().email().superRefine(async (v, ctx) => {
    if (await db.users.exists({ email: v }))
      ctx.addIssue({ code: "custom", message: "taken" });
  }),
});

const emailFactory = mockFactory(UniqueEmail);
const user = await emailFactory.async(); // uses mockAsync() internally

// Async afterBuild — enriches the generated value after creation
const userFactory = mockFactory(UserSchema, {
  afterBuild: async (user) => {
    const saved = await db.users.create(user);
    return { ...user, id: saved.id };
  },
});

const persisted = await userFactory.async();
// persisted.id comes from the database
```

The sync `factory()` call is unchanged — if `afterBuild` returns a `Promise` but you call the factory synchronously, a `ZodForgeError [GENERATION_FAILED]` is thrown with a clear message pointing you to `.async()`.

#### `factory.extend(options)`

Derives a new factory from an existing one. Override merging, state inheritance, and `afterBuild` chaining are all handled automatically:

```typescript
const baseFactory = mockFactory(UserSchema);
const adminFactory = baseFactory.extend({ overrides: { role: "admin" } });
const bannedAdminFactory = adminFactory.extend({
  overrides: { active: false },
});

// role === "admin", active === false
bannedAdminFactory();
```

Extend semantics:

- `overrides` — deep-merged (extend wins on conflicts)
- `states` — merged by key (extend adds new states or overrides existing ones by name)
- `afterBuild` — chained (base hook runs first, then extend hook)
- all other options (`seed`, `mode`, `maxDepth`, etc.) — extend wins

The original factory is never mutated.

---

### `mockList(schema, options?)`

Generates an array of individual fixtures — not to be confused with `mock(z.array(schema))`.

```typescript
import { mockList } from "zodmint";

const users = mockList(UserSchema); // 1–5 items
const users = mockList(UserSchema, { count: 10 });
const users = mockList(UserSchema, {
  count: 3,
  overrides: { active: true },
});
```

The distinction matters: `mockList(UserSchema)` calls `mock(UserSchema)` N times, each independently. `mock(z.array(UserSchema))` treats the array schema as the thing to generate, respecting `.min()`, `.max()`, and `.length()` constraints on the array itself.

---

### `configure(options)`

Sets global defaults that apply to every `mock()` call. Useful for test suite-level configuration.

```typescript
import { configure } from "zodmint";

configure({
  maxDepth: 3,
  useDefaults: false,
  matchers: [
    {
      pattern: /sku/i,
      generate: () => `SKU-${Math.floor(Math.random() * 9999)}`,
    },
  ],
});
```

---

### `resetConfig()`

Resets everything back to defaults. Call this in `afterEach` to keep tests isolated:

```typescript
import { resetConfig } from "zodmint";

afterEach(() => resetConfig());
```

---

### `withConfig(options, fn)`

Preferred alternative to `configure()` + `resetConfig()` for test-scoped configuration. Applies options for the duration of the callback and restores the previous config afterwards — even if the callback throws.

```typescript
import { withConfig } from "zodmint";

const result = withConfig({ maxDepth: 5, matchers: [...] }, () => {
  return mock(schema);
});
// config is fully restored here
```

Use this instead of `configure()` when you only need the config change for a single test or block. It eliminates the `afterEach(() => resetConfig())` footgun.

---

### `zodForgeMatchers` (testing utilities)

Import from `"zodmint/testing"` to get a `toMatchSchema` custom matcher for vitest/jest:

```typescript
// vitest.setup.ts (or jest.setup.ts)
import { zodForgeMatchers } from "zodmint/testing";
import { expect } from "vitest";
expect.extend(zodForgeMatchers);

// in your tests:
expect(mock(UserSchema)).toMatchSchema(UserSchema);
expect({ name: "Alice", age: 30 }).toMatchSchema(UserSchema);
```

On failure, the error message lists each schema violation with its path.

---

## Semantic Inference

When no explicit format constraint is present, zodmint looks at the field name (the leaf key of the path) and tries to produce something meaningful. An `email` field gets a valid email address. An `age` field gets an integer between 18 and 80. A `createdAt` field gets an ISO date string.

This is entirely opt-in by nature — it just works based on naming conventions you probably already follow.

The priority order is: explicit format constraint (like `.email()` or `.uuid()`) → custom matcher → semantic match → generic type-based generation.

Semantic generators are constraint-aware. If a field named `age` also has `.max(5)`, the semantic generator can't satisfy both the name-based expectation (18–80) and the schema constraint (max 5), so it falls back to generic constraint-safe generation. Realism is never worth a validity violation.

### String field patterns

Names: `firstName` / `first_name`, `lastName` / `last_name` / `surname`, `fullName` / `full_name` / `displayName`, `middleName`, `nickname` / `handle`. Contact: `email`, `phone` / `mobile` / `phoneNumber`. Web: `url` / `website`, `avatar` / `avatarUrl`, `imageUrl` / `photo` / `thumbnail`, `logoUrl`. Address: `address` / `street`, `city`, `state` / `province` / `region`, `country`, `countryCode`, `zipCode` / `zip` / `postalCode`. Identity: `id` / `uuid`, `username` / `login`, `password`, `token` / `accessToken`, `apiKey` / `secret`, `code` / `otp`. Company: `company` / `organization`, `department`, `jobTitle` / `role` / `position`. Content: `title`, `subject`, `description` / `bio` / `summary`, `content` / `body` / `message` / `note`, `tag` / `label` / `category`, `slug`. Locale: `locale` / `language`, `timezone`, `currency` / `currencyCode`. Appearance: `color` / `hexColor`. Status: `status`, `type` / `kind`, `gender`. Files: `filename` / `filepath`, `mimeType` / `contentType`, `extension`. Dates (as strings): `date` / `createdAt` / `updatedAt` / `publishedAt`, `birthDate` / `dob`. Other: `version`, `sku` / `barcode`, `ipAddress`, `host` / `hostname`.

### Numeric field patterns

`age` (18–80), `price` / `amount` / `cost` / `salary` (float), `count` / `quantity` / `size` (int), `rating` / `score` (0–5 float), `percentage` / `percent` (0–100), `latitude` / `lat` (-90–90), `longitude` / `lng` (-180–180), `year` (2000–2030), `month` (1–12), `day` (1–28), `hour` (0–23), `minute` / `second` (0–59), `width` / `height` (pixels), `weight`, `limit` / `pageSize` / `perPage`, `page` / `pageNumber`, `offset` / `skip`, `totalCount`, `priority` / `importance` (1–10), `port` (1024–65535), `duration` / `timeout`, `version` / `major` / `minor` / `patch`. Semantic values respect explicit schema constraints — a `latitude` field with `.min(0)` clamps to non-negative.

---

## Custom Matchers

If the built-in semantic patterns don't cover your domain, you can register custom matchers globally. Each matcher has a `pattern` (a regex tested against the leaf field name) and a `generate` function that returns the value.

```typescript
configure({
  matchers: [
    {
      pattern: /sku/i,
      generate: () => `SKU-${String(Math.random()).slice(2, 6)}`,
    },
    { pattern: /status/i, generate: () => "active" },
    {
      pattern: /region/i,
      generate: () =>
        ["us-east", "eu-west", "ap-south"][Math.floor(Math.random() * 3)],
    },
  ],
});

const product = mock(ProductSchema);
// product.sku    → "SKU-4821"
// product.status → "active"
```

Matchers are tested in order and the first match wins.

### Path-aware matchers

The `generate` function receives an optional `MatcherContext` with the full schema path and the matched leaf key. Use it to produce different values depending on where in the schema the field appears:

```typescript
import { configure, type MatcherContext } from "zodmint";

configure({
  matchers: [
    {
      pattern: /zip/i,
      generate: ({ path }: MatcherContext) =>
        path.includes("billing") ? "90210" : "10001",
    },
  ],
});

const order = mock(OrderSchema);
// order.billing.zip  → "90210"
// order.shipping.zip → "10001"
```

The `context` parameter is optional — existing `generate: () => value` matchers work unchanged.

---

## Plugins

Plugins let you package and share domain-specific matchers as reusable bundles. Use `definePlugin()` to create one and install it via `configure({ plugins })`.

```typescript
import { definePlugin, configure } from "zodmint";

export const commercePlugin = definePlugin({
  matchers: [
    { pattern: /sku/i,      generate: () => `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}` },
    { pattern: /currency/i, generate: () => "USD" },
    { pattern: /taxRate/i,  generate: () => 0.08 },
    { pattern: /barcode/i,  generate: () => `0${Math.floor(Math.random() * 1e12)}` },
  ],
});
```

In your test setup file:

```typescript
configure({ plugins: [commercePlugin] });
```

Priority order (highest → lowest): explicit `matchers` → plugin matchers → built-in semantic inference. Multiple plugins are applied in array order; earlier plugins win on conflicts.

---

## Constraints

zodmint handles all standard Zod constraints. Here's the full picture:

**Strings:** `.min(n)` produces at least n characters. `.max(n)` caps at n characters. `.length(n)` produces exactly n characters. `.email()` produces a valid email. `.url()` produces a valid URL. `.uuid()` produces a UUID v4. `.startsWith(s)` and `.endsWith(s)` are respected. `.cuid()`, `.cuid2()`, `.ulid()`, `.nanoid()`, `.jwt()`, `.datetime()`, `.date()` (YYYY-MM-DD), `.time()` (HH:MM:SS), `.duration()` (ISO 8601), `.ip()` / `.ipv4()` / `.ipv6()`, `.cidrv4()` / `.cidrv6()`, `.emoji()`, `.base64()`, and `.base64url()` all produce format-correct values.

**Numbers:** `.min(n)` / `.gte(n)` and `.max(n)` / `.lte(n)` set the range. `.gt(n)` and `.lt(n)` set exclusive bounds. `.int()` produces integers. `.positive()` ensures the result is greater than zero. `.negative()` ensures it's less than zero. `.nonnegative()` and `.nonpositive()` cover the boundary-inclusive variants. `.multipleOf(n)` produces a multiple of n.

**BigInts:** `.min(n)`, `.max(n)`, and `.multipleOf(n)` all work with BigInt values.

**Dates:** `.min(d)` and `.max(d)` produce a date within the given range.

**Arrays:** `.min(n)`, `.max(n)`, and `.length(n)` control item count.

Unsatisfiable combinations — `.min(10).max(5)`, `.positive().negative()`, `.email().max(5)` — throw `ZodForgeError [GENERATION_FAILED]` before any generation attempt is made.

---

## Regex Support

`z.string().regex(r)` supports a broad subset of patterns — enough to cover the majority of real-world use cases:

**Supported:** literals, character classes `[a-z]` / `[A-Z0-9_]`, negated classes `[^aeiou]`, shorthand classes `\d` / `\w` / `\s` and their inverses `\D` / `\W` / `\S`, word boundaries `\b` / `\B` (zero-width, no output), the dot `.` (any printable char), alternation `(foo|bar|baz)` and top-level `cat|dog|fish`, non-capturing groups `(?:...)`, quantifiers `?` / `*` / `+` / `{n}` / `{n,m}`, lazy quantifiers (`+?`, `*?`), anchors `^` / `$`.

```typescript
mock(z.string().regex(/^\d{5}$/)); // "94103"
mock(z.string().regex(/^\d{3}-\d{4}$/)); // "415-8271"
mock(z.string().regex(/^\d+\.\d{2}$/)); // "42.99"
mock(z.string().regex(/^[A-Z]{2}\d{4}$/)); // "BC1947"
mock(z.string().regex(/^#[0-9a-fA-F]{6}$/)); // "#3af1c8"
```

**Still throws `REGEX_UNSUPPORTED`:** lookahead / lookbehind (`(?=...)`, `(?!...)`), backreferences (`\1`), named capture groups (`(?<name>...)`), unicode properties (`\p{...}`), possessive quantifiers (`++`).

For genuinely unsupported patterns, register a custom matcher instead:

```typescript
configure({
  matchers: [
    {
      pattern: /postalCode/i,
      generate: () => String(Math.floor(Math.random() * 90000) + 10000),
    },
  ],
});
```

---

## Refinements

`z.refine()` and `z.superRefine()` are supported via a generate-and-test strategy. zodmint generates a candidate from the base schema, evaluates the refinement, and retries with a different seed if it fails — up to `refinementRetries` attempts (default: 10).

```typescript
const schema = z.object({
  password: z
    .string()
    .min(8)
    .refine((v) => /[A-Z]/.test(v), "needs uppercase"),
  age: z
    .number()
    .int()
    .refine((v) => v >= 18, "must be adult"),
});

const result = mock(schema);
// password satisfies both min(8) and the uppercase refinement
// age is an integer >= 18
```

If the refinement is unsatisfiable (always returns false) or extremely selective, increase the retry limit:

```typescript
const schema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .refine((v) => v % 10 === 0, "must be multiple of 10");

const result = mock(schema, { refinementRetries: 50 });
```

If all retries are exhausted, `ZodForgeError [GENERATION_FAILED]` is thrown with a message suggesting a path-based generator as an escape hatch.

### Refinement hints with `withGenerate()`

For refinements that are hard to satisfy by brute-force (e.g. exact string matches, complex invariants), attach a generation hint directly to the schema using `withGenerate()`. The hint factory is called first; if the value passes the refinement it is used directly, bypassing the retry loop entirely.

```typescript
import { mock, withGenerate } from "zodmint";

const schema = withGenerate(
  z.string().refine((v) => v === "exact-match", "must equal exact-match"),
  () => "exact-match", // hint factory: always returns a valid value
);

const result = mock(schema);
// result → "exact-match" — no retries
```

`withGenerate()` stores the hint in a `WeakMap` and returns the same schema object, so it does not mutate or wrap the schema. If the hint factory returns an invalid value, zodmint falls back to the normal retry loop automatically.

---

## Async refinements with `mockAsync()`

`mockAsync()` is the async counterpart to `mock()`. Use it when your schema contains `z.superRefine()` predicates that return Promises (async refinements):

```typescript
import { mockAsync } from "zodmint";

const EvenNumber = z.number().int().min(0).max(100).superRefine(async (val, ctx) => {
  await Promise.resolve(); // async check, e.g. a cache lookup
  if (val % 2 !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be even" });
  }
});

const n = await mockAsync(EvenNumber, { refinementRetries: 50 });
// n is a valid even integer
```

`mockAsync()` uses `schema.safeParseAsync()` internally and retries up to `refinementRetries` times (default: 10). It accepts the same options as `mock()` including `seed`, `overrides`, `mode`, and `generators`.

For async refinements that check external state (DB uniqueness, API calls) that cannot be satisfied by random generation, combine `mockAsync()` with `withGenerate()`:

```typescript
import { mockAsync, withGenerate } from "zodmint";

const UniqueEmail = withGenerate(
  z.string().superRefine(async (val, ctx) => {
    const taken = await db.emailExists(val);
    if (taken) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "email taken" });
  }),
  // Hint: always return a unique email — no retries needed
  () => `user-${crypto.randomUUID()}@example.com`,
);

const email = await mockAsync(UniqueEmail);
```

---

## Schema Descriptions as Semantic Hints

`z.describe()` lets you attach a semantic hint directly to a schema. zodmint reads it and uses it as a generation hint, taking priority over the field name:

```typescript
const schema = z.object({
  x: z.string().describe("email"), // "x" has no semantic meaning — description wins
  n: z.number().describe("age"),
});

const result = mock(schema);
// result.x → "alice23@example.com"
// result.n → 34
```

Any description that matches a built-in semantic pattern works — `"email"`, `"uuid"`, `"url"`, `"firstName"`, `"price"`, `"age"`, and so on. Descriptions that don't match any pattern fall back to generic type-based generation. Descriptions never override explicit format constraints like `.email()` or `.uuid()`.

Priority order: path-based generator → explicit format constraint → custom matcher → schema description → field name → generic generation.

---

## Edge Mode

Pass `mode: "edge"` to generate boundary values instead of realistic ones. Useful for testing schema validation logic, catching off-by-one bugs, and exercising constraint boundaries.

```typescript
const schema = z.object({
  name: z.string().min(2).max(50),
  age: z.number().int().min(0).max(150),
  active: z.boolean(),
  tags: z.array(z.string()),
  nickname: z.string().optional(),
});

const edge = mock(schema, { mode: "edge" });
// { name: "aa", age: 0, active: false, tags: [], nickname: undefined }
```

The boundary rules:

Strings produce the minimum-length value (all `"a"`s), or the canonical shortest form for format constraints (`"a@b.co"` for email, `"http://a.co"` for url, `"00000000-0000-4000-8000-000000000000"` for uuid). Numbers produce the minimum value when constrained, `0` otherwise. Booleans produce `false`. Optionals produce `undefined`. Nullables produce `null`. Arrays produce `[]` when unconstrained, or exactly `min` items when `.min()` is set. Dates produce epoch (`new Date(0)`). BigInts produce `0n`.

Edge mode composes with all other options — seeds, overrides, and path-based generators all still apply.

---

## Random Mode

Pass `mode: "random"` to disable all semantic inference. Field names and `z.describe()` hints are ignored — only hard schema constraints (`.email()`, `.uuid()`, `.min()`, etc.) influence the output. Useful for fuzz-style testing where predictable field patterns would undermine the test.

```typescript
const schema = z.object({
  email: z.string(), // no .email() constraint — gets a random string, not an email
  id: z.string().uuid(), // .uuid() is structural — still generates a UUID
  count: z.number().int().min(0),
});

const result = mock(schema, { mode: "random" });
// result.email → some random string (not email-shaped)
// result.id    → valid UUID (format constraint respected)
// result.count → valid non-negative integer
```

---

## Path-Based Generators

The `generators` option pins specific fields to custom generation functions. Keys are dot-separated paths matching the schema's field structure. Use `*` for array element positions.

```typescript
const schema = z.object({
  user: z.object({
    id: z.string().uuid(),
    address: z.object({ zip: z.string() }),
  }),
  items: z.array(z.object({ sku: z.string() })),
});

const result = mock(schema, {
  generators: {
    "user.id": () => "test-user-id",
    "user.address.zip": () => "90210",
    "items.*.sku": () =>
      `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  },
});
// result.user.id      → "test-user-id"
// result.user.address.zip → "90210"
// result.items[0].sku → "SKU-4A3F"  (and so on for each item)
```

Path-based generators short-circuit all other generation logic — they take priority over semantic inference, `z.describe()`, and format constraints. The return value is used as-is; no `safeParse` is re-run on the individual field.

`mockList` passes the same `generators` option to every call:

```typescript
const users = mockList(UserSchema, {
  count: 5,
  generators: { id: () => crypto.randomUUID() },
});
```

---

## Session

A session threads shared mutable state through multiple `mock()` calls and into matchers — useful for generating relational fixtures where IDs need to be unique and consistent across objects.

```typescript
import { createSession, seq } from "zodmint";

const session = createSession();
```

Pass the session to `mock()` and it flows into every matcher's `MatcherContext`:

```typescript
import { configure } from "zodmint";
import type { MatcherContext } from "zodmint";

configure({
  matchers: [
    {
      pattern: /userId/i,
      generate: ({ session }: MatcherContext) => seq("user", session),
    },
  ],
});

const session = createSession();
const user1 = mock(UserSchema, { session }); // user1.userId === 1
const user2 = mock(UserSchema, { session }); // user2.userId === 2
```

### `createSession()`

Returns a new empty session with two maps:

- `session.store` — a `Map<string, unknown>` for arbitrary shared data. Generators and matchers can read and write to coordinate state across calls.
- `session.sequences` — internal map used by `seq()`. You rarely touch this directly.

### `seq(key, session?)`

Returns the next integer for the given key within the session. Starts at 1. Different keys are independent. If no session is passed, always returns 1.

```typescript
const session = createSession();
seq("orderId", session) // 1
seq("orderId", session) // 2
seq("userId", session)  // 1 (different key, independent counter)
```

Using `seq()` inside a matcher ensures each generated fixture gets a unique, predictable identifier — without UUID collisions or database uniqueness errors.

### `session.store` for cross-call coordination

```typescript
configure({
  matchers: [
    {
      pattern: /referralCode/i,
      generate: ({ session }: MatcherContext) => {
        if (!session) return "REF-0000";
        const code = `REF-${seq("ref", session).toString().padStart(4, "0")}`;
        session.store.set("lastReferral", code);
        return code;
      },
    },
  ],
});
```

---

## Overrides and Deep Merge

Overrides use a deep partial merge. Plain objects are merged recursively. Arrays replace — they are never concatenated. Scalars replace. Setting a key to `undefined` in overrides is a no-op (the generated value is kept).

```typescript
const result = mock(UserSchema, {
  overrides: {
    address: { city: "New York" }, // only city is overridden, other address fields are generated
    tags: ["admin"], // entire tags array is replaced
    nickname: undefined, // ignored — generated value is used
  },
});
```

Overrides are not supported on schemas containing `.transform()`. The output of a transform is in a different domain than the input, so merging into it safely isn't possible in v1. Attempting it throws `ZodForgeError [UNSUPPORTED_SCHEMA]` with a clear explanation.

---

## Violation Testing

Pass `violate` to intentionally generate invalid values at specific field paths. All other fields are generated normally. The result will fail `schema.safeParse()` at the violated paths — useful for testing validation error handling.

```typescript
const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(18),
  name: z.string(),
});

const bad = mock(schema, { violate: ["email", "age"] });
// bad.email → "not-an-email" (fails .email() format)
// bad.age   → 1.5 (fails .int()) or 17 (fails .min(18))
// bad.name  → valid string (untouched)

schema.safeParse(bad).success; // false
```

Violation strategies are constraint-aware. An `.email()` field gets a string without `@`. A `.positive()` number gets `-1`. A `.min(5)` string gets a string shorter than 5 characters. A `boolean` gets `"not-a-boolean"`. When no constraints are present, the wrong type is returned (e.g., a number for a plain string field).

`violate` and `overrides` may not target the same path — doing so throws `ZodForgeError [INVALID_OVERRIDE]`.

---

## Zod Type Coverage

zodmint handles the full Zod type system with a few noted exceptions.

`z.string()`, `z.number()`, `z.boolean()`, `z.bigint()`, `z.date()` — full constraint support.

`z.literal(val)` returns the literal value. `z.enum([...])` and `z.nativeEnum(E)` pick a random value.

`z.optional(T)` generates a value 70% of the time and `undefined` 30% of the time — the decision is made before generating the inner value. `z.nullable(T)` returns `null` 20% of the time.

`z.default(val)` generates the inner schema dynamically unless `useDefaults: true` is set. `z.catch(val)` generates the inner schema and ignores the fallback.

`z.array(T)` generates 1–5 items unless constrained. `z.tuple([...])` generates each element in order. `z.object({})` recurses into each field with the field name appended to the path.

`z.union([...])` tries each branch in random order, at most once each, and returns the first success. All branches failing throws `GENERATION_FAILED`. `z.discriminatedUnion(key, [...])` picks a random branch and sets the discriminator key correctly.

`z.intersection(A, B)` generates A and B independently and deep-merges them with B overriding A on conflicts. Arrays replace. If the merged result fails schema validation, `GENERATION_FAILED` is thrown.

`z.record(K, V)` produces 2–4 key-value pairs. `z.map(K, V)` produces a Map with 2–4 entries. `z.set(T)` produces a Set with 2–4 values.

`z.lazy(T)` recurses up to `maxDepth`. Optional objects return `undefined`, arrays return `[]`, and required objects throw `MAX_DEPTH_EXCEEDED`.

`z.readonly(T)` ignores the readonly wrapper and generates from the inner type. `z.string().brand<B>()` and `z.number().brand<B>()` ignore the brand and generate the underlying type.

`z.coerce.string()`, `z.coerce.number()`, `z.coerce.boolean()`, `z.coerce.bigint()`, and `z.coerce.date()` are fully supported — zodmint generates the target type directly. The coerce transform is a no-op on a value that's already the correct native type, so `safeParse` always succeeds.

`z.unknown()` and `z.any()` produce a random primitive (string, number, or boolean). `z.nan()` returns `NaN` — see the warning below. `z.void()` returns `undefined`.

`z.string().transform(...)` is supported; the transform runs once via `safeParse`. `z.promise(T)` is supported — it generates `Promise.resolve(value)` where `value` is generated from the inner schema `T`. `z.object({}).catchall(T)` generates all declared fields plus 1–3 additional key-value pairs whose values conform to `T`. `z.refine()` and `z.superRefine()` are supported via generate-and-test, retrying up to `refinementRetries` times (default: 10) before throwing `GENERATION_FAILED`. `z.preprocess()` with a non-primitive output and `z.pipe()` (v3) throw `UNSUPPORTED_SCHEMA` with an actionable message pointing to the path-based generator workaround.

`z.custom<T>()` generates a random primitive (string, number, or boolean) as best-effort — the user-defined predicate cannot be introspected. If the predicate rejects the value, use a path-based generator to supply a valid value directly: `generators: { "myField": () => yourValidValue }`.

`z.never()` throws `UNSUPPORTED_SCHEMA` — it has no valid value by definition.

---

## ⚠️ `z.nan()` Warning

`z.nan()` returns `NaN`. A few things to keep in mind: `NaN !== NaN` in JavaScript, which breaks deep equality checks in test assertions. `JSON.stringify({ x: NaN })` produces `'{"x":null}'`, so snapshot tests may behave unexpectedly. If you're using jest's `toEqual` or vitest's `expect().toEqual()`, NaN-containing results will need special handling.

---

## Error Handling

All errors are instances of `ZodForgeError` and carry a `code` property. Error messages always include the schema path.

```typescript
import { ZodForgeError } from "zodmint";

try {
  mock(schema, { overrides: { address: { age: -5 } } });
} catch (e) {
  if (e instanceof ZodForgeError) {
    console.log(e.code); // "INVALID_OVERRIDE"
    console.log(e.message); // 'Override at "address.age" failed: ...'
  }
}
```

`UNSUPPORTED_SCHEMA` is thrown for `z.never()`, `z.preprocess()` (with non-primitive output), `z.pipe()` (v3), `z.symbol()`, `z.custom()`, and overrides on transform schemas.

`UNSUPPORTED_MODE` is no longer thrown for any currently supported mode (`"realistic"`, `"edge"`, `"random"`).

`INVALID_OVERRIDE` is thrown when an override produces a value that fails schema validation. The message includes the failing path and a description of the violation.

`REGEX_UNSUPPORTED` is thrown for regex patterns outside the supported subset.

`MAX_DEPTH_EXCEEDED` is thrown when a required recursive object hits `maxDepth`. The message includes the path and the configured depth.

`GENERATION_FAILED` is thrown when all union branches fail, an intersection conflict can't be resolved, constraints are mathematically unsatisfiable, or a refinement is not satisfied after exhausting all retries.

---

## Reproducibility

Pass a `seed` to get deterministic output:

```typescript
const a = mock(UserSchema, { seed: 42 });
const b = mock(UserSchema, { seed: 42 });
// a deep-equals b
```

Without a seed, each call uses a fresh random state. Determinism is guaranteed within a major version. Breaking changes to generators (improving realism, fixing edge cases) may change output between major releases — if you're relying on specific seeded values across upgrades, regenerate your snapshots after upgrading.

---

## Why not just use faker?

faker is great for generating realistic-looking data but it knows nothing about your schema. A `faker.number.int()` call doesn't know about `.positive()`. `faker.internet.email()` doesn't know about `.max(10)`. Keeping faker-based fixtures valid under schema changes is a constant maintenance burden — and failures are silent until a test runs.

```typescript
const schema = z.object({
  age: z.number().min(18).max(30),
  email: z.string().email(),
});

const user = {
  age: faker.number.int(), // maybe 999
  email: faker.lorem.word(), // not an email
};

schema.parse(user); // boom
```

zodmint derives the data from the schema itself, so constraints are always satisfied by construction. When the schema changes, the fixtures automatically adapt.

---

## Roadmap

Known gaps:

**Compiled generators** — `compile(schema)` to pre-compute regex plans, generators, and semantic resolution for high-throughput scenarios. Not yet implemented.

**ORM/OpenAPI ingestion** — Only makes sense after relational generation matures.

---

Zod v4 uses `new Function()` internally to compile schema validators. If your environment disables `unsafe-eval` (e.g. via CSP), stick with Zod v3.

---

## Integrations

### fast-check

zodmint ships a `zodmint/fast-check` sub-entry that converts any Zod schema into a real `fc.Arbitrary` with full shrinking support. Unlike `fc.constant(mock(schema))`, these arbitraries let fast-check find the minimal failing case when a property fails.

```bash
npm install fast-check
```

```typescript
import { arb } from "zodmint/fast-check";
import * as fc from "fast-check";

// Property-based test: every generated user must pass schema validation
fc.assert(
  fc.property(arb(UserSchema), (user) => {
    return UserSchema.safeParse(user).success;
  })
);

// Combine with fast-check's own primitives
fc.assert(
  fc.property(arb(UserSchema), fc.string(), (user, role) => {
    return processUser({ ...user, role }).success;
  })
);
```

`arb()` maps each Zod type to a native fast-check arbitrary: `z.string()` to `fc.string()`, `z.number().int()` to `fc.integer()`, `z.object({})` to `fc.record()`, `z.union()` to `fc.oneof()`, and so on. Format constraints (`z.email()`, `z.uuid()`) use specialized fc generators. Complex formats that fast-check cannot model natively fall back to `fc.constant(mock(schema))` with a code comment explaining why.

---

### MSW (Mock Service Worker)

zodmint ships a first-class `zodmint/msw` sub-entry with a `mockHandler()` factory that wires a Zod schema directly to an MSW v2 route. Install MSW first:

```bash
npm install msw
```

```typescript
import { mockHandler, mockHandlers } from "zodmint/msw";
import { UserSchema, PostSchema, ErrorSchema } from "./schemas";

// Single handler
export const handlers = [
  mockHandler(UserSchema, "GET /api/users/:id"),
  mockHandler(PostSchema, "POST /api/posts", { status: 201 }),
  mockHandler(ErrorSchema, "GET /api/broken", { status: 500 }),
];

// Or batch with mockHandlers()
export const handlers = mockHandlers([
  { schema: UserSchema, route: "GET /api/users/:id" },
  { schema: PostSchema, route: "POST /api/posts", status: 201 },
  { schema: ErrorSchema, route: "GET /api/error", status: 500 },
]);
```

`mockHandler` supports all `MockOptions` (`seed`, `overrides`, `mode`, etc.) plus HTTP-specific options:

```typescript
// Deterministic fixture — same data on every test run
mockHandler(UserSchema, "GET /api/users/:id", { seed: 42 })

// Simulate a slow endpoint to test loading states
mockHandler(UserSchema, "GET /api/users/:id", { delay: 300 })

// Simulate a permanently hanging request (e.g. spinner test)
mockHandler(UserSchema, "GET /api/data", { delay: "infinite" })

// Custom response headers
mockHandler(UserSchema, "GET /api/users/:id", {
  headers: { "X-Rate-Limit-Remaining": "0" },
})
```

Because zodmint guarantees `safeParse` validity, every response your MSW handler returns will satisfy the same schema your application uses to validate real API responses -- no shape mismatches, no silent test passes that break in production.

---

### CLI — `zodmint gen`

Generate fixture JSON from any Zod schema file directly from the terminal, without a test harness.

```bash
npx zodmint gen ./src/schemas/user.ts --schema UserSchema
npx zodmint gen ./schemas/post.ts --count 5 --seed 42 --mode edge
npx zodmint gen ./schemas/order.ts --schema OrderSchema --compact
```

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `--schema <name>` | auto-detected | Export name to use (required if multiple schemas found) |
| `--count <n>` | `1` | Number of fixtures to generate |
| `--seed <n>` | random | Seed for deterministic output |
| `--mode` | `realistic` | `realistic` \| `edge` \| `random` |
| `--compact` | off | Compact JSON output instead of pretty-printed |

For TypeScript source files, pipe through `tsx`:

```bash
npx tsx ./node_modules/.bin/zodmint gen ./src/schemas/user.ts
```

Or add a script to `package.json`:

```json
{ "scripts": { "gen": "tsx ./node_modules/.bin/zodmint gen" } }
```

---

### Snapshot Pinning — `mockPin`

`mockPin` generates a value and writes it to a JSON fixture file the first time it runs. Subsequent calls read from the file, giving you a stable snapshot that is always valid and always typed.

```typescript
import { mockPin } from "zodmint";

// First run: generates and writes __zodmint__/pin-42.json
// Subsequent runs: reads from the file
const user = mockPin(UserSchema, 42);
```

To regenerate a pin (after a schema change, for example):

```typescript
// Option A: per-call
const user = mockPin(UserSchema, 42, { update: true });

// Option B: environment variable (updates all pins in a run)
// ZODMINT_UPDATE_PINS=1 vitest run
```

Custom location and label:

```typescript
const user = mockPin(UserSchema, 42, {
  dir: "__fixtures__",  // directory to write files into
  label: "user",        // file name prefix: __fixtures__/user-42.json
});
```

Serialization handles the full zodmint type surface -- `Date`, `Set`, `Map`, and `bigint` round-trip correctly through JSON.

---

### Cross-Schema Consistency — `mockRelated`

`mockRelated` generates two objects and links fields on the second to values from the first, enforcing referential integrity without manual wiring.

```typescript
import { mockRelated } from "zodmint";

const [user, post] = mockRelated(
  UserSchema,
  PostSchema,
  { userId: "id", authorEmail: "email" },
);
// post.userId === user.id  ✓
// post.authorEmail === user.email  ✓
```

Use a mapper function for derived values:

```typescript
const [org, member] = mockRelated(
  OrgSchema,
  MemberSchema,
  { orgId: "id", displayName: (org) => `Member of ${org.name}` },
);
```

Generate multiple related pairs with `mockRelatedMany`:

```typescript
const pairs = mockRelatedMany(UserSchema, PostSchema, { userId: "id" }, 3);
// pairs[0][1].userId === pairs[0][0].id  ✓
// pairs[1][1].userId === pairs[1][0].id  ✓
```

Three-schema variant with `mockRelatedThree`:

```typescript
const [user, product, order] = mockRelatedThree(
  UserSchema,
  ProductSchema,
  OrderSchema,
  {
    userId:    { from: "a", key: "id" },
    productId: { from: "b", key: "id" },
    totalCost: (_, product) => product.price * 2,
  },
);
```

---

## Prior art

zodmint was built with an eye on the existing ecosystem. Three libraries were studied for orientation:

- [**@anatine/zod-mock**](https://www.npmjs.com/package/@anatine/zod-mock) — the most widely used Zod mock library. It identified the core demand for schema-driven generation but relies on Faker.js, doesn't enforce constraints, and produces non-deterministic dates. zodmint was partly motivated by fixing those gaps.
- [**zod-schema-faker**](https://www.npmjs.com/package/zod-schema-faker) — Faker.js + randexp.js, with seeding support. Inspired zodmint's seeded RNG approach, but still skips some constraints and requires an `install()` call before use.
- [**interface-forge**](https://www.npmjs.com/package/interface-forge) — the most ergonomic factory API in the space. Its `states`, `afterBuild`, and `extend()` patterns directly inspired the same features in `mockFactory()`. zodmint borrows the factory ergonomics without the Faker.js dependency or bundle size cost.

zodmint's goal is the best of all three: constraint fidelity from first principles, deterministic seeding, and a factory API that scales to real test suites.
