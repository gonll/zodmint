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

  return false;
}

/**
 * Core generation pipeline.
 *
 * Steps:
 * 1. Config snapshot is captured by the caller before entering the pipeline.
 * 2. Generate input-domain value via dispatch.
 * 3. Run schema.safeParse() exactly once → output domain.
 * 4. Apply deep-partial overrides (if schema has no transforms).
 * 5. Validate final output; throw INVALID_OVERRIDE if it fails.
 * 6. Return typed output.
 */
export function runPipeline<S extends z.ZodTypeAny>(
  schema: S,
  ctx: GenerationContext,
  config: GlobalConfig,
  options: MockOptions | undefined,
): z.infer<S> {
  const overrides = options?.overrides;

  // Guard: overrides on transform schemas are unsupported in v1
  if (overrides !== undefined && schemaHasTransform(schema)) {
    throw new ZodForgeError(
      `Overrides are not supported on schemas containing .transform() in v1. ` +
        `The transform/output domain cannot be safely merged. ` +
        `Apply overrides to the schema's input type, or use a non-transform schema.`,
      "UNSUPPORTED_SCHEMA",
    );
  }

  // Step 2: Generate input-domain value
  const generated = dispatch(schema, ctx, config, null);

  // Step 3: Run safeParse exactly once to get output domain (executes transforms)
  const parsed = schema.safeParse(generated);
  if (!parsed.success) {
    // This is a bug in our generators — surface it clearly
    throw new ZodForgeError(
      `Generated value at ${formatPath(ctx.path)} failed schema validation: ${parsed.error.message}. ` +
        `This is likely a bug in zod-forge — please report it.`,
      "GENERATION_FAILED",
    );
  }

  let result = parsed.data as z.infer<S>;

  // Step 4: Apply overrides (only on non-transform schemas)
  if (overrides !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = deepMerge(result, overrides as any) as z.infer<S>;

    // Step 5: Validate final overridden result
    const revalidated = schema.safeParse(result);
    if (!revalidated.success) {
      // v4 uses .issues, v3 uses .errors (which is an alias for .issues in v3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const issueList: any[] = (revalidated.error as any).issues ?? (revalidated.error as any).errors ?? [];
      const firstError = issueList[0];
      const errorPath = firstError?.path?.join(".") ?? "<root>";
      throw new ZodForgeError(
        `Override at "${errorPath}" failed: ${firstError?.message ?? revalidated.error.message}`,
        "INVALID_OVERRIDE",
      );
    }
    result = revalidated.data as z.infer<S>;
  }

  return result;
}
