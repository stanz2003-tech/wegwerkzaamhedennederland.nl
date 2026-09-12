/** Unit tests for web/src/data/filter.ts (geometry helpers, filtering, sorting). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filter } from './helpers/src.mjs';

const {
  CATEGORY_PRIORITY, SORT_OPTIONS, bboxIntersects, bboxOf, coordsOf, countByCategory, dedupeById,
  filterItems, haversineKm, isSortId, matchesQuery, midpointOf, normalizeRoad, normalizeText,
  padBbox, sameRoad, sortItems, unionBbox,
} = filter;

const NOW = Date.parse('2026-09-09T12:00:00Z');

const POINT = { type: 'Point', coordinates: [4.89707, 52.37403] };
const LINE = { type: 'LineString', coordinates: [[4.9, 52.2], [4.95, 52.16], [5.0, 52.13]] };
const MULTI = {
  type: 'MultiLineString',
  coordinates: [[[5.31, 51.66], [5.35, 51.61]], [[5.39, 51.56], [5.42, 51.52]]],
};

function feature(props, geometry = POINT) {
  const base = {
    id: props.id,
    cat: 'werk',
    sev: 2,
    title: 'Werk aan de weg',
    start: '2026-09-09T06:00:00Z',
    end: '2026-09-09T18:00:00Z',
    src: 'Rijkswaterstaat',
  };
  return { type: 'Feature', id: props.id, geometry, properties: { ...base, ...props } };
}

const ITEMS = [
  feature({ id: 'a', cat: 'werk', sev: 2, road: 'A2', roadType: 'A', title: 'A2 · Vinkeveen', gemeente: 'De Ronde Venen' }, LINE),
  feature({ id: 'b', cat: 'afsluiting', sev: 4, road: 'A2', roadType: 'A', title: 'A2 · rijbaan dicht', closed: true }, MULTI),
  feature({ id: 'c', cat: 'file', sev: 3, road: 'A27', roadType: 'A', title: 'A27 · Lunetten', start: '2026-09-09T11:40:00Z', end: undefined }, LINE),
  feature({ id: 'd', cat: 'werk', sev: 1, title: 'Croeselaan, Utrecht', woonplaats: 'Utrecht', gemeente: 'Utrecht' }, { type: 'Point', coordinates: [5.12142, 52.09074] }),
  feature({ id: 'e', cat: 'werk', sev: 2, title: 'Súdwest-Fryslân onderhoud', gemeente: 'Súdwest-Fryslân', start: '2026-09-20T06:00:00Z', end: '2026-09-22T18:00:00Z' }, { type: 'Point', coordinates: [5.53, 53.06] }),
];

describe('geometry helpers', () => {
  it('flattens coordinates of every supported geometry type', () => {
    assert.deepEqual(coordsOf(POINT), [[4.89707, 52.37403]]);
    assert.equal(coordsOf(LINE).length, 3);
    assert.equal(coordsOf(MULTI).length, 4);
    assert.deepEqual(coordsOf({ type: 'Polygon', coordinates: [] }), []);
  });

  it('computes the bbox of a geometry and null for an empty one', () => {
    assert.deepEqual(bboxOf(POINT), [4.89707, 52.37403, 4.89707, 52.37403]);
    assert.deepEqual(bboxOf(LINE), [4.9, 52.13, 5.0, 52.2]);
    assert.deepEqual(bboxOf(MULTI), [5.31, 51.52, 5.42, 51.66]);
    assert.equal(bboxOf({ type: 'LineString', coordinates: [] }), null);
  });

  it('takes the centre vertex as the midpoint of a line', () => {
    assert.deepEqual(midpointOf(POINT), [4.89707, 52.37403]);
    assert.deepEqual(midpointOf(LINE), [4.95, 52.16]);
    assert.deepEqual(midpointOf(MULTI), [5.39, 51.56]);
    assert.equal(midpointOf({ type: 'LineString', coordinates: [] }), null);
  });

  it('detects bbox intersection, including edge contact', () => {
    assert.equal(bboxIntersects([0, 0, 2, 2], [1, 1, 3, 3]), true);
    assert.equal(bboxIntersects([0, 0, 2, 2], [2, 2, 3, 3]), true);
    assert.equal(bboxIntersects([0, 0, 2, 2], [2.1, 2.1, 3, 3]), false);
  });

  it('unions boxes and pads degenerate ones', () => {
    assert.deepEqual(unionBbox([[1, 1, 2, 2], [3, 0, 4, 5]]), [1, 0, 4, 5]);
    assert.equal(unionBbox([]), null);
    const padded = padBbox([5, 52, 5, 52], 0.01);
    assert.deepEqual(padded.map((n) => Number(n.toFixed(5))), [4.995, 51.995, 5.005, 52.005]);
    assert.deepEqual(padBbox([4, 51, 5, 52], 0.01), [4, 51, 5, 52]);
  });

  it('measures great-circle distance in kilometres', () => {
    const amsterdam = [4.89707, 52.37403];
    const rotterdam = [4.47917, 51.92442];
    assert.ok(Math.abs(haversineKm(amsterdam, rotterdam) - 57.6) < 1.5, 'Amsterdam–Rotterdam ≈ 57.6 km');
    assert.equal(haversineKm(amsterdam, amsterdam), 0);
  });
});

describe('text and road normalisation', () => {
  it('strips diacritics and lower-cases', () => {
    assert.equal(normalizeText('Súdwest-Fryslân'), 'sudwest-fryslan');
    assert.equal(normalizeText("  's-Hertogenbosch "), "'s-hertogenbosch");
    assert.equal(normalizeText('Café Zürich'), 'cafe zurich');
  });

  it('normalises road numbers written in different ways', () => {
    assert.equal(normalizeRoad('a 2'), 'A2');
    assert.equal(normalizeRoad('A02'), 'A2');
    assert.equal(normalizeRoad('a2'), 'A2');
    assert.equal(normalizeRoad('n57'), 'N57');
    assert.equal(normalizeRoad('s100'), 'S100');
    assert.equal(normalizeRoad('Coolsingel'), 'coolsingel');
  });

  it('compares roads through their normalised form', () => {
    assert.equal(sameRoad('A2', 'a 2'), true);
    assert.equal(sameRoad('A02', 'A2'), true);
    assert.equal(sameRoad('A2', 'A20'), false);
    assert.equal(sameRoad(null, 'A2'), false);
    assert.equal(sameRoad('A2', undefined), false);
  });
});

describe('matchesQuery', () => {
  const props = { title: 'A2 · Vinkeveen', road: 'A2', gemeente: 'De Ronde Venen', woonplaats: 'Vinkeveen', prov: 'Utrecht' };

  it('matches on any field and ignores case and diacritics', () => {
    assert.equal(matchesQuery(props, 'vinkeveen'), true);
    assert.equal(matchesQuery(props, 'RONDE'), true);
    assert.equal(matchesQuery(props, 'utrecht'), true);
    assert.equal(matchesQuery({ ...props, gemeente: 'Súdwest-Fryslân' }, 'sudwest'), true);
  });

  it('requires every term of a multi-word query', () => {
    assert.equal(matchesQuery(props, 'a2 vinkeveen'), true);
    assert.equal(matchesQuery(props, 'a2 breda'), false);
  });

  it('matches a differently written road number', () => {
    assert.equal(matchesQuery(props, 'a 2'), true);
  });

  it('an empty query matches everything', () => {
    assert.equal(matchesQuery(props, ''), true);
    assert.equal(matchesQuery(props, '   '), true);
  });
});

describe('filterItems', () => {
  it('filters on categories', () => {
    const out = filterItems(ITEMS, { cats: new Set(['werk']), time: 'nu' }, NOW);
    assert.deepEqual(out.map((f) => f.properties.id), ['a', 'd']);
  });

  it('null categories means all categories', () => {
    const out = filterItems(ITEMS, { cats: null, time: 'nu' }, NOW);
    assert.deepEqual(out.map((f) => f.properties.id), ['a', 'b', 'c', 'd']);
  });

  it('filters on the time window', () => {
    const now = filterItems(ITEMS, { cats: null, time: 'nu' }, NOW).map((f) => f.properties.id);
    const in30 = filterItems(ITEMS, { cats: null, time: '30d' }, NOW).map((f) => f.properties.id);
    assert.equal(now.includes('e'), false);
    assert.equal(in30.includes('e'), true);
  });

  it('filters on the map bounds', () => {
    const utrecht = filterItems(ITEMS, { cats: null, time: 'nu', bounds: [5.05, 52.0, 5.2, 52.15] }, NOW);
    assert.deepEqual(utrecht.map((f) => f.properties.id), ['d']);
  });

  it('filters on the text query', () => {
    const out = filterItems(ITEMS, { cats: null, time: 'nu', query: 'lunetten' }, NOW);
    assert.deepEqual(out.map((f) => f.properties.id), ['c']);
  });

  it('combines category, time, bounds and query', () => {
    const out = filterItems(
      ITEMS,
      { cats: new Set(['werk', 'file']), time: '30d', bounds: [4.8, 52.0, 5.3, 52.3], query: 'utrecht' },
      NOW,
    );
    assert.deepEqual(out.map((f) => f.properties.id), ['d']);
  });

  it('returns an empty list when nothing matches', () => {
    assert.deepEqual(filterItems(ITEMS, { cats: new Set(['brug']), time: 'nu' }, NOW), []);
  });
});

describe('sortItems', () => {
  it('impact sorts on severity, then category priority, then start', () => {
    const out = sortItems(ITEMS, 'impact', null).map((f) => f.properties.id);
    assert.deepEqual(out, ['b', 'c', 'a', 'e', 'd']);
    assert.ok(CATEGORY_PRIORITY.afsluiting < CATEGORY_PRIORITY.werk);
  });

  it('start sorts ascending by start time', () => {
    const out = sortItems(ITEMS, 'start', null).map((f) => f.properties.id);
    assert.equal(out[out.length - 1], 'e');
    assert.equal(out[out.length - 2], 'c');
  });

  it('afstand sorts by distance to the map centre', () => {
    const out = sortItems(ITEMS, 'afstand', [5.12142, 52.09074]).map((f) => f.properties.id);
    assert.equal(out[0], 'd');
    assert.equal(out[out.length - 1], 'e');
  });

  it('afstand without a centre falls back to impact', () => {
    assert.deepEqual(sortItems(ITEMS, 'afstand', null).map((f) => f.properties.id), sortItems(ITEMS, 'impact', null).map((f) => f.properties.id));
  });

  it('does not mutate the input array', () => {
    const before = ITEMS.map((f) => f.properties.id);
    sortItems(ITEMS, 'start', null);
    assert.deepEqual(ITEMS.map((f) => f.properties.id), before);
  });

  it('knows its own sort ids', () => {
    for (const s of SORT_OPTIONS) assert.equal(isSortId(s.id), true);
    assert.equal(isSortId('willekeurig'), false);
    assert.equal(SORT_OPTIONS.length, 3);
  });
});

describe('counting and deduplication', () => {
  it('counts every category, zero included', () => {
    const counts = countByCategory(ITEMS);
    assert.equal(counts.werk, 3);
    assert.equal(counts.afsluiting, 1);
    assert.equal(counts.file, 1);
    assert.equal(counts.brug, 0);
    assert.equal(Object.keys(counts).length, 7);
  });

  it('keeps the first occurrence of a duplicate id', () => {
    const dup = [...ITEMS, feature({ id: 'a', title: 'kopie' })];
    const out = dedupeById(dup);
    assert.equal(out.length, ITEMS.length);
    assert.equal(out.find((f) => f.properties.id === 'a').properties.title, 'A2 · Vinkeveen');
  });
});
