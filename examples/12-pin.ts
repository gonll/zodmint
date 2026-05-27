/**
 * Example 12 — Snapshot pinning with mockPin
 *
 * mockPin generates a value and writes it to a JSON fixture file on the first
 * run. Subsequent runs read from the file, so the value is stable across test
 * runs while remaining typed and schema-valid.
 *
 * Run: npx tsx examples/12-pin.ts
 */

import { z } from "zod";
import { mockPin } from "../src/index.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Schema ───────────────────────────────────────────────────────────────────

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date(),
  score: z.number().int().min(0).max(100),
});

// ─── 1. First run: generates and writes __zodmint__/pin-42.json ───────────────

const user = mockPin(UserSchema, 42);
console.log("user:", user);
// { id: "3f2e1d4c-...", email: "alice@example.com", name: "Alice", ... }

// ─── 2. Second run: reads from __zodmint__/pin-42.json ────────────────────────

const sameUser = mockPin(UserSchema, 42);
console.log("Same across runs:", JSON.stringify(user) === JSON.stringify(sameUser)); // true

// ─── 3. Custom directory and label ───────────────────────────────────────────

// Writes to __fixtures__/admin-99.json
const admin = mockPin(UserSchema, 99, {
  dir: "__fixtures__",
  label: "admin",
});
console.log("admin:", admin);

// ─── 4. Force regeneration ───────────────────────────────────────────────────

// Use { update: true } to regenerate even when the pin file exists.
// Useful after schema changes.
const fresh = mockPin(UserSchema, 42, { update: true });
console.log("fresh (regenerated):", fresh);

// ─── 5. Date / Set / Map round-trip ──────────────────────────────────────────

const WithDate = z.object({
  id: z.string().uuid(),
  createdAt: z.date(),
});

const pinned = mockPin(WithDate, 1);
console.log("createdAt is Date:", pinned.createdAt instanceof Date); // true

// ─── Cleanup ──────────────────────────────────────────────────────────────────

// Remove example pin files
const dirs = ["__zodmint__", "__fixtures__"];
for (const dir of dirs) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log("Cleaned up pin directories.");
