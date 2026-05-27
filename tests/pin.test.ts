import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mockPin } from "../src/pin.js";
import { ZodForgeError } from "../src/errors.js";

// Use os.tmpdir() so cleanup can actually delete files (mnt dir blocks unlink)
let TEST_DIR = "";

function freshTestDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zodmint-pin-test-"));
  TEST_DIR = dir;
  return dir;
}

function cleanup() {
  if (TEST_DIR && fs.existsSync(TEST_DIR)) {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore — best effort
    }
    TEST_DIR = "";
  }
}

afterEach(() => {
  try {
    cleanup();
  } finally {
    delete process.env.ZODMINT_UPDATE_PINS;
  }
});

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  age: z.number().int().min(0).max(120),
});

describe("mockPin", () => {
  it("generates a valid fixture on first call", () => {
    const dir = freshTestDir();
    const user = mockPin(UserSchema, 42, { dir });
    const result = UserSchema.safeParse(user);
    expect(result.success).toBe(true);
  });

  it("writes the pin file to disk", () => {
    const dir = freshTestDir();
    mockPin(UserSchema, 42, { dir });
    const filePath = path.join(dir, "pin-42.json");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("returns the same value on second call (reads from file)", () => {
    const dir = freshTestDir();
    const first = mockPin(UserSchema, 42, { dir });
    const second = mockPin(UserSchema, 42, { dir });
    expect(second).toEqual(first);
  });

  it("is deterministic: same seed produces same value", () => {
    const dir1 = freshTestDir();
    const a = mockPin(UserSchema, 99, { dir: dir1, label: "a" });
    cleanup();
    const dir2 = freshTestDir();
    const b = mockPin(UserSchema, 99, { dir: dir2, label: "b" });
    expect(a).toEqual(b);
  });

  it("uses label in the filename", () => {
    const dir = freshTestDir();
    mockPin(UserSchema, 7, { dir, label: "user" });
    expect(fs.existsSync(path.join(dir, "user-7.json"))).toBe(true);
  });

  it("respects explicit file option", () => {
    const dir = freshTestDir();
    const file = path.join(dir, "custom", "my-fixture.json");
    mockPin(UserSchema, 1, { file });
    expect(fs.existsSync(file)).toBe(true);
  });

  it("validates pin against schema on read; throws if stale", () => {
    const dir = freshTestDir();
    const file = path.join(dir, "stale.json");
    fs.writeFileSync(file, JSON.stringify({ id: "not-a-uuid", name: 1, age: "old" }));
    expect(() => mockPin(UserSchema, 42, { file })).toThrow(ZodForgeError);
  });

  it("regenerates when update: true", () => {
    const dir = freshTestDir();
    const file = path.join(dir, "update.json");
    const first = mockPin(UserSchema, 42, { file });
    // Corrupt the file
    fs.writeFileSync(file, JSON.stringify({ id: "bad", name: 1, age: "x" }));
    // Should regenerate, not throw
    const updated = mockPin(UserSchema, 42, { file, update: true });
    expect(updated).toEqual(first);
  });

  it("regenerates when ZODMINT_UPDATE_PINS=1", () => {
    const dir = freshTestDir();
    const file = path.join(dir, "env.json");
    const first = mockPin(UserSchema, 42, { file });
    fs.writeFileSync(file, JSON.stringify({ id: "bad", name: 1, age: "x" }));
    process.env.ZODMINT_UPDATE_PINS = "1";
    const updated = mockPin(UserSchema, 42, { file });
    expect(updated).toEqual(first);
  });

  it("serialises and deserialises Date fields", () => {
    const dir = freshTestDir();
    const DateSchema = z.object({
      createdAt: z.date(),
      name: z.string(),
    });
    const pinned = mockPin(DateSchema, 1, { dir, label: "date" });
    expect(pinned.createdAt).toBeInstanceOf(Date);

    const read = mockPin(DateSchema, 1, { dir, label: "date" });
    expect(read.createdAt).toBeInstanceOf(Date);
    expect(read.createdAt.toISOString()).toBe(pinned.createdAt.toISOString());
  });

  it("throws ZodForgeError with INVALID_OVERRIDE code on stale pin", () => {
    const dir = freshTestDir();
    const file = path.join(dir, "stale2.json");
    fs.writeFileSync(file, JSON.stringify({ id: "bad" }));

    let thrown: unknown;
    try {
      mockPin(UserSchema, 0, { file });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ZodForgeError);
    expect((thrown as ZodForgeError).code).toBe("INVALID_OVERRIDE");
  });
});
