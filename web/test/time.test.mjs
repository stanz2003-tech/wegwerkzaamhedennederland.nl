/** Unit tests for web/src/data/time.ts (activity, time windows, Europe/Amsterdam calendar). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { time } from './helpers/src.mjs';

const {
  DEFAULT_TIME_WINDOW, MS, TIME_WINDOWS, ageMinutes, isActiveAt, isTimeWindowId, itemInterval,
  matchesTimeWindow, nextStartAfter, overlapsWindow, startOfDay, timeWindowRange, toMs, wallClockKey,
  zonedParts, zonedToMs,
} = time;

/** Wednesday 9 September 2026, 14:00 Europe/Amsterdam (CEST). */
const WED = Date.parse('2026-09-09T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

describe('toMs / itemInterval', () => {
  it('parses ISO timestamps and reports NaN for missing or invalid input', () => {
    assert.equal(toMs('2026-09-09T12:00:00Z'), WED);
    assert.ok(Number.isNaN(toMs(null)));
    assert.ok(Number.isNaN(toMs(undefined)));
    assert.ok(Number.isNaN(toMs('')));
    assert.ok(Number.isNaN(toMs('geen datum')));
  });

  it('treats a missing end as open ended', () => {
    const open = itemInterval({ start: '2026-09-09T10:00:00Z' });
    assert.equal(open.start, Date.parse('2026-09-09T10:00:00Z'));
    assert.equal(open.end, Number.POSITIVE_INFINITY);
  });

  it('treats an unparsable start as minus infinity', () => {
    assert.equal(itemInterval({ start: 'kapot', end: '2026-09-09T13:00:00Z' }).start, Number.NEGATIVE_INFINITY);
  });
});

describe('isActiveAt', () => {
  const item = { start: '2026-09-09T10:00:00Z', end: '2026-09-09T14:00:00Z' };

  it('is active inside the interval, inclusive on both edges', () => {
    assert.equal(isActiveAt(item, WED), true);
    assert.equal(isActiveAt(item, Date.parse('2026-09-09T10:00:00Z')), true);
    assert.equal(isActiveAt(item, Date.parse('2026-09-09T14:00:00Z')), true);
  });

  it('is not active before the start or after the end', () => {
    assert.equal(isActiveAt(item, Date.parse('2026-09-09T09:59:00Z')), false);
    assert.equal(isActiveAt(item, Date.parse('2026-09-09T14:01:00Z')), false);
  });

  it('stays active forever without an end', () => {
    assert.equal(isActiveAt({ start: '2020-01-01T00:00:00Z' }, WED), true);
  });
});

describe('overlapsWindow / nextStartAfter', () => {
  it('overlaps when the item touches the window', () => {
    const item = { start: '2026-09-20T00:00:00Z', end: '2026-09-21T00:00:00Z' };
    assert.equal(overlapsWindow(item, WED, Date.parse('2026-09-20T00:00:00Z')), true);
    assert.equal(overlapsWindow(item, WED, Date.parse('2026-09-19T23:59:00Z')), false);
  });

  it('returns the start only when it lies in the future', () => {
    assert.equal(nextStartAfter({ start: '2026-09-20T00:00:00Z' }, WED), Date.parse('2026-09-20T00:00:00Z'));
    assert.equal(nextStartAfter({ start: '2026-09-01T00:00:00Z' }, WED), null);
  });
});

describe('Europe/Amsterdam calendar helpers', () => {
  it('reports zoned parts with a Monday-based weekday index', () => {
    assert.deepEqual(zonedParts(WED), { year: 2026, month: 9, day: 9, hour: 14, minute: 0, weekday: 3 });
  });

  it('converts wall-clock time to UTC in both summer and winter time', () => {
    assert.equal(iso(zonedToMs(2026, 7, 1, 12, 0)), '2026-07-01T10:00:00.000Z'); // CEST, UTC+2
    assert.equal(iso(zonedToMs(2026, 1, 1, 12, 0)), '2026-01-01T11:00:00.000Z'); // CET, UTC+1
  });

  it('maps a wall-clock time that does not exist (spring forward) to the next real instant', () => {
    // 2026-03-29 02:00 → 03:00 local: 02:30 does not exist and becomes 03:30 local.
    const ms = zonedToMs(2026, 3, 29, 2, 30);
    assert.equal(iso(ms), '2026-03-29T01:30:00.000Z');
    assert.equal(zonedParts(ms).hour, 3);
  });

  it('startOfDay returns local midnight, not UTC midnight', () => {
    assert.equal(iso(startOfDay(WED)), '2026-09-08T22:00:00.000Z');
    assert.equal(iso(startOfDay(WED, 1)), '2026-09-09T22:00:00.000Z');
    assert.equal(iso(startOfDay(Date.parse('2026-01-15T12:00:00Z'))), '2026-01-14T23:00:00.000Z');
  });

  it('wallClockKey uses local time, so the same UTC hour differs per season', () => {
    assert.equal(wallClockKey(Date.parse('2026-09-12T19:00:00Z')), '21:00');
    assert.equal(wallClockKey(Date.parse('2026-01-12T19:00:00Z')), '20:00');
    assert.equal(wallClockKey(Date.parse('2026-09-12T19:05:00Z')), '21:05');
  });
});

describe('timeWindowRange', () => {
  it('nu is a zero-width window', () => {
    assert.deepEqual(timeWindowRange('nu', WED), { from: WED, to: WED });
  });

  it('vandaag runs until the last millisecond of the local day', () => {
    const { from, to } = timeWindowRange('vandaag', WED);
    assert.equal(from, WED);
    assert.equal(iso(to), '2026-09-09T21:59:59.999Z');
  });

  it('7d and 30d are simple offsets', () => {
    assert.equal(timeWindowRange('7d', WED).to - WED, 7 * MS.day);
    assert.equal(timeWindowRange('30d', WED).to - WED, 30 * MS.day);
  });

  it('weekend looks ahead to Friday 20:00 → Monday 06:00 local on a weekday', () => {
    const { from, to } = timeWindowRange('weekend', WED);
    assert.equal(iso(from), '2026-09-11T18:00:00.000Z'); // Friday 20:00 CEST
    assert.equal(iso(to), '2026-09-14T04:00:00.000Z'); // Monday 06:00 CEST
    assert.equal(to - from, 58 * MS.hour);
  });

  it('weekend clamps `from` to now while the weekend is running', () => {
    const sat = Date.parse('2026-09-12T12:00:00Z');
    const sun = Date.parse('2026-09-13T12:00:00Z');
    const monEarly = Date.parse('2026-09-14T03:00:00Z'); // Monday 05:00 local, still inside
    for (const now of [sat, sun, monEarly]) {
      const { from, to } = timeWindowRange('weekend', now);
      assert.equal(from, now, `from clamped for ${iso(now)}`);
      assert.equal(iso(to), '2026-09-14T04:00:00.000Z');
    }
  });

  it('weekend looks ahead again once Monday 06:00 local has passed', () => {
    const monLate = Date.parse('2026-09-14T05:00:00Z'); // Monday 07:00 local
    assert.equal(iso(timeWindowRange('weekend', monLate).from), '2026-09-18T18:00:00.000Z');
  });

  it('weekend is one hour longer when the clocks go back inside it (DST end)', () => {
    // Last Sunday of October 2026: 03:00 CEST → 02:00 CET.
    const thu = Date.parse('2026-10-22T10:00:00Z');
    const { from, to } = timeWindowRange('weekend', thu);
    assert.equal(iso(from), '2026-10-23T18:00:00.000Z'); // Friday 20:00 CEST
    assert.equal(iso(to), '2026-10-26T05:00:00.000Z'); // Monday 06:00 CET
    assert.equal(to - from, 59 * MS.hour);
  });

  it('weekend keeps the local wall clock across the DST switch', () => {
    const { from, to } = timeWindowRange('weekend', Date.parse('2026-10-22T10:00:00Z'));
    assert.equal(zonedParts(from).hour, 20);
    assert.equal(zonedParts(to).hour, 6);
  });
});

describe('matchesTimeWindow', () => {
  const active = { start: '2026-09-09T10:00:00Z', end: '2026-09-09T18:00:00Z' };
  const laterToday = { start: '2026-09-09T20:00:00Z', end: '2026-09-09T21:30:00Z' };
  const tomorrow = { start: '2026-09-10T06:00:00Z', end: '2026-09-10T15:00:00Z' };
  const nextWeekend = { start: '2026-09-12T08:00:00Z', end: '2026-09-12T16:00:00Z' };
  const farFuture = { start: '2026-11-01T08:00:00Z', end: '2026-11-02T16:00:00Z' };

  it('nu behaves exactly like isActiveAt', () => {
    for (const item of [active, laterToday, tomorrow, farFuture]) {
      assert.equal(matchesTimeWindow(item, 'nu', WED), isActiveAt(item, WED));
    }
  });

  it('vandaag includes what still starts today but not tomorrow', () => {
    assert.equal(matchesTimeWindow(active, 'vandaag', WED), true);
    assert.equal(matchesTimeWindow(laterToday, 'vandaag', WED), true);
    assert.equal(matchesTimeWindow(tomorrow, 'vandaag', WED), false);
  });

  it('weekend only matches items overlapping Friday 20:00 → Monday 06:00', () => {
    assert.equal(matchesTimeWindow(nextWeekend, 'weekend', WED), true);
    assert.equal(matchesTimeWindow(tomorrow, 'weekend', WED), false);
    assert.equal(matchesTimeWindow(active, 'weekend', WED), false);
  });

  it('7d and 30d widen the window', () => {
    assert.equal(matchesTimeWindow(farFuture, '7d', WED), false);
    assert.equal(matchesTimeWindow(farFuture, '30d', WED), false);
    assert.equal(matchesTimeWindow({ start: '2026-09-30T08:00:00Z' }, '30d', WED), true);
    assert.equal(matchesTimeWindow({ start: '2026-09-13T08:00:00Z' }, '7d', WED), true);
  });
});

describe('window ids and data age', () => {
  it('accepts only the five known ids', () => {
    for (const w of TIME_WINDOWS) assert.equal(isTimeWindowId(w.id), true);
    assert.equal(isTimeWindowId('nooit'), false);
    assert.equal(isTimeWindowId(''), false);
    assert.equal(TIME_WINDOWS.length, 6);
    assert.equal(DEFAULT_TIME_WINDOW, 'nu');
  });

  it('ageMinutes measures the distance to `generated`', () => {
    assert.equal(ageMinutes('2026-09-09T11:30:00Z', WED), 30);
    assert.equal(ageMinutes('2026-09-09T12:00:00Z', WED), 0);
    assert.ok(Number.isNaN(ageMinutes('onbekend', WED)));
  });
});

describe('dayWindow / localDateKey / windowFromNow (vooruit-9)', () => {
  const { dayWindow, localDateKey, windowFromNow, isDateKey, isDayPart, DAY_PARTS } = time;

  it('a whole day runs from local midnight to the last millisecond before the next one', () => {
    const w = dayWindow('2026-09-09');
    assert.equal(iso(w.from), '2026-09-08T22:00:00.000Z');
    assert.equal(iso(w.to + 1), '2026-09-09T22:00:00.000Z');
    assert.equal(w.from, startOfDay(WED));
  });

  it('day parts cover the day without gaps or overlap', () => {
    const day = dayWindow('2026-09-09');
    const parts = DAY_PARTS.map((p) => dayWindow('2026-09-09', p.id));
    assert.equal(parts[0].from, day.from);
    assert.equal(parts[3].to, day.to);
    for (let i = 1; i < parts.length; i++) assert.equal(parts[i].from, parts[i - 1].to + 1);
    assert.equal(iso(dayWindow('2026-09-09', 'ochtend').from), '2026-09-09T04:00:00.000Z');
    assert.equal(iso(dayWindow('2026-09-09', 'ochtend').to + 1), '2026-09-09T10:00:00.000Z');
  });

  it('is DST-safe: 25 October 2026 has 25 hours and a 7-hour night', () => {
    const w = dayWindow('2026-10-25');
    assert.equal(iso(w.from), '2026-10-24T22:00:00.000Z');
    assert.equal(iso(w.to + 1), '2026-10-25T23:00:00.000Z');
    assert.equal(w.to + 1 - w.from, 25 * MS.hour);
    const nacht = dayWindow('2026-10-25', 'nacht');
    assert.equal(nacht.to + 1 - nacht.from, 7 * MS.hour);
    assert.equal(iso(dayWindow('2026-10-25', 'avond').from), '2026-10-25T17:00:00.000Z');
    // And the spring day has 23.
    const spring = dayWindow('2026-03-29');
    assert.equal(spring.to + 1 - spring.from, 23 * MS.hour);
  });

  it('rejects malformed and impossible dates', () => {
    assert.equal(dayWindow('2026-02-30'), null);
    assert.equal(dayWindow('9-9-2026'), null);
    assert.equal(isDateKey('2026-09-09'), true);
    assert.equal(isDateKey('2026-13-01'), false);
    assert.equal(isDayPart('middag'), true);
    assert.equal(isDayPart('lunch'), false);
  });

  it('localDateKey is the Amsterdam calendar date', () => {
    assert.equal(localDateKey(WED), '2026-09-09');
    assert.equal(localDateKey(Date.parse('2026-09-09T22:30:00Z')), '2026-09-10');
  });

  it('windowFromNow clamps today and keeps future windows whole', () => {
    const today = dayWindow('2026-09-09');
    assert.deepEqual(windowFromNow(today, WED), { from: WED, to: today.to });
    const later = dayWindow('2026-09-12');
    assert.deepEqual(windowFromNow(later, WED), later);
    const past = dayWindow('2026-09-01');
    assert.deepEqual(windowFromNow(past, WED), { from: past.to, to: past.to });
  });
});
