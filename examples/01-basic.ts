/**
 * Basic usage — mock() and mockList()
 *
 * Run: npx tsx examples/01-basic.ts
 */
import { z } from "zod";
import { mock, mockList } from "zodmint";

const UserSchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  age: z.number().int().min(18).max(99),
  role: z.enum(["admin", "user", "guest"]),
  createdAt: z.date(),
});

// Generate a single fixture
const user = mock(UserSchema);
console.log("Single user:", user);

// Generate a list of fixtures
const users = mockList(UserSchema, { count: 5 });
console.log("Five users:", users);

// Verify all are schema-valid
const allValid = users.every((u) => UserSchema.safeParse(u).success);
console.log("All valid:", allValid); // true
