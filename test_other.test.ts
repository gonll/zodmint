import { describe, it, expect } from 'vitest';
import { mock } from './src/mock.js';
import { z } from 'zod';

describe('other potential bugs', () => {
  it('v4 multi-literal: getLiteralValue only returns first', () => {
    // In v4, z.literal('a','b','c') def.values = ['a'] only (second arg is error message)
    // So this is actually correct behavior -- the test in audit-fixes uses z.union
    const s = z.literal('only');
    expect(mock(s)).toBe('only');
  });
  
  it('regex group quantifier reuse bug', () => {
    // In generateSimpleRegex, for group (?:foo|bar){3}, 
    // groupVal is generated ONCE then repeated count times
    // This means all repetitions produce the same string
    // e.g. (foo|bar){3} always produces "foofoofoo" or "barbarbar", never "foobarfoo"
    // This is a logic issue (reduces coverage) but not a validity bug per se
    const schema = z.string().regex(/^(foo|bar){3}$/);
    const val = mock(schema, { seed: 0 });
    console.log('regex group test:', val);
    expect(schema.safeParse(val).success).toBe(true);
  });
  
  it('dispatchLazy double-depth increment check', () => {
    // Comment in dispatchLazy says "The caller's childCtx/arrayItemCtx already incremented depth"
    // But dispatchLazy is called from dispatch() directly via case "lazy":
    //   return dispatchLazy(schema, ctx, config, leaf);
    // The ctx at that point has NOT had depth incremented by childCtx yet.
    // childCtx increments depth, then calls dispatch, which calls dispatchLazy.
    // So inside dispatchLazy, ctx.depth is already incremented by the caller's childCtx.
    // That's correct. The comment is accurate.
    // But if dispatchLazy is called at depth=0 (top level), depth is never incremented
    // and recursion can go infinite. Let's test.
    type Tree = { val: number; child?: Tree };
    const TreeSchema: z.ZodType<Tree> = z.lazy(() => z.object({
      val: z.number(),
      child: z.optional(TreeSchema),
    }));
    // This should work without infinite recursion
    expect(() => mock(TreeSchema, { maxDepth: 3 })).not.toThrow();
  });
  
  it('anchor stripping bug in generateSimpleRegex: only strips trailing $, not all', () => {
    // s.endsWith("$") check: this only strips a single terminal $
    // But "^abc$def$" would incorrectly keep the middle $
    // More seriously: /^$/ (empty string regex) strips both chars and produces ""
    const schema = z.string().regex(/^abc$/);
    const val = mock(schema, { seed: 0 });
    console.log('regex anchor test:', val, 'len:', val.length);
    expect(schema.safeParse(val).success).toBe(true);
  });
});
