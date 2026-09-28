/**
 * The state hint next to the links on /wegen/ and /plaatsen/ (web/src/ui/road-state.ts) and the
 * stale-data wording (ui/topbar.ts, ui/stale-banner.ts): the heaviest verdict wins, a hint is
 * only ever a closure, and old data is named with its day.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadFixtureData } from './helpers/fixtures.mjs';
import { dataIndex, entity, roadState, staleBanner, topbar, verdict } from './helpers/src.mjs';

const { VERDICT_SEVERITY, verdictFor } = verdict;
const data = loadFixtureData();
const NOW = data.now;
const rows = dataIndex.rowsToItems(data.indexAll.rows);
const roadKeys = (it) => {
  const k = entity.roadKey(it.road);
  return k ? [k] : [];
};

describe('worstActiveByKey', () => {
  const worst = roadState.worstActiveByKey(rows, roadKeys, NOW);

  it('no road gets a lighter level than any of its active items', () => {
    assert.ok(worst.size > 0);
    for (const it of rows) {
      if (!it.active) continue;
      const key = entity.roadKey(it.road);
      if (!key) continue;
      const level = verdictFor(it, 'auto', { now: NOW }).level;
      assert.ok(VERDICT_SEVERITY.indexOf(worst.get(key)) <= VERDICT_SEVERITY.indexOf(level), `${key}: ${worst.get(key)} lighter than ${it.id} ${level}`);
    }
  });

  it('the level is one an active item of that road actually has', () => {
    for (const [key, level] of worst) {
      const own = rows.filter((it) => it.active && entity.roadKey(it.road) === key).map((it) => verdictFor(it, 'auto', { now: NOW }).level);
      assert.ok(own.includes(level), key);
    }
  });

  it('items that are not active do not count', () => {
    const base = { cat: 'werk', sub: null, sev: 2, title: 'x', road: 'A99', roadType: 'A', gemeente: null, woonplaats: null, prov: null, start: '2026-09-01T00:00Z', end: null, lon: 5, lat: 52, closed: true, hind: null, veh: null, per: false, spd: null, lc: null };
    const m = roadState.worstActiveByKey([{ ...base, id: 'a', imp: 'dicht', active: false }, { ...base, id: 'b', imp: 'hinder', active: true }], roadKeys, NOW);
    assert.equal(m.get('A99'), 'hinder');
  });
});

describe('roadStateHtml', () => {
  it('only closures get a hint, worded as reported', () => {
    assert.match(roadState.roadStateHtml('dicht'), /class="road-state road-state--dicht">ergens dicht gemeld</);
    assert.match(roadState.roadStateHtml('rijbaan'), />rijbaan dicht gemeld</);
    for (const level of ['hinder', 'geen', 'nvt', 'onbekend', null, undefined]) assert.equal(roadState.roadStateHtml(level), '', String(level));
  });
});

describe('stale data wording', () => {
  const today = Date.parse('2026-09-28T18:17:00Z'); // 20:17 CEST
  const later = Date.parse('2026-09-28T19:30:00Z');

  it('liveTimeLabel: a clock time today, the day and time otherwise', () => {
    assert.equal(topbar.liveTimeLabel(today, later), '20:17');
    assert.equal(topbar.liveTimeLabel(Date.parse('2026-09-23T19:31:00Z'), later), 'wo 23 sep 21:31');
  });

  it('staleDataLabel only for stale data', () => {
    assert.equal(topbar.staleDataLabel({ kind: 'stale', generated: '2026-09-28T18:17Z' }, later), '20:17');
    assert.equal(topbar.staleDataLabel({ kind: 'ok', generated: '2026-09-28T18:17Z' }, later), undefined);
    assert.equal(topbar.staleDataLabel({ kind: 'error' }, later), undefined);
  });

  it('the status turns stale after STALE_AFTER_MINUTES, not before', () => {
    const meta = { ...data.meta, generated: '2026-09-28T18:17Z' };
    const just = today + topbar.STALE_AFTER_MINUTES * 60_000;
    assert.equal(topbar.liveStatusFromMeta(meta, just).kind, 'ok');
    assert.equal(topbar.liveStatusFromMeta(meta, just + 60_000).kind, 'stale');
  });

  it('the banner says since when and what that means; nothing when the data is current', () => {
    assert.equal(
      staleBanner.staleBannerText({ kind: 'stale', generated: '2026-09-28T18:17Z' }, later),
      'We krijgen sinds 20:17 geen nieuwe gegevens. Files en ongelukken van nu zie je misschien niet. Let op de borden langs de weg.',
    );
    assert.match(staleBanner.staleBannerText({ kind: 'error' }, later), /Let op de borden langs de weg\.$/);
    assert.equal(staleBanner.staleBannerText({ kind: 'ok', generated: '2026-09-28T18:17Z' }, later), null);
    assert.equal(staleBanner.staleBannerText({ kind: 'loading' }, later), null);
  });
});
