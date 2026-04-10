/**
 * Standalone test for toggleExcludedLap.
 * Run: npx tsx frontend/src/utils/excludedLaps.test.ts
 */
import { toggleExcludedLap } from './excludedLaps';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.error(`  FAIL: ${label}`);
  }
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('toggleExcludedLap tests\n');

// Toggle adds a segment that isn't present
assert(eq(toggleExcludedLap([0], 3), [0, 3]), 'add segment 3 to [0]');

// Toggle removes a segment that is present
assert(eq(toggleExcludedLap([0, 3], 3), [0]), 'remove segment 3 from [0,3]');

// Double toggle same segment cancels out
const base = [0, 1, 4];
const after1 = toggleExcludedLap(base, 2);
const after2 = toggleExcludedLap(after1, 2);
assert(eq(after2, base), 'double toggle same segment returns to original');

// Two different segments from same baseline: sequential application
const r1 = toggleExcludedLap([0], 2);
const r2 = toggleExcludedLap(r1, 5);
assert(eq(r2, [0, 2, 5]), 'toggle seg 2 then seg 5 from [0] gives [0,2,5]');

// Result is always sorted
assert(eq(toggleExcludedLap([5, 0], 2), [0, 2, 5]), 'result is sorted');

// Empty list + toggle
assert(eq(toggleExcludedLap([], 0), [0]), 'add seg 0 to empty list');

// Remove last element
assert(eq(toggleExcludedLap([3], 3), []), 'remove only element gives empty');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
