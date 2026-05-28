import { describe, it } from 'vitest';
import { mock } from './src/mock.js';
import { z } from 'zod';

describe('number exclusive bound test', () => {
  it('gt(5) test', () => {
    const EPSILON = Number.EPSILON;
    const computed = Math.max(-Infinity, 5 + EPSILON);
    console.log('computed min for gt(5):', computed, '> 5?', computed > 5);
    
    const schema = z.number().gt(5).lt(6);
    let fails = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const v = mock(schema, { seed });
      const check = schema.safeParse(v);
      if (!check.success) {
        console.log('FAIL seed', seed, 'v:', v);
        fails++;
        if (fails >= 3) break;
      }
    }
    console.log('fails:', fails);
  });
});
