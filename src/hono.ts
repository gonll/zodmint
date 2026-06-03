/**
 * zodmint/hono — Mock handler and app factory for Hono route testing.
 *
 * Requires hono >= 3.0.0 as a peer dependency.
 *
 * @example
 * import { Hono } from "hono";
 * import { mockHonoHandler } from "zodmint/hono";
 *
 * const app = new Hono();
 * app.get("/users/:id", mockHonoHandler(UserSchema));
 * app.post("/users",    mockHonoHandler(UserSchema, { status: 201, seed: 42 }));
 *
 * const res  = await app.request("/users/1");
 * const data = await res.json();
 * // data passes UserSchema.safeParse(data).success === true
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { mock } from "./mock.js";
import type { MockOptions } from "./config.js";
import { ZodForgeError } from "./errors.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HonoMockOptions<S extends z.ZodTypeAny> = MockOptions<S> & {
  /** HTTP status code (default: 200) */
  status?: ContentfulStatusCode;
  /** Extra response headers */
  headers?: Record<string, string>;
};

export type HonoRouteSpec<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  route: string;
  schema: S;
} & HonoMockOptions<S>;

type SupportedMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "options"
  | "all";

const SUPPORTED_METHODS: Record<string, SupportedMethod> = {
  get: "get",
  post: "post",
  put: "put",
  patch: "patch",
  delete: "delete",
  options: "options",
  all: "all",
};

// ---------------------------------------------------------------------------
// mockHonoHandler
// ---------------------------------------------------------------------------

/**
 * Returns a Hono Handler that responds with schema-valid mock JSON data.
 *
 * @example
 * app.get("/users/:id", mockHonoHandler(UserSchema));
 * app.post("/users",    mockHonoHandler(UserSchema, { status: 201, seed: 42 }));
 */
export function mockHonoHandler<S extends z.ZodTypeAny>(
  schema: S,
  options?: HonoMockOptions<S>,
): (c: Context) => Response {
  const status = options?.status ?? 200;
  const headers = options?.headers;

  return (c: Context): Response => {
    const data = mock(schema, options);

    // Hono's c.json() has strict JSONValue typing that doesn't accept z.infer<S>
    // directly. We cast through unknown since we know mock() returns a valid
    // JSON-serialisable value that satisfies the schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = c.json(data as unknown as any, status);

    if (headers) {
      const entries = Object.entries(headers);
      for (const [key, value] of entries) {
        res.headers.set(key, value);
      }
    }

    return res;
  };
}

// ---------------------------------------------------------------------------
// mockHonoApp
// ---------------------------------------------------------------------------

/**
 * Builds a fully-wired Hono app where every route returns mock data.
 * Useful when you need a complete mock API without wiring routes manually.
 *
 * Route format: `"METHOD /path"` — e.g. `"GET /users/:id"`.
 *
 * @example
 * const app = mockHonoApp([
 *   { route: "GET /users/:id", schema: UserSchema },
 *   { route: "POST /users",    schema: UserSchema,          status: 201 },
 *   { route: "GET /posts",     schema: z.array(PostSchema), seed: 1 },
 * ]);
 */
export function mockHonoApp(
  specs: HonoRouteSpec[],
  basePath?: string,
): Hono {
  const app = basePath ? new Hono().basePath(basePath) : new Hono();

  for (const { route, schema, ...options } of specs) {
    const spaceIdx = route.indexOf(" ");
    if (spaceIdx === -1) {
      throw new ZodForgeError(
        `zodmint/hono: invalid route "${route}". Expected "METHOD /path", e.g. "GET /users/:id"`,
        "INVALID_OVERRIDE",
      );
    }

    const rawMethod = route.slice(0, spaceIdx).toLowerCase();
    const path = route.slice(spaceIdx + 1).trim();
    const method = SUPPORTED_METHODS[rawMethod];

    if (!method) {
      const valid = Object.keys(SUPPORTED_METHODS).map((k) => k.toUpperCase()).join(", ");
      throw new ZodForgeError(
        `zodmint/hono: unknown HTTP method "${rawMethod.toUpperCase()}". Valid: ${valid}`,
        "INVALID_OVERRIDE",
      );
    }

    // Dynamic dispatch: cast to any so TypeScript accepts the runtime method name.
    // Safety is ensured by SUPPORTED_METHODS validation above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app as any)[method](path, mockHonoHandler(schema, options as HonoMockOptions<typeof schema>));
  }

  return app;
}
