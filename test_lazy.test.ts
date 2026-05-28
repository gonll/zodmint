import { describe, it, expect } from 'vitest';
import { mock } from './src/mock.js';
import { z } from 'zod';

describe('lazy depth', () => {
  it('optional lazy terminates at maxDepth', () => {
    // With optional, dispatchLazy at max depth should return undefined
    type Tree = { val: number; child?: Tree };
    const TreeSchema: z.ZodType<Tree> = z.lazy(() => z.object({
      val: z.number(),
      child: z.optional(TreeSchema),
    }));
    // With optional field, this should terminate (dispatchOptional returns undefined before generating inner)
    // But wait: dispatchLazy checks depth >= maxDepth BEFORE calling dispatch
    // If inner is "object" (not optional/array/nullable), it throws MAX_DEPTH_EXCEEDED
    // The object has an optional field, but the lazy itself resolves to an object
    // dispatchLazy sees innerType = "object", not "optional", so it throws
    // FIX: The schema returned by the lazy getter is z.object({...}), not z.optional(...)
    // So dispatchLazy correctly throws because the lazy resolves to a required object.
    // The optional is a FIELD inside the object, not the object itself.
    // The tree should use: z.lazy(() => z.optional(z.object({...})))
    // Or: child: TreeSchema should be child: z.optional(TreeSchema)
    // The test above uses z.optional(TreeSchema) as the field type, which is correct.
    // The depth check in dispatchLazy fires when `child` field's lazy getter resolves to z.object()
    // at depth > maxDepth. This IS the right behavior.
    
    // Correct schema where lazy resolves to optional:
    type Tree2 = { val: number; child?: Tree2 };
    const TreeSchema2: z.ZodType<Tree2> = z.object({
      val: z.number(),
      child: z.optional(z.lazy(() => TreeSchema2)),
    });
    // Here the lazy resolves to the full object schema (not optional)
    // At max depth, dispatchLazy sees z.object and throws
    // But the child field is optional, so dispatchOptional returns undefined first!
    // Actually: the dispatch flow is:
    // 1. dispatchObject encounters child field which is z.optional(z.lazy(...))
    // 2. dispatch is called for z.optional(z.lazy(...))
    // 3. dispatchOptional(optional, ctx at depth+1) -- in edge mode returns undefined
    // 4. In non-edge mode, 30% chance of undefined -- but at some depth we always need it
    // The issue: dispatchOptional generates undefined 30% of time REGARDLESS of depth
    // So at maxDepth, the optional field might still try to generate the inner value!
    
    // Test: with optional wrapping the lazy, does it ever throw?
    let throws = false;
    for (let seed = 0; seed < 20; seed++) {
      try {
        mock(TreeSchema2, { seed, maxDepth: 2 });
      } catch(e) {
        console.log('threw at seed', seed, (e as Error).message.slice(0, 80));
        throws = true;
        break;
      }
    }
    console.log('ever threw:', throws);
  });
});
