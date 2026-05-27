/**
 * zodmint/msw — First-class MSW v2 handler factory.
 *
 * Requires msw ^2.0.0 as a peer dependency.
 *
 * @example
 * import { mockHandler } from 'zodmint/msw'
 *
 * export const handlers = [
 *   mockHandler(UserSchema, 'GET /api/users/:id'),
 *   mockHandler(PostSchema, 'POST /api/posts', { status: 201 }),
 *   mockHandler(ErrorSchema, 'GET /api/broken', { status: 500 }),
 * ]
 */

import { http, HttpResponse } from "msw";
import type { HttpHandler, HttpResponseInit } from "msw";
import { z } from "zod";
import { mock } from "./mock.js";
import type { MockOptions } from "./config.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MswMockOptions<S extends z.ZodTypeAny> = MockOptions<S> & {
  /** HTTP status code (default: 200) */
  status?: number;
  /** Extra response headers */
  headers?: Record<string, string>;
  /**
   * Simulated network delay in milliseconds.
   * Useful for testing loading states.
   */
  delay?: number | "infinite";
};

type SupportedMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "head"
  | "options"
  | "all";

const HTTP_METHODS: Record<string, SupportedMethod> = {
  get: "get",
  post: "post",
  put: "put",
  patch: "patch",
  delete: "delete",
  head: "head",
  options: "options",
  all: "all",
};

// ---------------------------------------------------------------------------
// mockHandler
// ---------------------------------------------------------------------------

/**
 * Creates a ready-to-use MSW v2 request handler that responds with valid mock
 * data generated from the given Zod schema.
 *
 * Route format: `"METHOD /path"` — e.g. `"GET /api/users/:id"`.
 *
 * @example
 * const handler = mockHandler(UserSchema, 'GET /api/users/:id')
 * // responds with a valid User object
 *
 * @example
 * // 201 Created with a delay to test loading states
 * const createHandler = mockHandler(PostSchema, 'POST /api/posts', {
 *   status: 201,
 *   delay: 200,
 * })
 *
 * @example
 * // Deterministic fixture (same data on every test run)
 * const handler = mockHandler(UserSchema, 'GET /api/users/:id', { seed: 42 })
 */
export function mockHandler<S extends z.ZodTypeAny>(
  schema: S,
  route: string,
  options?: MswMockOptions<S>,
): HttpHandler {
  const spaceIdx = route.indexOf(" ");
  if (spaceIdx === -1) {
    throw new TypeError(
      `zodmint/msw: invalid route "${route}". ` +
        `Expected "METHOD /path", e.g. "GET /api/users/:id"`,
    );
  }

  const rawMethod = route.slice(0, spaceIdx).toLowerCase();
  const path = route.slice(spaceIdx + 1).trim();
  const method = HTTP_METHODS[rawMethod];

  if (!method) {
    const valid = Object.keys(HTTP_METHODS).map((k) => k.toUpperCase()).join(", ");
    throw new TypeError(
      `zodmint/msw: unknown HTTP method "${rawMethod.toUpperCase()}". Valid: ${valid}`,
    );
  }

  const status = options?.status ?? 200;
  const headers = options?.headers;
  const delay = options?.delay;

  const resolver = async () => {
    if (delay === "infinite") {
      // Never resolves — useful for testing loading spinners
      await new Promise<never>(() => {});
    }
    if (typeof delay === "number" && delay > 0) {
      await new Promise<void>((r) => setTimeout(r, delay));
    }

    const data = mock(schema, options);
    const init: HttpResponseInit = headers ? { status, headers } : { status };

    // HttpResponse.json accepts JsonBodyType (Record<string,any> | primitives).
    // Cast through any — the public API is typed as z.infer<S> at the call site.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return HttpResponse.json(data as any, init);
  };

  return http[method](path, resolver);
}

// ---------------------------------------------------------------------------
// mockHandlers — batch factory
// ---------------------------------------------------------------------------

export type HandlerSpec<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  schema: S;
  route: string;
} & MswMockOptions<S>;

/**
 * Creates multiple MSW handlers in one call from an array of specs.
 *
 * @example
 * export const handlers = mockHandlers([
 *   { schema: UserSchema,  route: 'GET /api/users/:id' },
 *   { schema: PostSchema,  route: 'POST /api/posts',   status: 201 },
 *   { schema: ErrorSchema, route: 'GET /api/error',    status: 500 },
 * ])
 */
export function mockHandlers(specs: HandlerSpec[]): HttpHandler[] {
  return specs.map(({ schema, route, ...options }) =>
    mockHandler(schema, route, options as MswMockOptions<typeof schema>),
  );
}
