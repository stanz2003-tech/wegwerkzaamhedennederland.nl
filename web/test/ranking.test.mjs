/**
 * Regression tests for the readable-duration wording, the impact ranking that demotes
 * semi-permanent measures, the neutral badge for roads without a number, and the window
 * split used by /vandaag/ and /dit-weekend/.
 *
 * Needs one extra line in test/helpers/src.mjs:
 *   export const badge = await load('ui/badge.ts');
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { badge, filter, format, time } from './helpers/src.mjs';

const { durationLabel, statusLine, windowSummary } = format;
const { MS, isLongRunning, measureLengthMs, msToNearestChange, timeWindowBounds, timeWindowRange, windowRelevance } = time;
const { changeBonus, compareByImpact, groupByWindow, impactScore, longRunPenalty, sortItems } = filter;

const NOW = Date.parse('2026-09-09T12:00:00Z'); // Wednesday 14:00 local

describe('measure length', () => {
  it('uses end - start when the end is known', () => {
    assert.equal(measureLengthMs({ start: '2026-09-09T06:00:00Z', end: '2026-09-09T18:00:00Z' }, NOW), 12 * MS.hour);
  });

  it('falls back to how long an open-ended item has been running', () => {
    assert.equal(measureLengthMs({ start: '2026-09-09T11:00:00Z' }, NOW), MS.hour);
    assert.equal(measureLengthMs({ start: '2026-09-20T11:00:00Z' }, NOW), 0);
  });

  it('calls a measure long-running from 90 days on', () => {
    assert.equal(isLongRunning({ start: '2026-06-01T12:00:00Z', end: '2026-09-10T12:00:00Z' }, NOW), true);
    assert.equal(isLongRunning({ start: '2026-08-12T12:00:00Z', end: '2026-09-30T12:00:00Z' }, NOW), false);
    assert.equal(isLongRunning({ start: '2024-01-01T00:00:00Z' }, NOW), true, 'open ended since 2024');
    assert.equal(isLongRunning({ start: '2026-09-09T11:40:00Z' }, NOW), false, 'a traffic jam is not long-running');
  });

  it('measures the distance to the nearest change', () => {
    assert.equal(msToNearestChange({ start: '2026-09-09T06:00:00Z', end: '2026-09-09T13:00:00Z' }, NOW), MS.hour);
    assert.equal(msToNearestChange({ start: '2026-09-10T12:00:00Z' }, NOW), MS.day);
    assert.equal(msToNearestChange({ start: '2019-01-01T00:00:00Z' }, NOW) > 1000 * MS.day, true);
  });
});

describe('statusLine wording', () => {
  it('keeps a precise duration for what ends within a week', () => {
    assert.deepEqual(statusLine({ start: '2026-09-09T06:00:00Z', end: '2026-09-09T14:15:00Z' }, NOW), {
      kind: 'active',
      text: 'Nu actief · nog 2 u 15 min',
    });
    assert.equal(
      statusLine({ start: '2026-09-08T06:00:00Z', end: '2026-09-12T06:00:00Z' }, NOW).text,
      'Nu actief · nog 3 dagen',
    );
  });

  it('switches to a date beyond a week', () => {
    assert.deepEqual(statusLine({ start: '2026-09-04T06:00:00Z', end: '2026-09-25T15:00:00Z' }, NOW), {
      kind: 'active',
      text: 'Nu actief · tot en met vr 25 sep',
    });
  });

  it('calls a measure of more than 90 days long-running and prints its end date', () => {
    assert.deepEqual(statusLine({ start: '2021-03-01T00:00:00Z', end: '2031-05-31T22:00:00Z' }, NOW), {
      kind: 'active',
      text: 'Langdurige maatregel · tot 1 juni 2031',
    });
    assert.equal(
      statusLine({ start: '2024-01-01T00:00:00Z' }, NOW).text,
      'Langdurige maatregel · einddatum onbekend',
      'no end date at all',
    );
  });

  it('leaves a fresh open-ended item alone', () => {
    assert.deepEqual(statusLine({ start: '2026-09-09T06:00:00Z' }, NOW), {
      kind: 'active',
      text: 'Nu actief · einde nog onbekend',
    });
  });

  it('marks a planned long-running measure in the Start line', () => {
    assert.equal(statusLine({ start: '2026-09-12T20:00:00Z' }, NOW).text, 'Start za 12 sep 22:00');
    assert.equal(
      statusLine({ start: '2026-09-12T20:00:00Z', end: '2027-12-31T22:00:00Z' }, NOW).text,
      'Start za 12 sep 22:00 · langdurige maatregel',
    );
  });

  it('adds the year to a timestamp outside the current year', () => {
    assert.equal(format.fmtDayTimeYear(Date.parse('2026-09-12T20:00:00Z'), NOW), 'za 12 sep 22:00');
    assert.equal(format.fmtDayTimeYear(Date.parse('2028-05-31T14:00:00Z'), NOW), '31 mei 2028 16:00');
    assert.equal(format.fmtDayTimeYear(Number.POSITIVE_INFINITY, NOW), '–');
  });

  it('gives the detail timeline the same words as the list line', () => {
    assert.equal(durationLabel({ start: '2026-09-09T06:00:00Z', end: '2026-09-09T18:00:00Z' }, NOW), '12 u');
    assert.equal(durationLabel({ start: '2021-03-01T00:00:00Z', end: '2031-05-31T22:00:00Z' }, NOW), 'langdurige maatregel');
    assert.equal(durationLabel({ start: '2026-09-09T06:00:00Z' }, NOW), 'einddatum onbekend');
  });
});

describe('impact ranking', () => {
  const feature = (props) => ({
    type: 'Feature',
    id: props.id,
    geometry: { type: 'Point', coordinates: [5, 52] },
    properties: { cat: 'werk', sev: 2, title: props.id, src: 'x', start: '2026-09-09T06:00:00Z', ...props },
  });

  it('penalises measures that have been standing for a month or more', () => {
    assert.equal(longRunPenalty({ start: '2026-09-09T06:00:00Z', end: '2026-09-10T06:00:00Z' }, NOW), 0);
    assert.equal(longRunPenalty({ start: '2026-08-01T06:00:00Z', end: '2026-10-01T06:00:00Z' }, NOW), 120);
    assert.equal(longRunPenalty({ start: '2021-01-01T06:00:00Z', end: '2031-01-01T06:00:00Z' }, NOW), 250);
  });

  it('rewards items that start or end soon', () => {
    assert.equal(changeBonus({ start: '2026-09-09T20:00:00Z' }, NOW), 20);
    assert.equal(changeBonus({ start: '2026-09-13T20:00:00Z' }, NOW), 10);
    assert.equal(changeBonus({ start: '2026-10-13T20:00:00Z' }, NOW), 0);
  });

  it('ranks a closure that starts tonight above a years-old width restriction', () => {
    const semiPermanent = feature({
      id: 'breedtebeperking',
      cat: 'afsluiting',
      sev: 4,
      start: '2019-06-01T00:00:00Z',
      end: '2031-05-31T22:00:00Z',
    });
    const tonight = feature({
      id: 'vannacht',
      cat: 'afsluiting',
      sev: 2,
      start: '2026-09-09T20:00:00Z',
      end: '2026-09-10T04:00:00Z',
    });
    assert.equal(impactScore(semiPermanent.properties, NOW), 4 * 100 - 250);
    assert.equal(impactScore(tonight.properties, NOW), 2 * 100 + 20);
    assert.ok(compareByImpact(tonight.properties, semiPermanent.properties, NOW) < 0);
    assert.deepEqual(sortItems([semiPermanent, tonight], 'impact', null, NOW).map((f) => f.properties.id), [
      'vannacht',
      'breedtebeperking',
    ]);
  });

  it('still puts the most severe short measure first', () => {
    const heavy = feature({ id: 'zwaar', cat: 'afsluiting', sev: 4, end: '2026-09-09T20:00:00Z' });
    const light = feature({ id: 'licht', sev: 1, end: '2026-09-09T20:00:00Z' });
    assert.deepEqual(sortItems([light, heavy], 'impact', null, NOW).map((f) => f.properties.id), ['zwaar', 'licht']);
  });

  it('keeps the explicit sort orders untouched', () => {
    const early = feature({ id: 'vroeg', sev: 1, end: '2026-09-09T20:00:00Z' });
    const late = feature({ id: 'laat', sev: 4, start: '2026-09-20T06:00:00Z', end: '2026-09-21T20:00:00Z' });
    assert.deepEqual(sortItems([late, early], 'start', null, NOW).map((f) => f.properties.id), ['vroeg', 'laat']);
  });

  it('defaults `now` to the current time so existing callers keep working', () => {
    assert.equal(sortItems([feature({ id: 'a' })], 'impact', null).length, 1);
  });
});

describe('window semantics for /vandaag/ and /dit-weekend/', () => {
  const SAT = Date.parse('2026-09-12T12:00:00Z'); // Saturday 14:00 local, inside the weekend

  it('gives the calendar bounds of the weekend, unclamped', () => {
    assert.equal(new Date(timeWindowBounds('weekend', SAT).from).toISOString(), '2026-09-11T18:00:00.000Z');
    assert.equal(timeWindowRange('weekend', SAT).from, SAT, 'the clamped range still starts at now');
  });

  it('separates what changes in the window from what merely overlaps it', () => {
    const { from, to } = timeWindowBounds('weekend', SAT);
    const weekendClosure = { start: '2026-09-11T20:00:00Z', end: '2026-09-13T04:00:00Z' };
    const semiPermanent = { start: '2019-06-01T00:00:00Z', end: '2031-05-31T22:00:00Z' };
    const nextTuesday = { start: '2026-09-15T06:00:00Z', end: '2026-09-15T16:00:00Z' };
    assert.equal(windowRelevance(weekendClosure, from, to), 'changes');
    assert.equal(windowRelevance(semiPermanent, from, to), 'background');
    assert.equal(windowRelevance(nextTuesday, from, to), 'outside');
  });

  it('counts a recurring sub-period inside the window as a change', () => {
    const { from, to } = timeWindowBounds('weekend', SAT);
    const nightly = { start: '2026-01-01T00:00:00Z', end: '2027-01-01T00:00:00Z' };
    assert.equal(windowRelevance(nightly, from, to), 'background');
    assert.equal(
      windowRelevance(nightly, from, to, { periods: [['2026-09-12T20:00:00Z', '2026-09-13T04:00:00Z']] }),
      'changes',
    );
  });

  it('groups a list so the page can report truthful numbers', () => {
    const items = [
      { id: 'weekend', start: '2026-09-11T20:00:00Z', end: '2026-09-13T04:00:00Z' },
      { id: 'permanent', start: '2019-06-01T00:00:00Z', end: '2031-05-31T22:00:00Z' },
      { id: 'volgende-week', start: '2026-09-15T06:00:00Z', end: '2026-09-15T16:00:00Z' },
    ];
    const groups = groupByWindow(items, 'weekend', SAT);
    assert.deepEqual(groups.changes.map((i) => i.id), ['weekend']);
    assert.deepEqual(groups.background.map((i) => i.id), ['permanent']);
  });

  it('explains the numbers in Dutch', () => {
    assert.equal(
      windowSummary({ changes: 34, active: 12, background: 4729 }, 'dit weekend'),
      '34 meldingen dit weekend · 12 nu al actief · 4.729 langdurige maatregelen lopen al langer',
    );
    assert.equal(
      windowSummary({ changes: 0, active: 0, background: 0 }, 'dit weekend'),
      'Er is nog niets aangemeld voor dit weekend',
    );
  });
});

describe('badge without a road number', () => {
  it('never derives an initial from the place name', () => {
    assert.equal(badge.badgeText('A2'), 'A2');
    assert.equal(badge.badgeText(null), '');
    const html = badge.roadBadge(null, 'lokaal', { place: 'Harlingen' });
    assert.match(html, /badge--lokaal/);
    assert.match(html, /badge--glyph/);
    assert.match(html, /<svg/);
    assert.doesNotMatch(html, />H</);
    assert.match(html, /aria-label="Lokale weg in Harlingen"/);
  });

  it('keeps the real road badges exactly as they were', () => {
    assert.equal(badge.badgeKind('A2', 'A'), 'a');
    assert.equal(badge.badgeKind('N57', 'N'), 'n');
    const a = badge.roadBadge('A2', 'A', {});
    assert.match(a, /badge--a/);
    assert.doesNotMatch(a, /badge--glyph/);
    assert.match(a, />A2</);
    assert.equal(badge.badgeLabel('A2'), 'Weg A2');
  });
});
