/**
 * Contract v4 in the web layer: reading `ItemDetail.tl` / `tlTo` (data/timeline.ts) and answering
 * a moment or a window from it (verdict.ts, forecast.ts).
 *
 * The cases are the wrong answers the audit of 2026-09-19 found while "looking ahead": a phase
 * that only closes the cycle path shown as "dicht voor iedereen", an event closed only on the
 * Sunday shown as closed from Thursday on, a day pill that contradicted the list under it, and
 * "Geen hinder" at a moment past the end of what the data knew.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forecast, format, periods as periodsMod, timeline, verdict } from './helpers/src.mjs';

const { parseTimeline, segmentAt, segmentsIn, heavier, periodsFromTimeline } = timeline;
const { verdictFor } = verdict;
const { dayStrip, selectInWindow, selectAtMoment } = forecast;

const ms = (iso) => Date.parse(iso);

// The Paul Krugerkade as the pipeline publishes it on 2026-09-23.
const KRUGERKADE_TL = [
  ['2026-09-22T22:00:00Z', '2026-10-16T05:00:00Z', 'dicht', ['car']],
  ['2026-10-16T05:00:00Z', '2026-10-19T15:00:00Z', 'dicht', ['car', 'bicycle']],
  ['2026-10-19T15:00:00Z', '2026-10-29T16:00:00Z', 'dicht', ['bicycle']],
];
const KRUGERKADE = { cat: 'afsluiting', imp: 'dicht', veh: ['car', 'bicycle'], per: true };

describe('parseTimeline', () => {
  it('reads valid rows, sorts them, and treats an empty end as open', () => {
    const segs = parseTimeline([
      ['2026-09-27T04:00:00Z', '2026-09-27T19:00:00Z', 'dicht'],
      ['2026-09-26T06:00:00Z', '', 'hinder', ['lorry']],
    ]);
    assert.equal(segs.length, 2);
    assert.equal(segs[0].imp, 'hinder');
    assert.equal(segs[0].end, Number.POSITIVE_INFINITY);
    assert.deepEqual(segs[0].veh, ['lorry']);
    assert.equal(segs[1].veh, null, 'no vehicle list = all traffic');
  });

  it('skips malformed rows instead of failing the whole item', () => {
    // One bad publisher row must not take the verdict of a whole shard down with it.
    const segs = parseTimeline([
      ['2026-09-27T04:00:00Z', '2026-09-27T19:00:00Z', 'dicht'],
      ['gisteren', '2026-09-27T19:00:00Z', 'dicht'],
      ['2026-09-27T19:00:00Z', '2026-09-27T04:00:00Z', 'dicht'], // end before start
      ['2026-09-28T04:00:00Z', '2026-09-28T19:00:00Z', 'kapot'],
      'geen rij',
      ['2026-09-29T04:00:00Z', '2026-09-29T19:00:00Z', 'hinder', ['auto', 'car']], // unknown vehicle dropped
    ]);
    assert.equal(segs.length, 2);
    assert.deepEqual(segs[1].veh, ['car']);
    assert.deepEqual(parseTimeline(undefined), []);
    assert.deepEqual(parseTimeline({ not: 'an array' }), []);
  });

  it('segmentAt: start inclusive, end exclusive, null in a gap', () => {
    const segs = parseTimeline([
      ['2026-09-26T06:00:00Z', '2026-09-26T15:00:00Z', 'hinder'],
      ['2026-09-27T04:00:00Z', '2026-09-27T19:00:00Z', 'dicht'],
    ]);
    assert.equal(segmentAt(segs, ms('2026-09-26T06:00:00Z'))?.imp, 'hinder');
    assert.equal(segmentAt(segs, ms('2026-09-26T15:00:00Z')), null);
    assert.equal(segmentAt(segs, ms('2026-09-27T12:00:00Z'))?.imp, 'dicht');
    assert.equal(segmentsIn(segs, ms('2026-09-25T00:00:00Z'), ms('2026-09-26T23:59:00Z')).length, 1);
  });

  it('heavier: the stronger level wins, and on a tie the one for all traffic', () => {
    const [a, b] = parseTimeline([
      ['2026-09-26T00:00:00Z', '2026-09-27T00:00:00Z', 'dicht', ['bicycle']],
      ['2026-09-27T00:00:00Z', '2026-09-28T00:00:00Z', 'dicht'],
    ]);
    assert.equal(heavier(a, b), b);
  });

  it('periodsFromTimeline merges touching stretches and keeps an open end as an empty end', () => {
    // Leaving the open end out made the item look inactive in its last block, the one that runs on.
    const segs = parseTimeline([
      ['2026-09-26T06:00:00Z', '2026-09-26T15:00:00Z', 'hinder'],
      ['2026-09-26T15:00:00Z', '2026-09-26T19:00:00Z', 'dicht'],
      ['2026-09-27T04:00:00Z', '', 'dicht'],
    ]);
    assert.deepEqual(periodsFromTimeline(segs), [
      ['2026-09-26T06:00:00.000Z', '2026-09-26T19:00:00.000Z'],
      ['2026-09-27T04:00:00.000Z', ''],
    ]);
  });
});

describe('verdict from the timeline', () => {
  it('a phase that only closes the cycle path does not concern a car driver (Paul Krugerkade)', () => {
    const at = ms('2026-10-20T14:00:00Z');
    assert.equal(verdictFor(KRUGERKADE, 'auto', { tl: KRUGERKADE_TL, now: at }).level, 'nvt');
    assert.equal(verdictFor(KRUGERKADE, 'fiets', { tl: KRUGERKADE_TL, now: at }).level, 'dicht');
    // Earlier in the works the road is closed for cars.
    assert.equal(verdictFor(KRUGERKADE, 'auto', { tl: KRUGERKADE_TL, now: ms('2026-10-01T10:00:00Z') }).level, 'dicht');
    // Without a moment the heaviest phase still speaks for the whole measure (the map colour).
    assert.equal(verdictFor(KRUGERKADE, 'auto', { tl: KRUGERKADE_TL }).level, 'dicht');
  });

  it('an event closed only on the Sunday is not closed on the Thursday (Tilburg)', () => {
    const item = { cat: 'evenement', imp: 'dicht', per: true };
    const tl = [
      ['2026-09-26T06:00:00Z', '2026-09-26T15:00:00Z', 'hinder'],
      ['2026-09-27T04:00:00Z', '2026-09-27T19:00:00Z', 'dicht'],
    ];
    const thursday = verdictFor(item, 'auto', { tl, now: ms('2026-09-24T10:00:00Z') });
    assert.equal(thursday.level, 'geen');
    assert.match(thursday.detail, /buiten werktijden/);
    assert.equal(verdictFor(item, 'auto', { tl, now: ms('2026-09-26T10:00:00Z') }).level, 'hinder');
    assert.equal(verdictFor(item, 'auto', { tl, now: ms('2026-09-27T10:00:00Z') }).level, 'dicht');
  });

  it('a moment past tlTo is "nog niet bekend", never "geen hinder"', () => {
    const item = { cat: 'werk', imp: 'dicht', per: true };
    const periods = [['2026-09-24T05:00:00Z', '2026-09-24T14:00:00Z']];
    const v = verdictFor(item, 'auto', { periods, tlTo: '2026-10-23T22:00:00Z', now: ms('2026-11-09T01:00:00Z') });
    assert.equal(v.level, 'onbekend');
    assert.equal(v.label, verdict.BEYOND_TIMELINE_LABEL);
    assert.match(v.detail, /bekend tot 24 oktober/);
    // Inside the known part the old period logic still applies.
    assert.equal(verdictFor(item, 'auto', { periods, tlTo: '2026-10-23T22:00:00Z', now: ms('2026-09-25T10:00:00Z') }).level, 'geen');
  });

  it('a window takes the heaviest stretch inside it that concerns the mode', () => {
    const day = { from: ms('2026-10-16T22:00:00Z'), to: ms('2026-10-17T21:59:00Z') };
    assert.equal(verdictFor(KRUGERKADE, 'auto', { tl: KRUGERKADE_TL, window: day }).level, 'dicht');
    const late = { from: ms('2026-10-24T22:00:00Z'), to: ms('2026-10-25T22:59:00Z') };
    assert.equal(verdictFor(KRUGERKADE, 'auto', { tl: KRUGERKADE_TL, window: late }).level, 'nvt');
    assert.equal(verdictFor(KRUGERKADE, 'fiets', { tl: KRUGERKADE_TL, window: late }).level, 'dicht');
  });
});

describe('forecast with a timeline', () => {
  const tilburg = {
    f: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5.08, 51.56] },
      properties: { id: 'T', cat: 'evenement', sev: 2, title: 'Sportwedstrijd, Tilburg', src: 'Gemeente Tilburg', start: '2026-09-24T06:00:00Z', end: '2026-09-27T19:00:00Z', imp: 'dicht', per: true },
    },
    d: {
      id: 'T',
      src: 'Gemeente Tilburg',
      upd: '2026-09-20T00:00:00Z',
      tl: [
        ['2026-09-26T06:00:00Z', '2026-09-26T15:00:00Z', 'hinder'],
        ['2026-09-27T04:00:00Z', '2026-09-27T19:00:00Z', 'dicht'],
      ],
      periods: [
        ['2026-09-26T06:00:00Z', '2026-09-26T15:00:00Z'],
        ['2026-09-27T04:00:00Z', '2026-09-27T19:00:00Z'],
      ],
    },
  };
  // Wednesday 23 September 2026, 14:00 Amsterdam.
  const NOW = ms('2026-09-23T12:00:00Z');

  it('the day strip shows each day its own phase', () => {
    const cells = dayStrip([tilburg], 'auto', NOW);
    const byDate = Object.fromEntries(cells.map((c) => [new Date(c.from + 12 * 3600e3).toISOString().slice(0, 10), c.worst]));
    assert.equal(byDate['2026-09-24'], null, 'donderdag: niets');
    assert.equal(byDate['2026-09-25'], null, 'vrijdag: niets');
    assert.equal(byDate['2026-09-26'], 'hinder');
    assert.equal(byDate['2026-09-27'], 'dicht');
  });

  it('the list under a picked day agrees with the day pill', () => {
    // Before, the list was computed for 00:00 of the picked day and said "Geen hinder · buiten
    // werktijden" under a pill that said "Doorrijden mogelijk".
    const cells = dayStrip([tilburg], 'auto', NOW);
    for (const cell of cells) {
      const sel = selectInWindow([tilburg], 'auto', Math.max(cell.from, NOW), cell.to, NOW);
      assert.equal(sel.worst, cell.worst, new Date(cell.from).toISOString());
    }
  });

  it('a moment on the Thursday lists the event, with the verdict "geen hinder"', () => {
    const sel = selectAtMoment([tilburg], 'auto', ms('2026-09-24T10:00:00Z'), NOW);
    assert.equal(sel.items.length, 1);
    assert.equal(sel.items[0].verdict.level, 'geen');
  });
});

describe('open ends and the edge of what is known (review of contract v4)', () => {
  const { parsePeriods, summarizePeriods } = periodsMod;

  it('a period with an empty end runs on: a moment in it is not "buiten werktijden"', () => {
    const item = { cat: 'werk', imp: 'dicht', per: true };
    const periods = [
      ['2026-09-24T05:00:00Z', '2026-09-24T14:00:00Z'],
      ['2026-10-01T05:00:00Z', ''],
    ];
    assert.equal(parsePeriods(periods)[1].end, Number.POSITIVE_INFINITY);
    assert.equal(verdictFor(item, 'auto', { periods, now: ms('2026-11-03T10:00:00Z') }).level, 'dicht');
    assert.equal(verdictFor(item, 'auto', { periods, now: ms('2026-09-25T10:00:00Z') }).level, 'geen');
  });

  it('an open period is listed as "vanaf", never a crash and never a pattern', () => {
    const periods = [
      ['2026-09-24T05:00:00Z', '2026-09-24T14:00:00Z'],
      ['2026-09-25T05:00:00Z', '2026-09-25T14:00:00Z'],
      ['2026-09-26T05:00:00Z', ''],
    ];
    const s = summarizePeriods(periods, ms('2026-09-23T12:00:00Z'));
    assert.equal(s.kind, 'list');
    const last = s.items[s.items.length - 1];
    assert.match(format.fmtPeriodMs(last.start, last.end), /^vanaf /);
  });

  it('a moment exactly at tlTo is "nog niet bekend": the timeline stops there', () => {
    const item = { cat: 'werk', imp: 'dicht', per: true };
    const tl = [['2026-10-20T05:00:00Z', '2026-10-22T22:00:00Z', 'dicht']];
    const v = verdictFor(item, 'auto', { tl, tlTo: '2026-10-22T22:00:00Z', now: ms('2026-10-22T22:00:00Z') });
    assert.equal(v.level, 'onbekend');
  });

  it('an item that never concerns the mode stays "geldt niet voor jou", also past tlTo', () => {
    const item = { cat: 'werk', imp: 'dicht', veh: ['bicycle'], per: true };
    const v = verdictFor(item, 'auto', { tlTo: '2026-10-22T22:00:00Z', now: ms('2026-11-09T10:00:00Z') });
    assert.equal(v.level, 'nvt');
  });

  it('a window reaching past tlTo is never lighter than "nog niet bekend"', () => {
    const item = { cat: 'werk', imp: 'dicht', per: true };
    const tl = [['2026-10-20T05:00:00Z', '2026-10-20T14:00:00Z', 'dicht']];
    const window = { from: ms('2026-10-21T22:00:00Z'), to: ms('2026-10-23T21:59:00Z') };
    assert.equal(verdictFor(item, 'auto', { tl, tlTo: '2026-10-22T22:00:00Z', window }).level, 'onbekend');
    // A heavier stretch inside the known part still wins.
    const withClosure = [...tl, ['2026-10-22T05:00:00Z', '2026-10-22T14:00:00Z', 'dicht']];
    assert.equal(verdictFor(item, 'auto', { tl: withClosure, tlTo: '2026-10-22T22:00:00Z', window }).level, 'dicht');
  });

  it('v3 data: a picked day without any block says "geen hinder", like the day pill', () => {
    const item = { cat: 'werk', imp: 'dicht', per: true };
    const periods = [['2026-09-24T20:00:00Z', '2026-09-25T04:00:00Z']];
    const saturday = { from: ms('2026-09-25T22:00:00Z'), to: ms('2026-09-26T21:59:00Z') };
    assert.equal(verdictFor(item, 'auto', { periods, window: saturday }).level, 'geen');
    const thursday = { from: ms('2026-09-23T22:00:00Z'), to: ms('2026-09-24T21:59:00Z') };
    assert.equal(verdictFor(item, 'auto', { periods, window: thursday }).level, 'dicht');
  });

  it('today in the day strip starts now: a night closure that ended this morning does not colour it', () => {
    const night = {
      f: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [5.1, 52.1] },
        properties: { id: 'N', cat: 'werk', sev: 2, title: 'Nachtafsluiting', src: 'Rijkswaterstaat', start: '2026-09-22T20:00:00Z', end: '2026-09-24T04:00:00Z', imp: 'dicht', per: true },
      },
      d: {
        id: 'N',
        src: 'Rijkswaterstaat',
        upd: '2026-09-20T00:00:00Z',
        periods: [
          ['2026-09-22T20:00:00Z', '2026-09-23T04:00:00Z'],
          ['2026-09-24T20:00:00Z', '2026-09-25T04:00:00Z'],
        ],
      },
    };
    // Wednesday 23 September 14:00 Amsterdam: the night block ended at 06:00 local.
    const cells = dayStrip([night], 'auto', ms('2026-09-23T12:00:00Z'));
    assert.equal(cells[0].worst, null);
    assert.equal(cells[0].from, ms('2026-09-22T22:00:00Z'), 'the cell keeps its calendar bounds');
  });
});
