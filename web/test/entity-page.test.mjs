/**
 * Regression tests for the generated entity pages (/weg/…, /gemeente/…, /plaats/…, /brug/…):
 *
 *  1. they now rank with the shared `compareByImpact` from data/filter.ts, so a closure that
 *     starts tonight beats a width restriction that has been standing since 2019 — the entity
 *     pages used to sort on raw severity and put the multi-year measures on top;
 *  2. their small map draws the real LineString geometry of its items instead of the
 *     representative point of every index row (data/entity-geometry.ts).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entity, entityGeometry, filter, time } from './helpers/src.mjs';

const { compareImpact, compareStart, splitForEntity, mapFeatures } = entity;
const { hasLineGeometry, neededCollections, pickByIds } = entityGeometry;
const { compareByImpact } = filter;
const { MS } = time;

const NOW = Date.parse('2026-09-09T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/** An index row as `rowsToItems` produces it. */
function row(id, over = {}) {
  return {
    id,
    cat: 'werk',
    sub: null,
    sev: 2,
    title: id,
    road: 'A2',
    roadType: 'A',
    gemeente: 'Utrecht',
    woonplaats: 'Utrecht',
    prov: 'Utrecht',
    start: iso(NOW - MS.hour),
    end: iso(NOW + MS.hour),
    lon: 5.1,
    lat: 52.09,
    closed: false,
    hind: null,
    active: true,
    ...over,
  };
}

describe('entity pages rank like the map list', () => {
  const tonight = row('vannacht-dicht', {
    cat: 'afsluiting',
    sev: 2,
    closed: true,
    start: iso(NOW + 8 * MS.hour),
    end: iso(NOW + 16 * MS.hour),
    active: true,
  });
  const semiPermanent = row('breedtebeperking', {
    cat: 'afsluiting',
    sev: 4,
    start: iso(Date.parse('2019-06-01T00:00:00Z')),
    end: iso(Date.parse('2031-05-31T22:00:00Z')),
    active: true,
  });

  it('delegates to the shared comparator once both items are active', () => {
    assert.equal(
      Math.sign(compareImpact(tonight, semiPermanent, NOW)),
      Math.sign(compareByImpact(tonight, semiPermanent, NOW)),
    );
  });

  it('puts the measure that changes tonight above the years-old one, despite lower severity', () => {
    assert.ok(compareImpact(tonight, semiPermanent, NOW) < 0);
    assert.deepEqual([semiPermanent, tonight].sort((a, b) => compareImpact(a, b, NOW)).map((i) => i.id), [
      'vannacht-dicht',
      'breedtebeperking',
    ]);
  });

  it('still keeps what the pipeline marked active above what is only planned', () => {
    const planned = row('gepland', { sev: 4, active: false, start: iso(NOW + 3 * MS.day), end: iso(NOW + 4 * MS.day) });
    assert.ok(compareImpact(tonight, planned, NOW) < 0);
  });

  it('sorts the two sections of splitForEntity by impact and by start', () => {
    const items = [semiPermanent, tonight, row('over-drie-dagen', { active: false, start: iso(NOW + 3 * MS.day), end: iso(NOW + 4 * MS.day) }), row('morgen', { active: false, start: iso(NOW + MS.day), end: iso(NOW + 2 * MS.day) }), row('afgelopen', { active: false, start: iso(NOW - 3 * MS.day), end: iso(NOW - MS.day) })];
    const { active, upcoming } = splitForEntity(items, NOW);
    assert.deepEqual(active.map((i) => i.id), ['vannacht-dicht', 'breedtebeperking']);
    assert.deepEqual(upcoming.map((i) => i.id), ['morgen', 'over-drie-dagen'], 'ended items are dropped');
  });

  it('leaves compareStart as the order of the planned section', () => {
    const a = row('a', { active: false, start: iso(NOW + MS.day) });
    const b = row('b', { active: false, start: iso(NOW + 2 * MS.day) });
    assert.ok(compareStart(a, b) < 0);
  });

  it('defaults `now` so existing callers keep working', () => {
    assert.equal(typeof compareImpact(tonight, semiPermanent), 'number');
  });
});

describe('entity maps load the real geometry of their own items', () => {
  const point = (id) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [5.1, 52.09] }, properties: { id, cat: 'werk', sev: 2, title: id, start: iso(NOW), src: 'x' } });
  const lineFeature = (id) => ({
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates: [[4.94063, 52.20115], [5.02891, 52.09984]] },
    properties: { id, cat: 'werk', sev: 2, title: id, start: iso(NOW), src: 'x' },
  });

  it('asks only for the collections the page actually needs', () => {
    assert.deepEqual(neededCollections([]), { actueel: false, live: false, gepland: false });
    assert.deepEqual(neededCollections([row('a')]), { actueel: true, live: false, gepland: false });
    assert.deepEqual(neededCollections([row('c', { cat: 'file' })]), { actueel: false, live: true, gepland: false });
  });

  it('never downloads the planned collection for a page map unless asked', () => {
    // werk-gepland is ≈ 1.15 MB gzipped: too much for the small map of a page a visitor may reach
    // straight from a search engine. Planned items keep their index point instead.
    const planned = row('b', { active: false });
    assert.deepEqual(neededCollections([planned]), { actueel: false, live: false, gepland: false });
    assert.deepEqual(neededCollections([planned], { includePlanned: true }), {
      actueel: false,
      live: false,
      gepland: true,
    });
    assert.deepEqual(neededCollections([row('d', { cat: 'brug' }), planned]), {
      actueel: false,
      live: true,
      gepland: false,
    });
  });

  it('keeps only the features of this page, once each', () => {
    const ids = new Set(['a', 'b']);
    const picked = pickByIds([lineFeature('a'), point('z'), lineFeature('b'), point('a')], ids);
    assert.deepEqual(picked.map((f) => f.properties.id), ['a', 'b']);
    assert.equal(picked[0].geometry.type, 'LineString');
  });

  it('recognises the geometry an index row could never express', () => {
    assert.equal(hasLineGeometry(lineFeature('a')), true);
    assert.equal(hasLineGeometry(point('a')), false);
    assert.equal(
      hasLineGeometry({ ...lineFeature('a'), geometry: { type: 'MultiLineString', coordinates: [[[5, 52], [5.1, 52.1]]] } }),
      true,
    );
  });

  it('replaces the index point with the real line for the same id', () => {
    const items = [row('a'), row('b')];
    const before = mapFeatures(items);
    assert.deepEqual(before.map((f) => f.geometry.type), ['Point', 'Point']);
    const after = mapFeatures(items, [lineFeature('a')]);
    assert.deepEqual(after.map((f) => f.geometry.type), ['LineString', 'Point']);
    assert.equal(after.filter((f) => hasLineGeometry(f)).length, 1);
  });

  it('never adds a feature the page does not show', () => {
    const items = [row('a')];
    const after = mapFeatures(items, [lineFeature('a'), lineFeature('elders')]);
    assert.deepEqual(after.map((f) => f.properties.id), ['a']);
  });
});
