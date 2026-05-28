import { describe, it, expect } from 'vitest';
import { mock } from './src/mock.js';
import { z } from 'zod';

// Test the depth handling for optional+lazy
describe('optional lazy depth', () => {
  it('optional wrapping lazy at max depth', () => {
    // The issue: when dispatchOptional generates the inner value (70% chance),
    // it calls dispatch(inner_lazy, ctx, config, leaf) where ctx has depth already incremented.
    // At maxDepth, dispatchLazy sees depth >= maxDepth and checks innerType.
    // innerType of z.lazy(() => z.object({...})) resolves to "object" (not optional/array/nullable)
    // So it throws MAX_DEPTH_EXCEEDED even though the field is wrapped in z.optional.
    // The fix should be: dispatchOptional should short-circuit to undefined when depth >= maxDepth.
    
    // Currently, dispatchOptional at maxDepth generates undefined only in edge mode or with 30% probability.
    // The optional wrapper gives 70% chance of recursing to the required inner object.
    // When that object hits maxDepth, it throws.
    
    // Check: does dispatchOptional check depth?
    // Looking at the code: dispatchOptional does NOT check depth.
    // Only dispatchLazy checks depth.
    // So: optional(lazy(object)) at depth >= maxDepth:
    //   dispatchOptional -> decides to generate inner (70% chance)
    //   -> dispatch(lazy, ctx, leaf) [ctx.depth = maxDepth]
    //   -> dispatchLazy -> ctx.depth >= ctx.maxDepth -> lazy resolves to object -> THROW
    // But wait: the depth is incremented in childCtx(), not in dispatchOptional.
    // So ctx.depth at dispatchOptional is already incremented.
    // The issue is that dispatchOptional doesn't check depth, so 70% of the time 
    // it tries to recurse and throws. 
    
    // Is this a bug or expected? The CLAUDE.md says:
    // "Optional at max depth -> undefined" in dispatchLazy when the lazy schema is optional.
    // But dispatchOptional itself doesn't have a depth check.
    
    // This IS a bug: when we have a required object containing optional(lazy(object)),
    // the optional field will throw MAX_DEPTH_EXCEEDED 70% of the time at maxDepth.
    // It should instead return undefined.
    
    console.log('This test demonstrates the optional+lazy maxDepth bug');
    
    type Tree = { val: number; child?: Tree };
    const TreeSchema: z.ZodType<Tree> = z.object({
      val: z.number(),
      child: z.optional(z.lazy(() => TreeSchema)),
    });
    
    let successes = 0, failures = 0;
    for (let seed = 0; seed < 20; seed++) {
      try {
        mock(TreeSchema, { seed, maxDepth: 2 });
        successes++;
      } catch(e) {
        failures++;
      }
    }
    console.log('successes:', successes, 'failures:', failures);
  });
});
