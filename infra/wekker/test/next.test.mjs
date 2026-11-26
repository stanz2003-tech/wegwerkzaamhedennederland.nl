/**
 * Tests for the wekker's decision after its wait (infra/wekker/next.mjs), with the shape of the
 * night the chain died: 27 September 2026, 18:13–18:21 UTC.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, MIN_OWN_AGE_SECONDS, STALE_RUN_MINUTES } from '../next.mjs';

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

test('a ghost run stuck in "queued" for hours does not block the chain (25–26 November)', () => {
  // GitHub accepted a dispatch at 2026-11-25 16:11 UTC and never gave it a job; the run sat in
  // "queued" for more than a day. Every wekker read it as busy and only set itself again, so the
  // data was refreshed by the rare scheduled runs alone (four in 25 hours).
  const now = Date.parse('2026-11-26T17:35:00Z');
  const d = decide({
    nowMs: now,
    selfCreatedAt: '2026-11-26T17:27:00Z',
    dataRuns: [done('2026-11-26T12:12:52Z'), { status: 'queued', createdAt: '2026-11-25T16:11:24Z' }],
  });
  assert.equal(d.action, 'dispatch-data');
  assert.match(d.reason, /vastgelopen/);
});

test('a run that is only minutes old still counts as busy', () => {
  const now = Date.parse('2026-11-26T17:35:00Z');
  const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();
  for (const m of [1, 20, STALE_RUN_MINUTES - 1]) {
    const d = decide({ nowMs: now, selfCreatedAt: minutesAgo(8), dataRuns: [{ status: 'in_progress', createdAt: minutesAgo(m) }] });
    assert.equal(d.action, 'rearm', `${m} min`);
  }
});

test('the stale limit sits well above the longest real data run (preflight 2 + job 15 + wekker step 4 min)', () => {
  assert.ok(STALE_RUN_MINUTES >= 30 && STALE_RUN_MINUTES <= 90, String(STALE_RUN_MINUTES));
});

test('an unreadable own age or run list never kills the chain', () => {
  assert.equal(decide({ nowMs: AFTER_TIMER, selfCreatedAt: '', dataRuns: [] }).action, 'dispatch-data');
  assert.equal(decide({ nowMs: AFTER_TIMER, selfCreatedAt: WEKKER_CREATED, dataRuns: null }).action, 'dispatch-data');
});

test('the own-age floor stays below the eight-minute wait and well above a run without one', () => {
  assert.ok(MIN_OWN_AGE_SECONDS >= 300 && MIN_OWN_AGE_SECONDS <= 450, String(MIN_OWN_AGE_SECONDS));
});
