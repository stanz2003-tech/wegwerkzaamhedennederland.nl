/**
 * Tests for the wekker's decision after its wait (infra/wekker/next.mjs), with the shape of the
 * night the chain died: 27 September 2026, 18:13–18:21 UTC.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, MIN_OWN_AGE_SECONDS } from '../next.mjs';

const WEKKER_CREATED = '2026-09-27T18:13:39Z';
const AFTER_TIMER = Date.parse('2026-09-27T18:21:45Z');
const done = (createdAt) => ({ status: 'completed', createdAt });

test('a fallback run in the middle of the wait does not stop the chain (27 September)', () => {
  // The hourly fallback started at 18:17:10, 4.5 minutes before the wekker woke. The old guard
  // compared against that run and stopped; the chain was dead for hours.
  const d = decide({
    nowMs: AFTER_TIMER,
    selfCreatedAt: WEKKER_CREATED,
    dataRuns: [done('2026-09-27T18:17:10Z'), done('2026-09-27T18:12:57Z')],
  });
  assert.equal(d.action, 'dispatch-data');
});

test('a wekker that did not wait stops: the timer on the environment is missing', () => {
  const d = decide({ nowMs: Date.parse('2026-09-27T18:14:10Z'), selfCreatedAt: WEKKER_CREATED, dataRuns: [done('2026-09-27T18:12:57Z')] });
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /wait timer/);
});

test('a data run still busy gets a new wekker, never nothing', () => {
  // That run's "Wekker zetten" step may already have seen this wekker waiting and deferred to it.
  const d = decide({
    nowMs: AFTER_TIMER,
    selfCreatedAt: WEKKER_CREATED,
    dataRuns: [{ status: 'in_progress', createdAt: '2026-09-27T18:20:30Z' }, done('2026-09-27T18:12:57Z')],
  });
  assert.equal(d.action, 'rearm');
  for (const status of ['queued', 'waiting', 'pending', 'requested']) {
    assert.equal(decide({ nowMs: AFTER_TIMER, selfCreatedAt: WEKKER_CREATED, dataRuns: [{ status }] }).action, 'rearm', status);
  }
});

test('an unreadable own age or run list never kills the chain', () => {
  assert.equal(decide({ nowMs: AFTER_TIMER, selfCreatedAt: '', dataRuns: [] }).action, 'dispatch-data');
  assert.equal(decide({ nowMs: AFTER_TIMER, selfCreatedAt: WEKKER_CREATED, dataRuns: null }).action, 'dispatch-data');
});

test('the own-age floor stays below the eight-minute wait and well above a run without one', () => {
  assert.ok(MIN_OWN_AGE_SECONDS >= 300 && MIN_OWN_AGE_SECONDS <= 450, String(MIN_OWN_AGE_SECONDS));
});
