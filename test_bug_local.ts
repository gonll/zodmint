import { mock } from './src/mock.js';
import { z } from 'zod';
const gt = 5;
const EPSILON = Number.EPSILON;
const computed = Math.max(-Infinity, gt + EPSILON);
console.log('resolveNumberMin result for gt(5):', computed);
console.log('Is it > 5?', computed > 5);
console.log('Is it === 5?', computed === 5);

const schema = z.number().gt(5).lt(6);
let fails = 0;
for (let seed = 0; seed < 2000; seed++) {
  const v = mock(schema, { seed });
  const check = schema.safeParse(v);
  if (!check.success) {
    console.log('FAIL at seed', seed, ':', v);
    fails++;
    if (fails >= 3) break;
  }
}
console.log('Total fails in 2000 seeds:', fails);
