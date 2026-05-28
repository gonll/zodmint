import { describe, it } from 'vitest';
import { mock } from './src/mock.js';
import { z } from 'zod';

describe('audit-fixes test from test suite', () => {
  it('never produces value equal to gt bound (from audit-fixes.test.ts)', () => {
    const schema = z.number().gt(5).lt(6);
    let fails = 0;
    for (let seed = 0; seed < 200; seed++) {
      const v = mock(schema, { seed });
      if (v <= 5 || v >= 6) {
        console.log('FAIL at seed', seed, ':', v, v <= 5 ? '<= 5' : '>= 6');
        fails++;
      }
    }
    console.log('Total fails:', fails);
  });
  
  it('satisfies safeParse for gt/lt schema across many seeds (from audit-fixes.test.ts)', () => {
    const schema = z.number().gt(5).lt(6);
    let fails = 0;
    for (let seed = 0; seed < 200; seed++) {
      const check = schema.safeParse(mock(schema, { seed }));
      if (!check.success) {
        console.log('safeParse FAIL at seed', seed);
        fails++;
      }
    }
    console.log('Total safeParse fails:', fails);
  });
});
