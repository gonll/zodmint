/**
 * mockFactory — states, afterBuild, and extend()
 *
 * Run: npx tsx examples/03-factory.ts
 */
import { z } from "zod";
import { mockFactory } from "zodmint";

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(["admin", "user", "guest"]),
  active: z.boolean(),
});

// Factory with named states and a derived-field hook
const userFactory = mockFactory(UserSchema, {
  states: {
    admin: { role: "admin", active: true },
    inactive: { active: false },
  },
  afterBuild: (user) => ({
    ...user,
    // derive email from generated name
    email: `${user.firstName.toLowerCase()}.${user.lastName.toLowerCase()}@acme.com`,
  }),
});

console.log("Default user:", userFactory());
console.log("Admin user:", userFactory({ states: "admin" }));
console.log("Inactive admin:", userFactory({ states: ["admin", "inactive"] }));

// extend() — derive a new factory without mutating the original
const guestFactory = userFactory.extend({
  overrides: { role: "guest" },
  afterBuild: (user) => ({
    ...user,
    email: user.email.replace("@acme.com", "@guest.acme.com"),
  }),
});

console.log("Guest:", guestFactory());
console.log("Original still works:", userFactory({ states: "admin" }))