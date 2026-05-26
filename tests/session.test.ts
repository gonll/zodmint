import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mock, mockList } from "../src/mock.js";
import { createSession, seq } from "../src/session.js";
import { configure, resetConfig } from "../src/config.js";
import type { MatcherContext } from "../src/config.js";
import { afterEach } from "vitest";

afterEach(() => resetConfig());

describe("createSession()", () => {
  it("returns a session with empty store and sequences", () => {
    const session = createSession();
    expect(session.store).toBeInstanceOf(Map);
    expect(session.sequences).toBeInstanceOf(Map);
    expect(session.store.size).toBe(0);
    expect(session.sequences.size).toBe(0);
  });
});

describe("seq()", () => {
  it("starts at 1 and increments", () => {
    const session = createSession();
    expect(seq("userId", session)).toBe(1);
    expect(seq("userId", session)).toBe(2);
    expect(seq("userId", session)).toBe(3);
  });

  it("different keys have independent counters", () => {
    const session = createSession();
    expect(seq("userId", session)).toBe(1);
    expect(seq("orderId", session)).toBe(1);
    expect(seq("userId", session)).toBe(2);
    expect(seq("orderId", session)).toBe(2);
  });

  it("returns 1 when no session is provided", () => {
    expect(seq("key")).toBe(1);
    expect(seq("key")).toBe(1);
    expect(seq("key", undefined)).toBe(1);
  });
});

describe("session in mock()", () => {
  it("passes session to MatcherContext in custom matchers", () => {
    const session = createSession();
    const receivedSessions: unknown[] = [];

    configure({
      matchers: [
        {
          pattern: /testField/i,
          generate: (ctx?: MatcherContext) => {
            receivedSessions.push(ctx?.session);
            return "test-value";
          },
        },
      ],
    });

    const schema = z.object({ testField: z.string() });
    mock(schema, { session });

    expect(receivedSessions.length).toBeGreaterThan(0);
    expect(receivedSessions[0]).toBe(session);
  });

  it("session is undefined in MatcherContext when no session passed", () => {
    const receivedSessions: unknown[] = [];

    configure({
      matchers: [
        {
          pattern: /testField/i,
          generate: (ctx?: MatcherContext) => {
            receivedSessions.push(ctx?.session);
            return "test-value";
          },
        },
      ],
    });

    const schema = z.object({ testField: z.string() });
    mock(schema);

    expect(receivedSessions[0]).toBeUndefined();
  });

  it("same session shared across multiple mock() calls enables state sharing", () => {
    const session = createSession();
    let counter = 0;

    configure({
      matchers: [
        {
          pattern: /id/i,
          generate: (ctx?: MatcherContext) => {
            if (ctx?.session) {
              counter++;
              return counter;
            }
            return 999;
          },
        },
      ],
    });

    const schema = z.object({ id: z.number() });
    const a = mock(schema, { session });
    const b = mock(schema, { session });

    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it("session.store can be read and written across calls", () => {
    const session = createSession();
    session.store.set("lastEmail", "first@example.com");

    expect(session.store.get("lastEmail")).toBe("first@example.com");

    session.store.set("lastEmail", "second@example.com");
    expect(session.store.get("lastEmail")).toBe("second@example.com");
  });

  it("seq() works with session passed via mock() matchers", () => {
    const session = createSession();

    configure({
      matchers: [
        {
          pattern: /userId/i,
          generate: (ctx?: MatcherContext) => seq("user", ctx?.session),
        },
      ],
    });

    const schema = z.object({ userId: z.number() });
    const a = mock(schema, { session });
    const b = mock(schema, { session });

    expect(a.userId).toBe(1);
    expect(b.userId).toBe(2);
  });
});
