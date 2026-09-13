/**
 * Unit tests for web/src/data/forecast.ts: period-aware moment/window selection and the
 * 7-day strip.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forecast, periods as periodsMod, time } from './helpers/src.mjs';

const { dayStrip, isActiveAtMoment, itemsForCell, relativeDayLabel, selectAtMoment, selectInWindow, touchesWindow, STRIP_DAYS } = forecast;
const { parsePeriods } = periodsMod;
const { startOfDay, MS } = time;

const NOW = Date.parse('2026-09-09T12:00:00Z'); // Wednesday 14:00 CEST

function item(id, over = {}, d = null) {
  return {
    f: {
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [5.1, 52.1] },
      properties: { id, cat: 'werk', sev: 2, title: id, start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z', src: 'x', imp: 'hinder', ...over },
    },
    d,
  };
}

const nightly = [
  ['2026-09-09T19:00:00Z', '2026-09-10T03:00:00Z'],
  ['2026-09-10T19:00:00Z', '2026-09-11T03:00:00Z'],
  ['2026-09-11T19:00:00Z', '2026-09-12T03:00:00Z'],
];

describe('isActiveAtMoment / touchesWindow', () => {
  const span = { start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z' };
  const p = parsePeriods(nightly);

  it('without periods only the span counts', () => {
    assert.equal(isActiveAtMoment(span, [], NOW), true);
    assert.equal(isActiveAtMoment(span, [], Date.parse('2026-10-01T00:00:00Z')), false);
  });

  it('with periods the moment must fall inside one of them', () => {
    assert.equal(isActiveAtMoment(span, p, NOW), false);
    assert.equal(isActiveAtMoment(span, p, Date.parse('2026-09-09T22:00:00Z')), true);
  });

  it('a window touches when a period overlaps it', () => {
    const from = startOfDay(NOW, 4);
    assert.equal(touchesWindow(span, p, from, startOfDay(NOW, 5) - 1), false, 'no night on day +4 (the Friday night still covers Saturday until 05:00)');
    assert.equal(touchesWindow(span, p, startOfDay(NOW), startOfDay(NOW, 1) - 1), true);
    assert.equal(touchesWindow(span, [], from, from + MS.hour), true);
  });
});

describe('selectAtMoment / selectInWindow', () => {
  const items = [
    item('closed', { imp: 'dicht' }),
    item('cycle', { imp: 'dicht', veh: ['bicycle'] }),
    item('night', { imp: 'dicht', per: true }, { id: 'night', src: 'x', upd: '2026-09-01T00:00:00Z', periods: nightly }),
    item('later', { start: '2026-09-20T00:00:00Z' }),
  ];

  it('at noon: the closure counts, the cycle path is hidden, the nightly work is geen', () => {
    const sel = selectAtMoment(items, 'auto', NOW);
    assert.deepEqual(sel.items.map((x) => x.item.f.properties.id), ['closed', 'night']);
    assert.equal(sel.items[1].verdict.level, 'geen');
    assert.equal(sel.worst, 'dicht');
    assert.deepEqual(sel.hidden.map((x) => x.item.f.properties.id), ['cycle']);
  });

  it('at night the nightly work is dicht; for cyclists the cycle path counts too', () => {
    const night = Date.parse('2026-09-09T22:00:00Z');
    assert.equal(selectAtMoment(items, 'auto', night).items.find((x) => x.item.f.properties.id === 'night').verdict.level, 'dicht');
    const fiets = selectAtMoment(items, 'fiets', NOW);
    assert.ok(fiets.items.some((x) => x.item.f.properties.id === 'cycle'));
    assert.equal(fiets.hidden.length, 0);
  });

  it('a window includes the item that starts inside it', () => {
    const sel = selectInWindow(items, 'auto', NOW, Date.parse('2026-09-21T00:00:00Z'));
    assert.ok(sel.items.some((x) => x.item.f.properties.id === 'later'));
    assert.equal(sel.items[0].verdict.level, 'dicht', 'worst first');
  });
});

describe('live snapshots', () => {
  const { liveAppliesAt, LIVE_HORIZON_MS } = forecast;
  const incident = item('inc', { cat: 'incident', sub: 'accident', imp: 'hinder', start: '2026-09-09T11:30:00Z', end: undefined });
  const file = item('file', { cat: 'file', imp: 'hinder', start: '2026-09-09T11:00:00Z', end: '2026-09-09T13:00:00Z' });

  it('an open-ended incident counts now and within the horizon, not tomorrow', () => {
    assert.equal(liveAppliesAt(incident.f.properties, NOW, NOW), true);
    assert.equal(liveAppliesAt(incident.f.properties, NOW + LIVE_HORIZON_MS, NOW), true);
    assert.equal(liveAppliesAt(incident.f.properties, NOW + MS.day, NOW), false);
    assert.deepEqual(selectAtMoment([incident], 'auto', NOW, NOW).items.map((x) => x.item.f.properties.id), ['inc']);
    assert.deepEqual(selectAtMoment([incident], 'auto', NOW + MS.day, NOW).items, []);
    assert.deepEqual(selectInWindow([incident], 'auto', startOfDay(NOW, 1), startOfDay(NOW, 2) - 1, NOW).items, []);
  });

  it('a live item with an end date and every planned item follow their span', () => {
    assert.equal(liveAppliesAt(file.f.properties, NOW + MS.day, NOW), true);
    assert.equal(liveAppliesAt(item('w').f.properties, NOW + 20 * MS.day, NOW), true);
    // Without `now` nothing is excluded (pure callers that only know the asked moment).
    assert.equal(selectAtMoment([incident], 'auto', NOW + MS.day).items.length, 1);
  });
});

describe('dayStrip', () => {
  const items = [
    item('a', { imp: 'hinder' }),
    item('b', { imp: 'dicht', start: '2026-09-11T06:00:00Z', end: '2026-09-11T20:00:00Z' }),
    item('c', { imp: 'dicht', veh: ['bicycle', 'moped'] }),
    item('n', { imp: 'dicht', per: true }, { id: 'n', src: 'x', upd: '2026-09-01T00:00:00Z', periods: nightly }),
  ];

  it('produces seven cells from today with calendar bounds', () => {
    const cells = dayStrip(items, 'auto', NOW);
    assert.equal(cells.length, STRIP_DAYS);
    assert.equal(cells[0].from, startOfDay(NOW));
    assert.equal(cells[1].from, startOfDay(NOW, 1));
    assert.equal(cells[0].to, cells[1].from - 1);
  });

  it('the worst verdict per day ignores items that do not apply to the mode', () => {
    const auto = dayStrip(items, 'auto', NOW);
    assert.equal(auto[0].worst, 'dicht', 'nightly work tonight');
    assert.equal(auto[2].worst, 'dicht', 'Friday closure');
    assert.equal(auto[4].worst, 'hinder', 'only the lane closure remains');
    assert.equal(auto[4].counts.hinder, 1);
    assert.equal(auto[4].counts.nvt, 0);
    const fiets = dayStrip(items, 'fiets', NOW);
    assert.equal(fiets[4].worst, 'dicht', 'the cycle path counts for cyclists');
  });

  it('itemsForCell returns the items of a cell in input order', () => {
    const cells = dayStrip(items, 'auto', NOW);
    assert.deepEqual(itemsForCell(items, cells[2]).map((x) => x.f.properties.id), ['a', 'b', 'n']);
  });

  it('relativeDayLabel says vandaag / morgen and otherwise the fallback', () => {
    const cells = dayStrip(items, 'auto', NOW);
    assert.equal(relativeDayLabel(cells[0], NOW, 'wo 9'), 'vandaag');
    assert.equal(relativeDayLabel(cells[1], NOW, 'do 10'), 'morgen');
    assert.equal(relativeDayLabel(cells[2], NOW, 'vr 11'), 'vr 11');
  });
});
