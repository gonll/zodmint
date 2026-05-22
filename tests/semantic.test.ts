import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mock } from "../src/mock.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@]+@[^@]+\.[a-z]+$/i;

describe("semantic inference", () => {
  it("email field generates a valid email", () => {
    const schema = z.object({ email: z.string() });
    for (let i = 0; i < 10; i++) {
      const { email } = mock(schema);
      expect(email).toMatch(EMAIL_RE);
    }
  });

  it("firstName generates a plausible first name", () => {
    const schema = z.object({ firstName: z.string() });
    const { firstName } = mock(schema);
    expect(firstName.length).toBeGreaterThan(2);
    expect(/^[A-Z]/.test(firstName)).toBe(true);
  });

  it("lastName generates a plausible last name", () => {
    const schema = z.object({ lastName: z.string() });
    const { lastName } = mock(schema);
    expect(lastName.length).toBeGreaterThan(2);
  });

  it("name (standalone) generates a full name", () => {
    const schema = z.object({ name: z.string() });
    const results = Array.from({ length: 20 }, () => mock(schema).name);
    // At least some should have a space (full name)
    const hasSpace = results.some((n) => n.includes(" "));
    expect(hasSpace).toBe(true);
  });

  it("id / uuid field generates a UUID", () => {
    const idSchema = z.object({ id: z.string() });
    const uuidSchema = z.object({ uuid: z.string() });
    expect(mock(idSchema).id).toMatch(UUID_RE);
    expect(mock(uuidSchema).uuid).toMatch(UUID_RE);
  });

  it("url field generates a valid-looking URL", () => {
    const schema = z.object({ url: z.string() });
    const { url } = mock(schema);
    expect(url).toMatch(/^https?:\/\//);
  });

  it("phone field generates a phone number", () => {
    const schema = z.object({ phone: z.string() });
    const { phone } = mock(schema);
    expect(phone.length).toBeGreaterThan(7);
  });

  it("city field generates a city name", () => {
    const schema = z.object({ city: z.string() });
    const { city } = mock(schema);
    expect(city.length).toBeGreaterThan(2);
  });

  it("age numeric field generates integer 18-80", () => {
    const schema = z.object({ age: z.number() });
    for (let i = 0; i < 20; i++) {
      const { age } = mock(schema);
      expect(age).toBeGreaterThanOrEqual(18);
      expect(age).toBeLessThanOrEqual(80);
      expect(Number.isInteger(age)).toBe(true);
    }
  });

  it("price numeric field generates float in range", () => {
    const schema = z.object({ price: z.number() });
    for (let i = 0; i < 10; i++) {
      const { price } = mock(schema);
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThanOrEqual(9999.99);
    }
  });

  it("count field generates integer 1-100", () => {
    const schema = z.object({ count: z.number() });
    for (let i = 0; i < 10; i++) {
      const { count } = mock(schema);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(100);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it("rating field generates float 0-5", () => {
    const schema = z.object({ rating: z.number() });
    for (let i = 0; i < 10; i++) {
      const { rating } = mock(schema);
      expect(rating).toBeGreaterThanOrEqual(0);
      expect(rating).toBeLessThanOrEqual(5);
    }
  });

  it("semantic uses ctx.path leaf key for nested schemas", () => {
    const schema = z.object({
      user: z.object({
        email: z.string(),
        age: z.number(),
      }),
    });
    for (let i = 0; i < 5; i++) {
      const result = mock(schema);
      expect(result.user.email).toMatch(EMAIL_RE);
      expect(result.user.age).toBeGreaterThanOrEqual(18);
    }
  });

  it("array items use '*' path marker but leaf key of parent is still available", () => {
    const schema = z.object({
      emails: z.array(z.object({ email: z.string() })),
    });
    const result = mock(schema);
    result.emails.forEach((item) => {
      expect(item.email).toMatch(EMAIL_RE);
    });
  });

  it("semantic is overridden by explicit constraint (email + email())", () => {
    const schema = z.object({ email: z.string().email() });
    for (let i = 0; i < 10; i++) {
      const result = mock(schema);
      expect(result.email).toMatch(EMAIL_RE);
    }
  });

  it("semantic falls back to constraint-safe generation when values don't fit", () => {
    // age with max(5) — semantic (18-80) won't fit, should fall back gracefully
    const schema = z.object({ age: z.number().max(5) });
    for (let i = 0; i < 10; i++) {
      const result = mock(schema);
      expect(result.age).toBeLessThanOrEqual(5);
    }
  });
});
