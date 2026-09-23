/**
 * Tests for src/timeline.js — the verdict of a measure over time (contract v4).
 *
 * The cases are the real shapes the audit of 2026-09-19 found wrong answers in: the phased street
 * works on the Paul Krugerkade, the sports event in Tilburg whose closures all fell on the Sunday,
 * the Lijsterbeslaan whose closure ran outside the main record's blocks, and the dominant pattern
 * — nightly blocks on the main record — that must come out exactly as it did in v3.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityOf, buildTimeline, heaviest, MAX_SEGMENTS, timelineWindow } from '../src/timeline.js';

// Monday 21 September 2026, 14:00 Amsterdam.
const NOW = Date.parse('2026-09-21T12:00:00Z');

const MW = { type: 'MaintenanceWorks' };
const closed = (vehicles) => ({ type: 'RoadOrCarriagewayOrLaneManagement', lane: 'roadClosed', ...(vehicles ? { vehicles } : {}) });
const lanes = { type: 'RoadOrCarriagewayOrLaneManagement', lane: 'laneClosures' };

const main = (start, end, periods) => ({ m: MW, start, end, periods, isMain: true });
const rec = (m, start, end, periods) => ({ m, start, end, periods, isMain: false });

/** A small stand-in for impactOf(): closure > lane measure > nothing. */
function judge(active) {
  const closures = active.filter((r) => r.m.lane === 'roadClosed');
  if (closures.length > 0) {
    if (closures.some((r) => !r.m.vehicles)) return { imp: 'dicht' };
    return { imp: 'dicht', veh: [...new Set(closures.flatMap((r) => r.m.vehicles))].sort() };
  }
  if (active.some((r) => !r.isMain)) return { imp: 'hinder' };
  return { imp: 'geen' };
}

test('the window runs from local midnight of the run day to local midnight a day past the horizon', () => {
  const { floor, to } = timelineWindow(NOW);
  const nl = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  assert.equal(nl(floor), '2026-09-21 00:00:00');
  assert.equal(nl(to), '2026-10-22 00:00:00'); // 31 days later
  // Two runs on the same local day share the window exactly.
  assert.deepEqual(timelineWindow(Date.parse('2026-09-21T05:30:00Z')), timelineWindow(Date.parse('2026-09-21T21:45:00Z')));
});

test('a single continuous measure gets no timeline at all: nothing changes against v3', () => {
  const records = [main('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'), rec(closed(), '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')];
  const t = buildTimeline({ records, itemEnd: '2026-10-01T00:00:00Z', nowMs: NOW, judge });
  assert.equal(t.segments.length, 1);
  assert.equal(t.periods, undefined);
  assert.equal(t.tl, undefined);
  assert.equal(t.tlTo, undefined);
  assert.deepEqual(t.heaviest, { imp: 'dicht' });
});

test('nightly blocks on the main record: periods as in v3, no tl, and tlTo where the list stops', () => {
  // The dominant pattern: 98% of situations with measures give every measure the overall window
  // and publish the blocks on the main record.
  const nights = [];
  for (let d = 21; d <= 30; d++) nights.push([`2026-09-${d}T18:00:00Z`, `2026-09-${d + 1 > 30 ? '30' : d + 1}T04:00:00Z`]);
  nights[nights.length - 1] = ['2026-09-30T18:00:00Z', '2026-10-01T04:00:00Z'];
  const records = [
    main('2026-09-21T18:00:00Z', '2026-10-01T04:00:00Z', nights),
    rec(closed(), '2026-09-21T18:00:00Z', '2026-10-01T04:00:00Z', nights),
  ];
  const t = buildTimeline({ records, mainBlocks: nights, itemEnd: '2026-10-01T04:00:00Z', nowMs: NOW, judge });
  assert.equal(t.tl, undefined, 'the verdict is the same every night, so periods say it all');
  assert.equal(t.periods.length, 10);
  assert.deepEqual(t.periods[0], ['2026-09-21T18:00:00Z', '2026-09-22T04:00:00Z']);
  assert.equal(t.tlTo, undefined, 'the item ends before the window does, so the list is complete');
  assert.deepEqual(t.heaviest, { imp: 'dicht' });
});

test('phases with their own windows each keep their own verdict (Paul Krugerkade, Haarlem)', () => {
  // Real shape of AND01_63F3C789343A4836AB32D67C846BB093: every phase has a roadClosed record with a
  // window of its own; the last phase only closes the road for cyclists.
  const records = [
    main('2026-09-17T05:00:00Z', '2026-10-29T16:00:00Z'),
    rec(closed(), '2026-09-17T05:00:00Z', '2026-10-16T05:00:00Z'),
    rec(lanes, '2026-09-17T05:00:00Z', '2026-10-16T05:00:00Z'),
    rec(closed(['bicycle']), '2026-10-16T05:00:00Z', '2026-10-29T16:00:00Z'),
  ];
  const t = buildTimeline({ records, itemEnd: '2026-10-29T16:00:00Z', nowMs: NOW, judge });
  assert.ok(t.tl, 'the verdict changes between phases, so there is a timeline');
  const last = t.tl[t.tl.length - 1];
  assert.equal(last[2], 'dicht');
  assert.deepEqual(last[3], ['bicycle'], 'the last phase is only closed for cyclists');
  const first = t.tl[0];
  assert.equal(first[2], 'dicht');
  assert.equal(first[3], undefined, 'the earlier phases close the road for everyone');
  // The last phase runs on unchanged past the window until the item ends, so it is not cut off:
  // cutting it at the window would make a reader conclude "outside every block" in late October.
  assert.equal(last[1], '2026-10-29T16:00:00Z');
  assert.equal(t.tlTo, undefined);
  assert.deepEqual(t.heaviest, { imp: 'dicht' }, 'the map colour is the heaviest phase');
});

test('a change after the window makes the answer past it "unknown" (block ends 11 November, item runs on)', () => {
  // Continuous inside the window, but the only block ends on 11 November while the item itself
  // runs into December. Past the window the list stops, and the site must not keep saying
  // "applies" for all of November. (Constructed; on 2026-09-23, 34 real items had this shape.)
  const records = [
    main('2026-08-24T05:00:00Z', '2026-12-18T15:00:00Z', [['2026-08-24T05:00:00Z', '2026-11-11T15:00:00Z']]),
    rec(closed(), '2026-08-24T05:00:00Z', '2026-12-18T15:00:00Z'),
  ];
  const t = buildTimeline({
    records,
    mainBlocks: [['2026-08-24T05:00:00Z', '2026-11-11T15:00:00Z']],
    itemEnd: '2026-12-18T15:00:00Z',
    nowMs: NOW,
    judge,
  });
  assert.equal(t.tlTo, '2026-10-21T22:00:00Z');
});

test('an open-ended measure that changes nothing after the window runs on, written as an open end', () => {
  const blocks = [['2026-09-22T05:00:00Z', '2026-09-22T14:00:00Z'], ['2026-09-24T05:00:00Z', undefined]];
  const records = [main('2026-09-22T05:00:00Z', undefined, blocks), rec(closed(), '2026-09-22T05:00:00Z', undefined, blocks)];
  const t = buildTimeline({ records, mainBlocks: blocks, itemEnd: undefined, nowMs: NOW, judge });
  assert.deepEqual(t.periods, [['2026-09-22T05:00:00Z', '2026-09-22T14:00:00Z'], ['2026-09-24T05:00:00Z', '']]);
  assert.equal(t.tlTo, undefined, 'nothing changes after the window: the last block simply goes on');
});

test('an event whose closures all fall on the Sunday is not "dicht" from Thursday on (Tilburg)', () => {
  // Real shape of AND01_44A03E5DECAC426DA9127E40579905A4: the event runs Thursday to Sunday, all ten
  // roadClosed records lie on the Sunday.
  const records = [main('2026-09-24T06:00:00Z', '2026-09-27T19:00:00Z')];
  for (let i = 0; i < 10; i++) records.push(rec(closed(), '2026-09-27T04:00:00Z', '2026-09-27T19:00:00Z'));
  const t = buildTimeline({ records, itemEnd: '2026-09-27T19:00:00Z', nowMs: NOW, judge });
  assert.deepEqual(
    t.tl.map((s) => [s[0], s[1], s[2]]),
    [
      ['2026-09-24T06:00:00Z', '2026-09-27T04:00:00Z', 'geen'],
      ['2026-09-27T04:00:00Z', '2026-09-27T19:00:00Z', 'dicht'],
    ],
  );
  assert.equal(t.periods, undefined, 'no gaps: the event itself runs throughout');
});

test('a closure outside the main record\'s blocks applies during its own window (Lijsterbeslaan, Leusden)', () => {
  // The main record published working days; a roadClosed child with its own window closes the
  // street continuously. v3 read only the main record's blocks and said "Geen hinder · buiten
  // werktijden" on a day the street was shut.
  const blocks = [
    ['2026-09-22T05:00:00Z', '2026-09-22T14:00:00Z'],
    ['2026-09-24T05:00:00Z', '2026-09-24T14:00:00Z'],
  ];
  const records = [
    main('2026-09-14T05:00:00Z', '2026-10-02T14:00:00Z', blocks),
    rec(closed(), '2026-09-14T05:00:00Z', '2026-10-02T14:00:00Z', blocks),
    rec(closed(), '2026-09-23T05:00:00Z', '2026-09-23T14:00:00Z'), // its own window, between the blocks
  ];
  const t = buildTimeline({ records, mainBlocks: blocks, itemEnd: '2026-10-02T14:00:00Z', nowMs: NOW, judge });
  const covers = (iso) => t.periods.some(([s, e]) => s <= iso && iso < e);
  assert.ok(covers('2026-09-23T10:00:00Z'), 'Wednesday the 23rd is closed by the child with its own window');
  assert.ok(covers('2026-09-22T10:00:00Z'));
  assert.ok(!covers('2026-09-25T10:00:00Z'), 'Friday lies outside every block');
});

test('an umbrella period over a record\'s own window is not a block', () => {
  const r = rec(closed(), '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z', [
    ['2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z'],
    ['2026-09-22T05:00:00Z', '2026-09-22T14:00:00Z'],
  ]);
  const m = main('2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z');
  assert.deepEqual(activityOf(r, m, []), [[Date.parse('2026-09-22T05:00:00Z'), Date.parse('2026-09-22T14:00:00Z')]]);
});

test('whatever ended before today is gone, and two runs on one day give identical output', () => {
  const records = [
    main('2026-09-01T00:00:00Z', '2026-10-10T00:00:00Z'),
    rec(closed(), '2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z'), // over before the run day
    rec(lanes, '2026-09-20T00:00:00Z', '2026-10-10T00:00:00Z'),
  ];
  const morning = buildTimeline({ records, itemEnd: '2026-10-10T00:00:00Z', nowMs: Date.parse('2026-09-21T05:00:00Z'), judge });
  const evening = buildTimeline({ records, itemEnd: '2026-10-10T00:00:00Z', nowMs: Date.parse('2026-09-21T20:30:00Z'), judge });
  assert.deepEqual(morning, evening);
  // Only the lane closure is left, so the heaviest verdict drops from dicht to hinder: the map no
  // longer paints a street red whose closure ended yesterday ("Saneren HL, Breda").
  assert.deepEqual(morning.heaviest, { imp: 'hinder' });
});

test('a list that would exceed MAX_SEGMENTS stops, and tlTo says where', () => {
  const blocks = [];
  let t0 = Date.parse('2026-09-21T00:00:00Z');
  for (let i = 0; i < MAX_SEGMENTS + 50; i++) {
    blocks.push([new Date(t0).toISOString(), new Date(t0 + 30 * 60000).toISOString()]);
    t0 += 60 * 60000;
  }
  const records = [main(blocks[0][0], blocks[blocks.length - 1][1], blocks), rec(closed(), blocks[0][0], blocks[blocks.length - 1][1], blocks)];
  const t = buildTimeline({ records, mainBlocks: blocks, itemEnd: blocks[blocks.length - 1][1], nowMs: NOW, judge });
  assert.equal(t.segments.length, MAX_SEGMENTS);
  assert.equal(t.tlTo, t.periods[t.periods.length - 1][1]);
});

test('heaviest: the strongest level wins, and at that level "all traffic" beats a restriction', () => {
  assert.deepEqual(heaviest([{ imp: 'hinder' }, { imp: 'dicht', veh: ['bicycle'] }]), { imp: 'dicht', veh: ['bicycle'] });
  assert.deepEqual(heaviest([{ imp: 'dicht', veh: ['bicycle'] }, { imp: 'dicht' }]), { imp: 'dicht' });
  assert.deepEqual(heaviest([{ imp: 'dicht', veh: ['lorry'] }, { imp: 'dicht', veh: ['car'] }]), { imp: 'dicht', veh: ['car', 'lorry'] });
  assert.equal(heaviest([]), undefined);
});
