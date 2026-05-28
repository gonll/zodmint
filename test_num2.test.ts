import { describe, it } from 'vitest';
import { mock } from './src/mock.js';
import { z } from 'zod';

describe('number exclusive bound test', () => {
  it('lt(6) edge case', () => {
    // resolveNumberMax for lt(6): Math.min(Infinity, 6 - EPSILON) = 6 - EPSILON
    // 6 - EPSILON === 6 (EPSILON too small at magnitude 6)
    const EPSILON = Number.EPSILON;
    const maxComputed = Math.min(Infinity, 6 - EPSILON);
    console.log('6 - EPSILON:', maxComputed, '=== 6?', maxComputed === 6);
    
    // So nextFloat(5, 6) can produce 6.0 when rng.next() = 1.0 (impossible from mulberry32)
    // But after toFixed(4): 5.9999 rounds to 5.9999 which is still < 6
    // Actually the real issue: nextFloat returns raw * (max-min) + min
    // If raw = 0.99999..., 0.99999 * 1 + 5 = 5.99999... 
    // toFixed(4) of 5.99999... = '6.0000' -> parseFloat = 6
    // z.number().lt(6).safeParse(6) -> FAILS (too_big, must be < 6)
    
    // Confirm: can toFixed(4) of ~6.0 round up?
    const val = 5.99995; // This would round to 6.0000 with toFixed(4)
    console.log(val.toFixed(4)); // '6.0000'
    
    const schema = z.number().gt(5).lt(6);
    // Try a specific seed that produces ~5.99995
    let found = false;
    for (let seed = 0; seed < 100; seed++) {
      const v = mock(schema, { seed });
      if (Math.abs(v - 6) < 0.001) {
        console.log('Near 6 at seed', seed, ':', v);
        found = true;
      }
    }
    console.log('found near-6:', found);
  });
});
