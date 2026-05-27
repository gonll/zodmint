/**
 * Violation testing — generate intentionally invalid values at specific paths
 *
 * Run: npx tsx examples/06-violate.ts
 */
import { z } from "zod";
import { mock } from "zodmint";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().int().min(18).max(99),
  username: z.string().min(3).max(20),
  role: z.enum(["admin", "user", "guest"]),
});

// Generate a fully valid fixture
const validUser = mock(UserSchema);
console.log("Valid:", UserSchema.safeParse(validUser).success); // true
console.log(validUser);

// Violate specific fields to test your validation error handling
const withBadEmail = mock(UserSchema, { violate: ["email"] });
console.log("\nViolated email:", withBadEmail.email); // "not-an-email"
const parseResult = UserSchema.safeParse(withBadEmail);
console.log("Fails validation:", !parseResult.success); // true
console.log("Error path:", parseResult.error?.issues[0]?.path); // ["email"]

// Violate multiple fields at once
const multiViolation = mock(UserSchema, { violate: ["email", "age"] });
const multiResult = UserSchema.safeParse(multiViolation);
console.log("\nMulti-violation issues:", multiResult.error?.issues.map((i) => i.path.join(".")));
// ["email", "age"]

// Unviolated fields remain valid — only the specified paths are wrong
console.log("uuid still valid:", z.string().uuid().safeParse(multiViolation.id).success); // true
