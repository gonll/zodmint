// session.ts - shared state threading across mock() calls and matchers

export interface Session {
  /** Arbitrary shared store for generators and matchers to coordinate state */
  store: Map<string, unknown>;
  /** Per-key integer counters, used by seq() */
  sequences: Map<string, number>;
}

/** Returns a new empty session. */
export function createSession(): Session {
  return {
    store: new Map(),
    sequences: new Map(),
  };
}

/**
 * Returns the next integer for the given key within the session.
 * Starts at 1; different keys have independent counters.
 * Returns 1 unconditionally when no session is provided.
 */
export function seq(key: string, session?: Session): number {
  if (!session) return 1;
  const current = session.sequences.get(key) ?? 0;
  const next = current + 1;
  session.sequences.set(key, next);
  return next;
}
