/** The dry run's clock option (infra/watchdog/dry-run.mjs). Importing it must not run anything. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNow } from '../dry-run.mjs';

const REAL = Date.parse('2026-11-09T19:58:00Z');

test('--now accepts nothing, +<minutes>m or an ISO time, and refuses anything else', () => {
  assert.equal(parseNow(undefined, REAL), REAL);
  assert.equal(parseNow('+90m', REAL), REAL + 90 * 60_000);
  assert.equal(parseNow('2026-11-09T18:45:00Z', REAL), Date.parse('2026-11-09T18:45:00Z'));
  assert.throws(() => parseNow('later', REAL), /--now/);
});
