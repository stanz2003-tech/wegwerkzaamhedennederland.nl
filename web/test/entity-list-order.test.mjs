/**
 * The order and first batch of the road / place page lists (web/src/ui/entity-list.ts): the
 * heaviest pill first, and no closure behind "Toon meer" (vooruit-1). Only the order may change —
 * the tests also pin that the order is computed from exactly the pill each row shows.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureFiles, readJson } from './helpers/fixtures.mjs';
import { entityFile, entityList, listItem, verdict } from './helpers/src.mjs';

const { VERDICT_SEVERITY } = verdict;
const NOW = Date.parse(readJson('meta.json').generated);
const ROADS = fixtureFiles().filter((f) => f.startsWith('roads/'));

function rowsOf(file) {
  const items = readJson(file).items;
  const details = new Map(items.map((it) => [it.f.properties.id, it.d]));
  return { rows: items.map((it) => entityFile.indexItemFromFeature(it.f)), details };
}

const rank = (level) => VERDICT_SEVERITY.indexOf(level);
const CASES = [
  { label: 'now', opts: { at: NOW } },
  { label: 'a day window', opts: { window: { from: NOW + 86_400_000, to: NOW + 2 * 86_400_000 } } },
];

describe('rowVerdict is the pill the row shows', () => {
  it('matches data-verdict of the rendered row for every fixture road item', () => {
    for (const file of ROADS) {
      const { rows, details } = rowsOf(file);
      for (const { opts } of CASES) {
        for (const mode of ['auto', 'fiets']) {
          const o = { ...opts, mode, details };
          for (const it of rows) {
            const d = details.get(it.id);
            const html = listItem.renderListItem(listItem.modelFromIndexItem(it), NOW, {
              mode,
              ...opts,
              ...(d?.periods ? { periods: d.periods } : {}),
              ...(d?.tl ? { tl: d.tl } : {}),
              ...(d?.tlTo ? { tlTo: d.tlTo } : {}),
              ...(d?.to ? { to: d.to } : {}),
              ...(d?.from ? { from: d.from } : {}),
            });
            const shown = /data-verdict="([a-z]+)"/.exec(html)?.[1];
            assert.equal(entityList.rowVerdict(it, NOW, o).level, shown, `${file} ${it.id}`);
          }
        }
      }
    }
  });
});

describe('sortByVerdict', () => {
  for (const { label, opts } of CASES) {
    it(`${label}: worst first, same set, input order kept within a level`, () => {
      for (const file of ROADS) {
        const { rows, details } = rowsOf(file);
        const o = { ...opts, mode: 'auto', details };
        const sorted = entityList.sortByVerdict(rows, NOW, o);
        assert.deepEqual([...sorted.map((r) => r.id)].sort(), [...rows.map((r) => r.id)].sort(), file);
        const levels = sorted.map((r) => rank(entityList.rowVerdict(r, NOW, o).level));
        for (let i = 1; i < levels.length; i++) assert.ok(levels[i - 1] <= levels[i], `${file}: row ${i} heavier than row ${i - 1}`);
        // Stable: within one level the input (impact) order survives.
        const inputIndex = new Map(rows.map((r, i) => [r.id, i]));
        for (let i = 1; i < sorted.length; i++) {
          if (levels[i] === levels[i - 1]) assert.ok(inputIndex.get(sorted[i - 1].id) < inputIndex.get(sorted[i].id), `${file}: unstable at ${i}`);
        }
      }
    });
  }

  it('a synthetic list: the closure moves above the lighter rows', () => {
    const base = { cat: 'werk', sub: null, sev: 2, road: 'A27', roadType: 'A', gemeente: null, woonplaats: null, prov: null, start: '2026-09-01T00:00Z', end: '2026-12-01T00:00Z', lon: 5, lat: 52, closed: false, hind: null, active: true, veh: null, per: false, spd: null, lc: null };
    const rows = [
      { ...base, id: 'h1', title: 'h1', imp: 'hinder' },
      { ...base, id: 'g1', title: 'g1', imp: 'geen' },
      { ...base, id: 'd1', title: 'd1', imp: 'dicht' },
      { ...base, id: 'h2', title: 'h2', imp: 'hinder' },
      { ...base, id: 'r1', title: 'r1', imp: 'rijbaan' },
    ];
    assert.deepEqual(entityList.sortByVerdict(rows, NOW, { at: NOW }).map((r) => r.id), ['d1', 'r1', 'h1', 'h2', 'g1']);
  });
});

describe('firstBatchSize: no closure behind "Toon meer"', () => {
  const base = { cat: 'werk', sub: null, sev: 2, road: 'A27', roadType: 'A', gemeente: null, woonplaats: null, prov: null, start: '2026-09-01T00:00Z', end: '2026-12-01T00:00Z', lon: 5, lat: 52, closed: false, hind: null, active: true, veh: null, per: false, spd: null, lc: null };
  const many = (n, imp) => Array.from({ length: n }, (_, i) => ({ ...base, id: `${imp}${i}`, title: `${imp}${i}`, imp }));

  it('grows the first batch to the last closure, only when asked', () => {
    const rows = [...many(30, 'hinder'), ...many(2, 'rijbaan'), ...many(10, 'geen')];
    assert.equal(entityList.firstBatchSize(rows, 25, NOW, { at: NOW }), 25, 'plain batches without revealClosures');
    assert.equal(entityList.firstBatchSize(rows, 25, NOW, { at: NOW, revealClosures: true }), 32);
  });

  it('a list sorted worst first: the batch is the number of closures (or the default)', () => {
    const sorted = entityList.sortByVerdict([...many(5, 'hinder'), ...many(40, 'dicht')], NOW, { at: NOW });
    assert.equal(entityList.firstBatchSize(sorted, 25, NOW, { at: NOW, revealClosures: true }), 40);
    assert.equal(entityList.firstBatchSize(many(3, 'hinder'), 25, NOW, { at: NOW, revealClosures: true }), 25);
  });
});
