import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENDED_GRACE_MS, MAX_PERIODS, openingsWithin, toMinuteIso, toMs, UPCOMING_DAYS, upcomingPeriods, windowState } from '../src/time.js';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

test('toMs / toMinuteIso', () => {
  assert.equal(toMs('2026-09-10T12:00:00Z'), NOW);
  assert.equal(toMs(undefined), undefined);
  assert.equal(toMs('niet een datum'), undefined);
  assert.equal(toMinuteIso('2026-09-10T12:34:56.789Z'), '2026-09-10T12:34:00Z');
  assert.equal(toMinuteIso(NOW), '2026-09-10T12:00:00Z');
  assert.equal(toMinuteIso('2026-09-10T14:34:56+02:00'), '2026-09-10T12:34:00Z');
  assert.equal(toMinuteIso(undefined), undefined);
  assert.equal(toMinuteIso('rommel'), undefined);
});

test('overall window: active, upcoming, ended, future, invalid', () => {
  assert.equal(windowState({ start: iso(NOW - DAY), end: iso(NOW + DAY) }, NOW), 'active');
  assert.equal(windowState({ start: iso(NOW - DAY) }, NOW), 'active', 'open ended is active');
  assert.equal(windowState({ end: iso(NOW + DAY) }, NOW), 'active', 'missing start is active');
  assert.equal(windowState({ start: iso(NOW + 3 * DAY), end: iso(NOW + 4 * DAY) }, NOW), 'upcoming');
  assert.equal(windowState({ start: iso(NOW - 5 * DAY), end: iso(NOW - 2 * DAY) }, NOW), 'ended');
  assert.equal(windowState({ start: iso(NOW - 5 * DAY), end: iso(NOW - 2 * HOUR) }, NOW), 'ended');
  assert.equal(windowState({ start: iso(NOW - 5 * DAY), end: iso(NOW - 30 * 60 * 1000) }, NOW), 'active', 'inside the 1 h grace');
  assert.equal(windowState({ start: iso(NOW + (UPCOMING_DAYS + 1) * DAY) }, NOW), 'future');
  assert.equal(windowState({ start: iso(NOW + UPCOMING_DAYS * DAY - HOUR) }, NOW), 'upcoming', 'just inside 30 days');
  assert.equal(windowState({}, NOW), 'invalid');
  assert.equal(windowState({ start: 'rommel' }, NOW), 'invalid');
});

test('validPeriods decide activity inside the overall window', () => {
  const nightly = {
    start: iso(NOW - 2 * DAY),
    end: iso(NOW + 5 * DAY),
    periods: [
      [iso(NOW - 2 * DAY + 8 * HOUR), iso(NOW - 2 * DAY + 17 * HOUR)],
      [iso(NOW + DAY), iso(NOW + DAY + 9 * HOUR)],
      [iso(NOW + 3 * DAY), iso(NOW + 3 * DAY + 9 * HOUR)],
    ],
  };
  // inside the overall window but between two periods → not active, comes back later
  assert.equal(windowState(nightly, NOW), 'upcoming');
  // during a nightly period → active
  assert.equal(windowState(nightly, Date.parse(nightly.periods[1][0]) + HOUR), 'active');
  // the overall window says active, but the last period ended long ago
  const done = { start: iso(NOW - 10 * DAY), end: iso(NOW + 5 * DAY), periods: [[iso(NOW - 9 * DAY), iso(NOW - 8 * DAY)]] };
  assert.equal(windowState(done, NOW), 'ended');
  // an open-ended period keeps the item alive
  const open = { start: iso(NOW - DAY), end: iso(NOW + DAY), periods: [[iso(NOW - HOUR), undefined]] };
  assert.equal(windowState(open, NOW), 'active');
  // unparseable period entries are ignored, the overall window decides
  assert.equal(windowState({ start: iso(NOW - HOUR), end: iso(NOW + HOUR), periods: [['x', 'y']] }, NOW), 'active');
});

test('nightly recurring work far ahead is future, not upcoming', () => {
  const s = {
    start: iso(NOW + 40 * DAY),
    end: iso(NOW + 60 * DAY),
    periods: [[iso(NOW + 40 * DAY), iso(NOW + 40 * DAY + 8 * HOUR)]],
  };
  assert.equal(windowState(s, NOW), 'future');
});

test('upcomingPeriods: past periods dropped, sorted, minute precision, capped', () => {
  const periods = [
    [iso(NOW + 2 * DAY), iso(NOW + 2 * DAY + HOUR)],
    [iso(NOW - 5 * DAY), iso(NOW - 5 * DAY + HOUR)],
    [iso(NOW + DAY), iso(NOW + DAY + HOUR)],
  ];
  const out = upcomingPeriods(periods, NOW);
  assert.deepEqual(out, [
    [toMinuteIso(iso(NOW + DAY)), toMinuteIso(iso(NOW + DAY + HOUR))],
    [toMinuteIso(iso(NOW + 2 * DAY)), toMinuteIso(iso(NOW + 2 * DAY + HOUR))],
  ]);
  assert.equal(upcomingPeriods(undefined, NOW), undefined);
  assert.equal(upcomingPeriods([], NOW), undefined);
  assert.equal(upcomingPeriods([[iso(NOW - 5 * DAY), iso(NOW - 5 * DAY + HOUR)]], NOW), undefined);
  // a period that ended inside the grace window is still reported
  assert.equal(upcomingPeriods([[iso(NOW - HOUR), iso(NOW - 30 * 60 * 1000)]], NOW)?.length, 1);
  // open ended period → empty end string
  assert.deepEqual(upcomingPeriods([[iso(NOW + HOUR), undefined]], NOW), [[toMinuteIso(iso(NOW + HOUR)), '']]);
  const many = Array.from({ length: MAX_PERIODS + 20 }, (_, i) => [iso(NOW + i * DAY), iso(NOW + i * DAY + HOUR)]);
  assert.equal(upcomingPeriods(many, NOW)?.length, MAX_PERIODS);
});

test('openingsWithin: window, sorting, de-duplication and the cap', () => {
  const openings = [
    { start: iso(NOW + 2 * HOUR), end: iso(NOW + 2 * HOUR + 600000) },
    { start: iso(NOW - 5 * DAY), end: iso(NOW - 5 * DAY + 600000) }, // over
    { start: iso(NOW + 20 * DAY) }, // beyond 7 days
    { start: iso(NOW + HOUR), end: iso(NOW + HOUR + 600000) },
    { start: iso(NOW + HOUR), end: iso(NOW + HOUR + 600000) }, // duplicate
    { start: undefined, end: iso(NOW) }, // unusable
  ];
  const out = openingsWithin(openings, NOW, 7, 50);
  assert.deepEqual(out, [
    [toMinuteIso(iso(NOW + HOUR)), toMinuteIso(iso(NOW + HOUR + 600000))],
    [toMinuteIso(iso(NOW + 2 * HOUR)), toMinuteIso(iso(NOW + 2 * HOUR + 600000))],
  ]);
  // an opening without an end gets the default 10 minutes
  assert.deepEqual(openingsWithin([{ start: iso(NOW + HOUR) }], NOW, 7, 50), [
    [toMinuteIso(iso(NOW + HOUR)), toMinuteIso(iso(NOW + HOUR + 600000))],
  ]);
  assert.equal(openingsWithin(Array.from({ length: 80 }, (_, i) => ({ start: iso(NOW + i * HOUR) })), NOW, 7, 50).length, 50);
  assert.deepEqual(openingsWithin([], NOW, 7, 50), []);
});

test('the grace period is one hour and the upcoming horizon 30 days', () => {
  assert.equal(ENDED_GRACE_MS, HOUR);
  assert.equal(UPCOMING_DAYS, 30);
});

test('an item whose end just passed stays active during the grace window', () => {
  // publishers are often late closing a measure; it must not reappear as "planned"
  assert.equal(windowState({ start: iso(NOW - DAY), end: iso(NOW - 10 * 60 * 1000) }, NOW), 'active');
  const nightlyDone = { start: iso(NOW - 2 * DAY), end: iso(NOW + DAY), periods: [[iso(NOW - 9 * HOUR), iso(NOW - 30 * 60 * 1000)]] };
  assert.equal(windowState(nightlyDone, NOW), 'active');
  // one minute past the grace window it is gone
  assert.equal(windowState({ start: iso(NOW - DAY), end: iso(NOW - HOUR - 60000) }, NOW), 'ended');
});
