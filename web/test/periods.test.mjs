/** Unit tests for web/src/data/periods.ts (recurring sub-period detection and summaries). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { periods as mod } from './helpers/src.mjs';

const { formatWeekdaySet, parsePeriods, summarizePeriods } = mod;

/** Sunday 6 September 2026, 14:00 local — before every fixture period below. */
const BEFORE = Date.parse('2026-09-06T12:00:00Z');

/** `count` nights 21:00 → 05:00 local (CEST), starting on 7 September 2026 (a Monday). */
function nights(count, firstDay = 7) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const day = firstDay + i;
    const pad = (n) => String(n).padStart(2, '0');
    out.push([`2026-09-${pad(day)}T19:00:00Z`, `2026-09-${pad(day + 1)}T03:00:00Z`]);
  }
  return out;
}

describe('parsePeriods', () => {
  it('parses, sorts and keeps only usable pairs', () => {
    const parsed = parsePeriods([
      ['2026-09-10T06:00:00Z', '2026-09-10T14:00:00Z'],
      ['2026-09-08T06:00:00Z', '2026-09-08T14:00:00Z'],
    ]);
    assert.equal(parsed.length, 2);
    assert.equal(new Date(parsed[0].start).toISOString(), '2026-09-08T06:00:00.000Z');
    assert.ok(parsed[0].start < parsed[1].start);
  });

  it('drops invalid pairs and pairs that end before they start', () => {
    assert.deepEqual(parsePeriods(undefined), []);
    assert.deepEqual(parsePeriods([]), []);
    assert.equal(parsePeriods([['kapot', '2026-09-08T14:00:00Z']]).length, 0);
    assert.equal(parsePeriods([['2026-09-08T14:00:00Z', '2026-09-08T06:00:00Z']]).length, 0);
  });

  it('accepts a zero-length period', () => {
    assert.equal(parsePeriods([['2026-09-08T06:00:00Z', '2026-09-08T06:00:00Z']]).length, 1);
  });
});

describe('formatWeekdaySet', () => {
  it('collapses three or more contiguous days into a range', () => {
    assert.equal(formatWeekdaySet(new Set([1, 2, 3, 4, 5])), 'ma–vr');
    assert.equal(formatWeekdaySet(new Set([1, 2, 3])), 'ma–wo');
    assert.equal(formatWeekdaySet(new Set([5, 6, 0])), 'vr–zo');
  });

  it('lists two days or non-contiguous days', () => {
    assert.equal(formatWeekdaySet(new Set([1, 2])), 'ma, di');
    assert.equal(formatWeekdaySet(new Set([6, 0])), 'za, zo');
    assert.equal(formatWeekdaySet(new Set([1, 3, 5])), 'ma, wo, vr');
  });

  it('says "dagelijks" for all seven days and nothing for an empty set', () => {
    assert.equal(formatWeekdaySet(new Set([0, 1, 2, 3, 4, 5, 6])), 'dagelijks');
    assert.equal(formatWeekdaySet(new Set()), '');
  });
});

describe('summarizePeriods', () => {
  it('reports "none" without periods', () => {
    assert.deepEqual(summarizePeriods(undefined, BEFORE), { kind: 'none' });
    assert.deepEqual(summarizePeriods([], BEFORE), { kind: 'none' });
  });

  it('detects a nightly pattern and summarises it in local wall-clock time', () => {
    const summary = summarizePeriods(nights(5), BEFORE);
    assert.equal(summary.kind, 'pattern');
    assert.equal(summary.from, '21:00');
    assert.equal(summary.to, '05:00');
    assert.equal(summary.days, 'ma–vr');
    assert.equal(summary.count, 5);
    assert.equal(new Date(summary.first).toISOString(), '2026-09-07T19:00:00.000Z');
    assert.equal(new Date(summary.last).toISOString(), '2026-09-12T03:00:00.000Z');
  });

  it('says "dagelijks" once every weekday occurs', () => {
    assert.equal(summarizePeriods(nights(10), BEFORE).days, 'dagelijks');
  });

  it('needs at least three periods before it calls something a pattern', () => {
    assert.equal(summarizePeriods(nights(2), BEFORE).kind, 'list');
    assert.equal(summarizePeriods(nights(3), BEFORE).kind, 'pattern');
  });

  it('does not call differing wall-clock times a pattern', () => {
    const mixed = [...nights(2), ['2026-09-09T20:30:00Z', '2026-09-10T03:00:00Z']];
    assert.equal(summarizePeriods(mixed, BEFORE).kind, 'list');
  });

  it('does not call periods longer than a day a pattern', () => {
    const long = [
      ['2026-09-07T19:00:00Z', '2026-09-09T19:00:00Z'],
      ['2026-09-14T19:00:00Z', '2026-09-16T19:00:00Z'],
      ['2026-09-21T19:00:00Z', '2026-09-23T19:00:00Z'],
    ];
    assert.equal(summarizePeriods(long, BEFORE).kind, 'list');
  });

  it('lists at most maxList upcoming periods and counts the rest', () => {
    const summary = summarizePeriods(
      [
        ['2026-09-07T06:00:00Z', '2026-09-07T14:00:00Z'],
        ['2026-09-09T07:00:00Z', '2026-09-09T15:00:00Z'],
        ['2026-09-11T08:00:00Z', '2026-09-11T18:00:00Z'],
      ],
      BEFORE,
      2,
    );
    assert.equal(summary.kind, 'list');
    assert.equal(summary.items.length, 2);
    assert.equal(summary.more, 1);
  });

  it('ignores periods that already ended when newer ones exist', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    const summary = summarizePeriods(nights(5), now);
    assert.equal(summary.kind, 'list');
    assert.ok(summary.items.every((p) => p.end >= now));
  });

  it('falls back to all periods when every period is in the past', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    const summary = summarizePeriods(nights(5), now);
    assert.equal(summary.kind, 'pattern');
    assert.equal(summary.count, 5);
  });
});
