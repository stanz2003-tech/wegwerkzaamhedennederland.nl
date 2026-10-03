/**
 * Order and summary blocks of the lists (UX-pakket 8): road pages follow the road inside each
 * verdict level (overzicht-4), the window pages lead with the closures and the motorways
 * (overzicht-12), and the map panel names the closed motorways at national zoom (overzicht-5).
 * Only the order and the wording change; every assertion that touches a level checks that it is
 * exactly the level of the row it came from.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closedRoads, copy, entity, listSummary, motorwayBlock, verdict } from './helpers/src.mjs';

const { alongRoad, orderAlongRoad } = entity;
const { VERDICT_SEVERITY } = verdict;
const rank = (level) => VERDICT_SEVERITY.indexOf(level);

describe('alongRoad / orderAlongRoad', () => {
  // The A27 runs north–south: Hilversum (52.2) … Utrecht (52.1) … Gorinchem (51.8) … Breda (51.6).
  const rows = [
    { id: 'breda', lon: 4.8, lat: 51.6, level: 'rijbaan' },
    { id: 'hilversum', lon: 5.2, lat: 52.2, level: 'rijbaan' },
    { id: 'gorinchem', lon: 4.98, lat: 51.83, level: 'hinder' },
    { id: 'utrecht', lon: 5.1, lat: 52.1, level: 'rijbaan' },
    { id: 'nopoint', lon: 0, lat: 0, level: 'rijbaan' },
  ];

  it('projects a north–south road from north to south', () => {
    const pos = alongRoad(rows);
    assert.ok(pos.get('hilversum') < pos.get('utrecht'));
    assert.ok(pos.get('utrecht') < pos.get('breda'));
    assert.equal(pos.get('nopoint'), Number.POSITIVE_INFINITY);
  });

  it('projects an east–west road from west to east', () => {
    const a12 = [
      { id: 'arnhem', lon: 5.9, lat: 52.0 },
      { id: 'denhaag', lon: 4.3, lat: 52.07 },
      { id: 'utrecht', lon: 5.1, lat: 52.09 },
    ];
    const pos = alongRoad(a12);
    assert.deepEqual([...a12].sort((a, b) => pos.get(a.id) - pos.get(b.id)).map((r) => r.id), ['denhaag', 'utrecht', 'arnhem']);
  });

  it('keeps the verdict level first and follows the road inside a level', () => {
    const ordered = orderAlongRoad(rows, (r) => r.level);
    assert.deepEqual(ordered.map((r) => r.id), ['hilversum', 'utrecht', 'breda', 'nopoint', 'gorinchem']);
    for (let i = 1; i < ordered.length; i++) assert.ok(rank(ordered[i - 1].level) <= rank(ordered[i].level), 'never a lighter level above a heavier one');
  });

  it('orders by direction at the same position', () => {
    const same = [
      { id: 'b', lon: 5, lat: 52, level: 'rijbaan', to: 'Utrecht' },
      { id: 'a', lon: 5, lat: 52, level: 'rijbaan', to: 'Breda' },
    ];
    assert.deepEqual(orderAlongRoad(same, (r) => r.level, (r) => r.to).map((r) => r.id), ['a', 'b']);
  });
});

describe('windowOrder (/vandaag/, /dit-weekend/)', () => {
  const rows = [
    { id: 'venlo', roadType: 'lokaal', start: '2026-10-02T06:00:00Z', level: 'dicht' },
    { id: 'n-hinder', roadType: 'N', start: '2026-10-02T06:00:00Z', level: 'hinder' },
    { id: 'a2', roadType: 'A', start: '2026-10-03T20:00:00Z', level: 'rijbaan' },
    { id: 'a27', roadType: 'A', start: '2026-10-02T20:00:00Z', level: 'dicht' },
    { id: 'n3', roadType: 'N', start: '2026-10-02T20:00:00Z', level: 'dicht' },
    { id: 'geen', roadType: 'A', start: '2026-10-02T20:00:00Z', level: 'geen' },
  ];
  const ordered = listSummary.windowOrder(rows, (r) => r.level);

  it('leads with closures on the biggest roads', () => {
    assert.deepEqual(ordered.map((r) => r.id), ['a27', 'a2', 'n3', 'venlo', 'n-hinder', 'geen']);
  });

  it('never puts a lighter level than a closure above a closure', () => {
    const firstOpen = ordered.findIndex((r) => r.level !== 'dicht' && r.level !== 'rijbaan');
    assert.ok(ordered.slice(firstOpen).every((r) => r.level !== 'dicht' && r.level !== 'rijbaan'));
    const open = ordered.slice(firstOpen);
    for (let i = 1; i < open.length; i++) assert.ok(rank(open[i - 1].level) <= rank(open[i].level));
  });

  it('renames the weekend groups to what they mean', () => {
    assert.equal(listSummary.LIST_TITLES.weekend.active, 'Loopt al en duurt dit weekend door');
    assert.equal(listSummary.LIST_TITLES.weekend.upcoming, 'Begint dit weekend');
  });
});

describe('Snelwegen dit weekend', () => {
  // Weekend of fri 2 okt 20:00 – mon 5 okt 06:00 (CEST).
  const window = { from: Date.parse('2026-10-02T18:00:00Z'), to: Date.parse('2026-10-05T04:00:00Z') };
  const row = (id, road, level, start, end, extra = {}) => ({ id, road, roadType: road?.startsWith('A') ? 'A' : 'N', woonplaats: 'Houten', gemeente: null, start, end, per: false, level, ...extra });
  const rows = [
    row('a27-1', 'A27', 'rijbaan', '2026-10-03T20:00:00Z', '2026-10-04T08:00:00Z'),
    row('a27-2', 'A27', 'dicht', '2026-10-04T20:00:00Z', '2026-10-05T03:00:00Z', { woonplaats: 'Gorinchem' }),
    row('a2', 'A2', 'rijbaan', '2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z', { woonplaats: 'Vinkeveen' }),
    row('a12', 'A12', 'hinder', '2026-10-03T20:00:00Z', '2026-10-04T08:00:00Z'),
    row('n3', 'N3', 'dicht', '2026-10-03T20:00:00Z', '2026-10-04T08:00:00Z'),
  ];
  const lines = motorwayBlock.motorwayLines(rows, (r) => r.level, window, 'het hele weekend');

  it('names every motorway with a closure once, with its worst level', () => {
    assert.deepEqual(lines.map((l) => `${l.road}:${l.level}`), ['A27:dicht', 'A2:rijbaan']);
    for (const l of lines) {
      const levels = rows.filter((r) => r.road === l.road).map((r) => r.level);
      assert.equal(l.level, levels.reduce((a, b) => (rank(b) < rank(a) ? b : a)), 'worst member level');
    }
  });

  it('says where and when inside the window, and links to the road page', () => {
    const a27 = lines.find((l) => l.road === 'A27');
    assert.equal(a27.place, 'bij Gorinchem');
    assert.equal(a27.when, 'zo 4 okt 22:00 – ma 5 okt 05:00');
    assert.equal(a27.more, true);
    assert.equal(a27.href, '/weg/a27/');
    assert.equal(lines.find((l) => l.road === 'A2').when, 'het hele weekend');
  });

  it('is left out without a closed motorway, rather than claiming they are open', () => {
    assert.equal(motorwayBlock.renderMotorwayBlock('Snelwegen dit weekend', []), '');
    assert.match(motorwayBlock.renderMotorwayBlock('Snelwegen dit weekend', lines), /Snelwegen dit weekend/);
  });

  it('marks recurring work', () => {
    assert.equal(motorwayBlock.whenInWindow({ start: rows[0].start, end: rows[0].end, per: true }, window.from, window.to, 'x'), 'za 3 okt 22:00 – zo 4 okt 10:00, op bepaalde tijden');
  });
});

describe('Nu dicht op snelwegen (map panel)', () => {
  const answered = (road, level, roadType = 'A') => ({ item: { f: { properties: { road, roadType } } }, verdict: { level } });
  it('names the motorways with a closure, "weg dicht" first, at most eight', () => {
    const items = [answered('A27', 'rijbaan'), answered('A2', 'hinder'), answered('A12', 'dicht'), answered('N3', 'dicht', 'N'), answered('A27', 'dicht'), answered('A4', 'rijbaan')];
    assert.deepEqual(closedRoads.closedMotorways(items).map((r) => `${r.road}:${r.level}`), ['A12:dicht', 'A27:dicht', 'A4:rijbaan']);
    const many = Array.from({ length: 12 }, (_, i) => answered(`A${i + 1}`, 'rijbaan'));
    assert.equal(closedRoads.closedMotorways(many).length, closedRoads.MAX_CLOSED_ROADS);
  });

  it('words the lead for the chosen moment', () => {
    assert.equal(copy.closedMotorwaysLead('nu'), 'Nu dicht op snelwegen:');
    assert.equal(copy.closedMotorwaysLead('dit weekend'), 'Dit weekend dicht op snelwegen:');
    assert.equal(copy.closedMotorwaysLead('za 3 okt 14:00'), 'Op za 3 okt 14:00 dicht op snelwegen:');
  });

  it('uses one word list for the relevance switch', () => {
    assert.equal(copy.relevanceLabel('auto'), "Alleen wat voor auto's geldt");
    assert.equal(copy.relevanceLabel('vracht'), 'Alleen wat voor vrachtverkeer geldt');
    assert.equal(copy.relevanceLabel('fiets'), 'Alleen wat voor fietsers geldt');
  });
});
