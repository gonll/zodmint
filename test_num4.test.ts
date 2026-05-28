import { describe, it } from 'vitest';
import { mock } from './src/mock.js';
import { z } from 'zod';

describe('extended range test', () => {
  it('gt/lt with large seed space', () => {
    const schema = z.number().gt(5).lt(6);
    let fails = 0;
    const SEEDS = 10000;
    for (let seed = 0; seed < SEEDS; seed++) {
      const v = mock(schema, { seed });
      const check = schema.safeParse(v);
      if (!check.success) {
        console.log('FAIL at seed', seed, ':', v);
        fails++;
        if (fails >= 3) break;
      }
    }
    console.log('Total safeParse fails in', SEEDS, 'seeds:', fails);
  });
  
  it('gt(0) = positive() test', () => {
    const schema = z.number().positive();
    let fails = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const v = mock(schema, { seed });
      if (v <= 0) {
        console.log('FAIL at seed', seed, ':', v);
        fails++;
      }
    }
    console.log('positive() fails:', fails);
  });
  
  it('lt(0) = negative() test', () => {
    const schema = z.number().lt(0);
    let fails = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const v = mock(schema, { seed });
      if (v >= 0) {
        console.log('FAIL at seed', seed, ':', v);
        fails++;
      }
    }
    console.log('lt(0) fails:', fails);
  });
});
