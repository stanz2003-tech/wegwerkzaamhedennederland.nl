/**
 * The map page's filtering and list order, moved out of main.ts (ui/map-selection.ts). The list
 * order may change; no item may be dropped, and within "Ernstigste eerst" no row may stand above
 * a heavier one.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { mapSelection, urlState, verdict } from './helpers/src.mjs';

const { judge, orderForList, selectForQuestion, needsGepland, inTime } = mapSelection;
const { DEFAULT_URL_STATE } = urlState;
const rank = (level) => verdict.VERDICT_SEVERITY.indexOf(level);
const actueel = JSON.parse(readFileSync(new URL('../fixtures/data/werk-actueel.geojson', import.meta.url), 'utf8')).features;
const live = JSON.parse(readFileSync(new URL('../fixtures/data/live.geojson', import.meta.url), 'utf8')).features;
const items = [...live, ...actueel];
const NOW = Date.parse('2026-09-23T10:00:00Z');

describe('map selection (ui/map-selection.ts)', () => {
  it('"Ernstigste eerst" keeps every item and never puts a lighter row above a heavier one', () => {
    for (const mode of ['auto', 'vracht', 'fiets']) {
      for (const road of [null, 'A27', 'A2']) {
        const q = { ...DEFAULT_URL_STATE, road };
        const { base } = selectForQuestion(items, q, null, NOW);
        const judged = judge(base, mode, NOW, null);
        const ordered = orderForList(judged, 'impact', null, NOW, road);
        assert.deepEqual(new Set(ordered.map((f) => f.properties.id)), new Set(base.map((f) => f.properties.id)), `${mode} ${road}`);
        const level = new Map(judged.map((j) => [j.f.properties.id, j.level]));
        for (let i = 1; i < ordered.length; i++) {
          assert.ok(rank(level.get(ordered[i - 1].properties.id)) <= rank(level.get(ordered[i].properties.id)), `${mode} ${road} row ${i}`);
        }
      }
    }
  });

  it('a picked day judges the pills over the whole window, never lighter than at its start', () => {
    const window = { from: NOW, to: NOW + 24 * 3600_000 };
    const atStart = new Map(judge(items, 'auto', NOW, null).map((j) => [j.f.properties.id, j.level]));
    for (const j of judge(items, 'auto', NOW, window)) {
      if (atStart.get(j.f.properties.id) === 'nvt') continue;
      assert.ok(rank(j.level) <= rank(atStart.get(j.f.properties.id)) || j.level === 'onbekend', j.f.properties.id);
    }
  });

  it('road mode keeps every item of the road for the answer, whatever the moment', () => {
    const q = { ...DEFAULT_URL_STATE, road: 'A27', moment: NOW + 400 * 24 * 3600_000 };
    const { base, roadAll } = selectForQuestion(items, q, null, NOW);
    assert.ok(roadAll.length >= base.length);
    assert.ok(roadAll.every((f) => /^A\s*0*27$/i.test(f.properties.road ?? '')));
  });

  it('needs werk-gepland only for a question past now', () => {
    assert.equal(needsGepland({ ...DEFAULT_URL_STATE }, NOW), false);
    assert.equal(needsGepland({ ...DEFAULT_URL_STATE, time: 'morgen' }, NOW), true);
    assert.equal(needsGepland({ ...DEFAULT_URL_STATE, moment: NOW + 3600_000 }, NOW), true);
    assert.equal(needsGepland({ ...DEFAULT_URL_STATE, day: '2026-09-30' }, NOW), true);
    const item = items[0].properties;
    assert.equal(typeof inTime(item, { ...DEFAULT_URL_STATE }, NOW), 'boolean');
  });
});
