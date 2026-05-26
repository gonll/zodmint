import { z } from "zod";
import { ZodForgeError, formatPath } from "./errors.js";
import type { GenerationContext } from "./context.js";
import type { GlobalConfig, MockOptions } from "./config.js";
import { dispatch } from "./generators/zod-types.js";
import { deepMerge } from "./merge.js";
import { typeName, rawDef, isV4 } from "./compat.js";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preParseValue = overrides !== undefined ? deepMerge(generated as any, overrides as any) : generated;

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
