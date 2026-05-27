/**
 * Transforms on overrides & z.preprocess() with complex output
 *
 * Run: npx tsx examples/08-transforms.ts
 */
import { z } from "zod";
import { mock, mockList } from "zodmint";

// ─── 1. Overrides on transform schemas ────────────────────────────────────────
//
// Previously, passing overrides to a schema containing .transform() would throw.
// Now overrides are applied to the pre-transform input value; the transform then
// runs via safeParse exactly once, as usual.

// The most common case: an object transform that computes extra fields.
const UserSchema = z
  .object({
    name: z.string(),
    email: z.string().email(),
    role: z.enum(["admin", "user", "guest"]),
  })
  .transform((u) => ({
    ...u,
    // transform appends a derived display field
    displayName: `${u.name} <${u.email}>`,
    isAdmin: u.role === "admin",
  }));

// Override input fields — the transform still runs and computes displayName/isAdmin
const adminUser = mock(UserSchema, { overrides: { name: "Alice", role: "admin" } });
console.log("Admin user:", adminUser);
// → { name: 'Alice', email: '...', role: 'admin', displayName: 'Alice <...>', isAdmin: true }

const guestUser = mock(UserSchema, { overrides: { name: "Bob", role: "guest" } });
console.log("Guest user:", guestUser);
// → { ..., displayName: 'Bob <...>', isAdmin: false }

// ─── 2. String transform: override is the pre-transform input ─────────────────

const SlugSchema = z
  .string()
  .min(3)
  .transform((s) => s.toLowerCase().replace(/\s+/g, "-"));

// No overrides — fully generated and then transformed
const generatedSlug = mock(SlugSchema);
console.log("\nGenerated slug:", generatedSlug); // lowercase-with-dashes

// ─── 3. Normalisation transform: override a numeric string input ───────────────

const ParsedIntSchema = z.object({
  rawValue: z.string().regex(/^\d+$/),
  label: z.string(),
}).transform((o) => ({
  value: parseInt(o.rawValue, 10),
  label: o.label,
}));

const result = mock(ParsedIntSchema, { overrides: { rawValue: "42", label: "answer" } });
console.log("\nParsed object:", result); // { value: 42, label: 'answer' }

// ─── 4. List of transformed objects ──────────────────────────────────────────

const ProductSchema = z
  .object({
    name: z.string(),
    priceInCents: z.number().int().positive(),
    taxRate: z.number().min(0).max(0.5),
  })
  .transform((p) => ({
    ...p,
    priceDisplay: `$${(p.priceInCents / 100).toFixed(2)}`,
    totalWithTax: Math.round(p.priceInCents * (1 + p.taxRate)),
  }));

const products = mockList(ProductSchema, { count: 3 });
console.log("\nProducts:");
products.forEach((p) => console.log(" ", p.name, "→", p.priceDisplay, "(tax incl.:", p.totalWithTax + "¢)"));

// ─── 5. z.preprocess() with non-primitive output ─────────────────────────────
//
// z.preprocess(fn, schema) where schema is an object or array now generates
// valid values from the output schema directly (instead of throwing).

// Preprocess that normalises input before validating an object
const NormalizedAddressSchema = z.preprocess(
  (v) => (typeof v === "string" ? JSON.parse(v) : v),
  z.object({
    street: z.string(),
    city: z.string(),
    country: z.string().length(2),
  }),
);

const address = mock(NormalizedAddressSchema);
console.log("\nAddress:", address);
// → { street: '...', city: '...', country: 'XX' }
console.log("Valid:", NormalizedAddressSchema.safeParse(address).success); // true

// Preprocess wrapping an array schema
const TagListSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",") : v),
  z.array(z.string().min(1)).min(1).max(10),
);

const tags = mock(TagListSchema);
console.log("\nTags:", tags); // ['...', '...', ...]
console.log("Tags valid:", TagListSchema.safeParse(tags).success); // true

// ─── 6. Combined: preprocess + nested transforms ──────────────────────────────

const EventSchema = z.preprocess(
  (v) => v, // identity preprocess — ensures the outer pipe is a preprocess schema
  z.object({
    title: z.string(),
    startDate: z.string().date(),  // YYYY-MM-DD
    endDate: z.string().date(),
  }).transform((e) => ({
    ...e,
    duration: `${e.startDate} → ${e.endDate}`,
  })),
);

const event = mock(EventSchema);
console.log("\nEvent:", event);
