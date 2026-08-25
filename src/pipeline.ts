import { z } from "zod";
import { ZodForgeError, formatPath } from "./errors.js";
import type { GenerationContext } from "./context.js";
import { createSeededRNG, childCtx } from "./context.js";
import type { GlobalConfig, MockOptions } from "./config.js";
import { dispatch } from "./generators/zod-types.js";
import { isPlainObject } from "./merge.js";
import {
  typeName,
  rawDef,
  isV4,
  getShape,
  getInnerType,
  getIntersectionParts,
  getLazyGetter,
  getBrandedInner,
} from "./compat.js";
import { leafKey } from "./generators/semantic.js";
import { getGenerationHint } from "./hint.js";

/**
 * Unwraps schema layers that don't change the underlying object shape, so
 * override-path resolution can see through them: optional/nullable/default/
 * catch/readonly (peel to inner), branded (peel to base), lazy (resolve the
 * getter). Stops at anything else (object, intersection, union, primitives).
 */
function unwrapForShapeLookup(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema;
  for (let i = 0; i < 20; i++) {
    const tn = typeName(s);
    if (
      tn === "optional" ||
      tn === "nullable" ||
      tn === "default" ||
      tn === "catch" ||
      tn === "readonly"
    ) {
      s = getInnerType(s);
      continue;
    }
    if (tn === "branded") {
      s = getBrandedInner(s);
      continue;
    }
    if (tn === "lazy") {
      s = getLazyGetter(s)();
      continue;
    }
    break;
  }
  return s;
}

/**
 * Resolves the sub-schema declared for `key` on an object-shaped schema,
 * unwrapping non-shape-changing wrappers first and checking both sides of an
 * intersection. Returns null when the shape can't be determined (e.g. behind
 * a union, where not knowing the base value gives no way to know which
 * branch applies) or `key` isn't declared anywhere found.
 */
function resolveChildSchemaForOverride(
  schema: z.ZodTypeAny,
  key: string,
): z.ZodTypeAny | null {
  const concrete = unwrapForShapeLookup(schema);
  const tn = typeName(concrete);
  if (tn === "object") {
    const shape = getShape(concrete);
    return (shape[key] as z.ZodTypeAny | undefined) ?? null;
  }
  if (tn === "intersection") {
    const { left, right } = getIntersectionParts(concrete);
    return resolveChildSchemaForOverride(left, key) ?? resolveChildSchemaForOverride(right, key);
  }
  return null;
}

/**
 * Schema-aware replacement for deepMerge() used specifically for applying
 * user-supplied `overrides` on top of a dispatch()-generated value.
 *
 * Plain deepMerge() has no schema awareness, so when the generated base at
 * some path is not a plain object — an optional object field the RNG decided
 * to omit, or a z.lazy() branch truncated at maxDepth — merging a partial
 * override onto it just replaces the missing base wholesale with the raw
 * override object. Any required sibling field the caller didn't mention in
 * the override is then absent from the merged value, and safeParse fails
 * blaming that unrelated sibling ("Required") instead of the real cause.
 *
 * Here, whenever a plain-object override is about to land on a base that
 * isn't itself a plain object, we first try to resolve the schema at this
 * position (see unwrapForShapeLookup / resolveChildSchemaForOverride) and, if
 * it resolves to an object type, synthesize a full value from it via
 * dispatch() — so untouched required fields still get generated normally —
 * before merging the override on top. When the schema can't be resolved
 * (most commonly: behind a union, or the position genuinely isn't an object
 * type), this falls back to overwriting wholesale, the same behavior plain
 * deepMerge() has always had.
 */
function mergeOverrides(
  schema: z.ZodTypeAny | null,
  base: unknown,
  overrides: unknown,
  ctx: GenerationContext,
  config: GlobalConfig,
): unknown {
  if (!isPlainObject(overrides)) {
    // Non-object override: it wins outright unless explicitly undefined,
    // matching deepMerge()'s scalar/array-replace semantics.
    return overrides === undefined ? base : overrides;
  }

  let effectiveBase = base;
  if (!isPlainObject(effectiveBase) && schema) {
    const concrete = unwrapForShapeLookup(schema);
    const concreteType = typeName(concrete);
    // "object" dispatches directly. "intersection" is also safe to dispatch
    // as a unit — dispatch() already knows how to combine both sides of a
    // z.and() into one merged plain object (including correlating shared
    // literal/enum fields) — so a lazy-wrapped `.and()` chain like
    // `z.lazy(() => Base).and(Widener)` still gets a correctly-synthesized
    // base instead of bailing out here.
    if (concreteType === "object" || concreteType === "intersection") {
      effectiveBase = dispatch(concrete, ctx, config, leafKey(ctx.path));
    }
  }

  if (!isPlainObject(effectiveBase)) {
    return overrides;
  }

  const result: Record<string, unknown> = { ...effectiveBase };
  for (const [key, val] of Object.entries(overrides)) {
    if (val === undefined) continue;
    const childSchema = schema ? resolveChildSchemaForOverride(schema, key) : null;
    result[key] = mergeOverrides(childSchema, result[key], val, childCtx(ctx, key), config);
  }
  return result;
}

/**
 * Returns true if the schema (or any nested schema) contains a transform.
 * Used to gate override support.
 */
export function schemaHasTransform(schema: z.ZodTypeAny): boolean {
  const tn = typeName(schema);

  // v4: ZodPipe always contains a transform
  if (tn === "pipe") return true;
  if (tn === "transform") return true;

  // v3: ZodEffects with transform or preprocess effect
  if (tn === "effects") {
    const def = rawDef(schema);
    if ((def.effect as { type?: string } | undefined)?.type === "transform") return true;
    if ((def.effect as { type?: string } | undefined)?.type === "preprocess") return true;
    if (def.schema) return schemaHasTransform(def.schema as z.ZodTypeAny);
  }

  // Recurse into wrapper types using rawDef
  const def = rawDef(schema);
  const inner = (def.innerType ?? def.schema ?? (!isV4(schema) ? def.type : undefined)) as z.ZodTypeAny | undefined;
  if (inner && typeof inner === "object" && ("_def" in inner || "_zod" in inner)) {
    return schemaHasTransform(inner);
  }

  if (def.options) return (def.options as z.ZodTypeAny[]).some(schemaHasTransform);
  if (def.left && def.right) return schemaHasTransform(def.left as z.ZodTypeAny) || schemaHasTransform(def.right as z.ZodTypeAny);
  if (def.items) return (def.items as z.ZodTypeAny[]).some(schemaHasTransform);

  // Intentionally does NOT recurse into object field shapes (def.shape).
  // Field-level transforms don't affect the top-level override contract:
  // overrides target the root output type, not individual field input types.
  // Recursing into shape would cause false positives on schemas like
  // z.object({ name: z.string().transform(...) }) and block all top-level overrides.
  return false;
}

/**
 * Core generation pipeline.
 *
 * Steps:
 * 1. Config snapshot is captured by the caller before entering the pipeline.
 * 2. Generate input-domain value via dispatch (for transform schemas, this is
 *    the pre-transform value because dispatch extracts the inner input schema).
 * 3. Apply deep-partial overrides via deepMerge into the input-domain value.
 * 4. Run schema.safeParse() exactly once → output domain (executes transforms).
 * 5. Validate output; throw INVALID_OVERRIDE if present and safeParse fails,
 *    or GENERATION_FAILED for internal generation bugs.
 * 6. Return typed output.
 *
 * Steps 1–3 operate in the input domain. Steps 4–6 in the output domain.
 */
export function runPipeline<S extends z.ZodTypeAny>(
  schema: S,
  ctx: GenerationContext,
  config: GlobalConfig,
  options: MockOptions<S> | undefined,
): z.infer<S> {
  const overrides = options?.overrides;

  // When violating, skip safeParse entirely - we intentionally produce invalid values
  // at specific paths. Normal dispatch handles violation per-path; the final result
  // is not expected to pass schema validation.
  if (options?.violate && options.violate.length > 0) {
    const generated = dispatch(schema, ctx, config, null);
    return generated as z.infer<S>;
  }

  // Step 2: Generate input-domain value.
  // For transform schemas, dispatch() already generates from the INPUT schema (pre-transform),
  // so `generated` is the input-domain value. Overrides are merged into this input-domain
  // value before safeParse, which then runs the transform exactly once.
  //
  // Consequence: overrides target the INPUT domain for transform schemas, not the output.
  // For object transforms (the common case) the input and output shapes are usually the same
  // or the output is a superset, so input-domain overrides feel natural. For type-changing
  // transforms (e.g. z.string().transform(s => parseInt(s))), overrides must be compatible
  // with the input type or safeParse will throw INVALID_OVERRIDE.
  const generated = dispatch(schema, ctx, config, null);

  // Special case: z.promise() schemas wrap a Promise. Zod v4's synchronous safeParse
  // throws when given a Promise ("Encountered Promise during synchronous parse"). Since
  // z.promise() just checks `instanceof Promise`, we return the generated Promise directly.
  // The validity invariant holds: schema.safeParse(Promise.resolve(x)) succeeds in v3,
  // and in v4 you would need parseAsync — but the structural contract is satisfied.
  if (typeName(schema) === "promise") {
    return generated as z.infer<S>;
  }

  // Step 3: Merge overrides into the generated value BEFORE safeParse so that
  // transforms see the overridden input and safeParse executes exactly once.
  const preParseValue =
    overrides !== undefined ? mergeOverrides(schema, generated, overrides, ctx, config) : generated;

  // Step 4: Run safeParse exactly once to get output domain (executes transforms).
  const parsed = schema.safeParse(preParseValue);
  if (!parsed.success) {
    // If overrides were present, this is an INVALID_OVERRIDE; otherwise it is a
    // generator bug.
    if (overrides !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const issueList: any[] = (parsed.error as any).issues ?? (parsed.error as any).errors ?? [];
      const firstError = issueList[0];
      const errorPath = firstError?.path?.join(".") ?? "<root>";
      throw new ZodForgeError(
        `Override at "${errorPath}" failed: ${firstError?.message ?? parsed.error.message}`,
        "INVALID_OVERRIDE",
      );
    }
    throw new ZodForgeError(
      `Generated value at ${formatPath(ctx.path)} failed schema validation: ${parsed.error.message}. ` +
        `This is likely a bug in zodmint — please report it.`,
      "GENERATION_FAILED",
    );
  }

  return parsed.data as z.infer<S>;
}

/**
 * Async generation pipeline — mirrors runPipeline but uses schema.safeParseAsync()
 * so that z.superRefine() with async predicates is evaluated correctly.
 *
 * dispatch() is called with asyncMode=true to prevent internal sync safeParse
 * calls on refinement schemas (which would throw "Encountered Promise" in Zod v4).
 * Instead, all refinement validation happens here via safeParseAsync.
 *
 * Retries up to ctx.refinementRetries times when async refinements fail, so that
 * probabilistic predicates (e.g. "value must be even") can be satisfied.
 * For deterministically unsatisfiable refinements, use withGenerate() to provide
 * a hint that bypasses the retry loop entirely.
 */
export async function runPipelineAsync<S extends z.ZodTypeAny>(
  schema: S,
  ctx: GenerationContext,
  config: GlobalConfig,
  options: MockOptions<S> | undefined,
): Promise<z.infer<S>> {
  const overrides = options?.overrides;

  // Violate mode — skip validation entirely, same as sync pipeline
  if (options?.violate && options.violate.length > 0) {
    const generated = dispatch(schema, { ...ctx, asyncMode: true }, config, null);
    return generated as z.infer<S>;
  }

  // Check for user-provided generation hint (withGenerate()).
  // The hint factory is called first; if the value passes safeParseAsync, use it directly.
  // This is the escape hatch for async refinements that check external state (DB, API, etc.)
  // and cannot be satisfied by brute-force generation.
  const hint = getGenerationHint(schema);
  if (hint !== undefined) {
    const candidate = hint();
    const preParseValue =
      overrides !== undefined ? mergeOverrides(schema, candidate, overrides, ctx, config) : candidate;
    const hintResult = await schema.safeParseAsync(preParseValue);
    if (hintResult.success) return hintResult.data as z.infer<S>;
    // Hint returned an invalid value — fall through to normal generation + retry loop.
  }

  const maxAttempts = ctx.refinementRetries;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Derive a fresh RNG for each retry so candidates differ across attempts
    const attemptCtx: GenerationContext =
      attempt === 0
        ? { ...ctx, asyncMode: true }
        : { ...ctx, asyncMode: true, rng: createSeededRNG(ctx.rng.nextInt(0, 2 ** 31)) };

    // Generate input-domain value with asyncMode — dispatch skips sync refinement loops,
    // preventing "Encountered Promise" errors for schemas with async superRefine.
    const generated = dispatch(schema, attemptCtx, config, null);

    // z.promise() schemas cannot be parsed synchronously or asynchronously — return directly
    if (typeName(schema) === "promise") {
      return generated as z.infer<S>;
    }

    // Merge overrides into the input-domain value (same semantics as sync pipeline)
    const preParseValue =
      overrides !== undefined
        ? mergeOverrides(schema, generated, overrides, attemptCtx, config)
        : generated;

    const parsed = await schema.safeParseAsync(preParseValue);

    if (parsed.success) return parsed.data as z.infer<S>;

    // Override failures cannot be fixed by retrying with a new generated value — fail fast
    if (overrides !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const issueList: any[] = (parsed.error as any).issues ?? (parsed.error as any).errors ?? [];
      const firstError = issueList[0];
      const errorPath = firstError?.path?.join(".") ?? "<root>";
      throw new ZodForgeError(
        `Override at "${errorPath}" failed: ${firstError?.message ?? parsed.error.message}`,
        "INVALID_OVERRIDE",
      );
    }

    // Continue to next attempt for refinement failures
  }

  throw new ZodForgeError(
    `Generated value at ${formatPath(ctx.path)} failed async schema validation after ${maxAttempts} attempts. ` +
      `If the schema has async refinements that check external state, use withGenerate() to bypass the retry loop.`,
    "GENERATION_FAILED",
  );
}
