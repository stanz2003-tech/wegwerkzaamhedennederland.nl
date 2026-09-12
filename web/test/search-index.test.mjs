/**
 * Unit tests for web/src/data/search-index.ts (local matching and ranking) and the pure
 * helpers of web/src/data/index.ts (row → item, per-entity filters, sorting).
 * The PDOK Locatieserver functions are not covered here: they need the network.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dataIndex, searchIndex } from './helpers/src.mjs';

const { normalizeRoadQuery, scoreItem, searchLocal, wktBbox, wktCoords, zoomForPlaceType } = searchIndex;
const { indexItemFromRow, itemsInGemeente, itemsInWoonplaats, itemsOnRoad, rowsToItems, sortIndexItems, splitActive } = dataIndex;

/** Builds a positional IndexRow (see web/src/data/types.ts). */
function row({ id, cat = 'werk', sev = 2, title, road = null, gemeente = null, woonplaats = null, start = '2026-09-09T06:00:00Z', active = 1 }) {
  return [id, cat, null, sev, title, road, road ? 'A' : null, gemeente, woonplaats, 'Utrecht', start, null, 5.1, 52.1, 0, null, active];
}

const ROWS = [
  row({ id: 'a', title: 'A2 · Vinkeveen', road: 'A2', gemeente: 'De Ronde Venen', woonplaats: 'Vinkeveen' }),
  row({ id: 'b', title: 'Croeselaan, Utrecht', gemeente: 'Utrecht', woonplaats: 'Utrecht' }),
  row({ id: 'c', cat: 'file', sev: 3, title: 'A27 · Lunetten', road: 'A27', active: 0, start: '2026-09-20T06:00:00Z' }),
  row({ id: 'd', title: 'Súdwest-Fryslân onderhoud', gemeente: 'Súdwest-Fryslân', woonplaats: 'Bolsward' }),
  row({ id: 'e', title: 'A2 · Den Bosch', road: 'A2', gemeente: "'s-Hertogenbosch", woonplaats: "'s-Hertogenbosch", active: 0, start: '2026-09-11T06:00:00Z' }),
];
const ITEMS = ROWS.map(indexItemFromRow);

describe('indexItemFromRow', () => {
  it('maps every position of the row to its named field', () => {
    const item = indexItemFromRow(['id1', 'afsluiting', 'roadClosed', 4, 'A2 dicht', 'A2', 'A', 'Utrecht', 'Utrecht', 'Utrecht', '2026-09-09T06:00:00Z', '2026-09-09T18:00:00Z', 5.12, 52.09, 1, 'B', 1]);
    assert.deepEqual(item, {
      id: 'id1', cat: 'afsluiting', sub: 'roadClosed', sev: 4, title: 'A2 dicht', road: 'A2', roadType: 'A',
      gemeente: 'Utrecht', woonplaats: 'Utrecht', prov: 'Utrecht', start: '2026-09-09T06:00:00Z',
      end: '2026-09-09T18:00:00Z', lon: 5.12, lat: 52.09, closed: true, hind: 'B', active: true,
    });
  });

  it('rowsToItems skips rows that do not have the right shape', () => {
    assert.equal(rowsToItems([...ROWS, ['te', 'kort'], null, 42]).length, ROWS.length);
  });
});

describe('normalizeRoadQuery', () => {
  it('normalises A/N/S road numbers written in different ways', () => {
    assert.equal(normalizeRoadQuery('a2'), 'A2');
    assert.equal(normalizeRoadQuery('a 2'), 'A2');
    assert.equal(normalizeRoadQuery('A02'), 'A2');
    assert.equal(normalizeRoadQuery('n57'), 'N57');
    assert.equal(normalizeRoadQuery('s100'), 'S100');
    assert.equal(normalizeRoadQuery('E19'), 'E19');
  });

  it('returns null for anything that is not a road number', () => {
    assert.equal(normalizeRoadQuery('breda'), null);
    assert.equal(normalizeRoadQuery('a1234'), null);
    assert.equal(normalizeRoadQuery(''), null);
    // Known limitation: a lower-case E-road is not recognised (the regex misses `e`).
    assert.equal(normalizeRoadQuery('e19'), null);
  });
});

describe('scoreItem', () => {
  const byId = (id) => ITEMS.find((i) => i.id === id);

  it('scores an exact road match highest', () => {
    assert.ok(scoreItem(byId('a'), 'a2') > scoreItem(byId('c'), 'a2'));
    assert.ok(scoreItem(byId('a'), 'a2') >= 100);
  });

  it('accepts a differently written road number', () => {
    for (const q of ['a2', 'a 2', 'A02']) assert.ok(scoreItem(byId('a'), q) >= 100, `road query "${q}"`);
  });

  it('scores an exact place match above a prefix and a prefix above a substring', () => {
    const exact = scoreItem(byId('b'), 'utrecht');
    const prefix = scoreItem(byId('b'), 'croes');
    assert.ok(exact > prefix, `${exact} > ${prefix}`);
  });

  it('matches gemeente and woonplaats without diacritics', () => {
    assert.ok(scoreItem(byId('d'), 'sudwest') > 0);
    assert.ok(scoreItem(byId('d'), 'bolsward') > 0);
  });

  it('gives active items a small bonus over identical inactive ones', () => {
    const active = scoreItem(byId('a'), 'a2');
    const inactive = scoreItem(byId('e'), 'a2');
    assert.equal(active - inactive, 5);
  });

  it('requires every term of a multi-word query', () => {
    assert.ok(scoreItem(byId('e'), 'a2 bosch') > 0);
    assert.equal(scoreItem(byId('e'), 'a2 groningen'), 0);
  });

  it('scores nothing for an empty query or a miss', () => {
    assert.equal(scoreItem(byId('a'), ''), 0);
    assert.equal(scoreItem(byId('a'), '   '), 0);
    assert.equal(scoreItem(byId('a'), 'maastricht'), 0);
  });
});

describe('searchLocal', () => {
  it('needs at least two characters', () => {
    assert.deepEqual(searchLocal(ITEMS, 'a'), []);
    assert.deepEqual(searchLocal(ITEMS, ' '), []);
    assert.ok(searchLocal(ITEMS, 'a2').length > 0);
  });

  it('returns hits sorted by score, highest first', () => {
    const hits = searchLocal(ITEMS, 'a2');
    assert.deepEqual(hits.map((h) => h.id), ['a', 'e', 'c']);
    for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score);
  });

  it('honours the limit', () => {
    assert.equal(searchLocal(ITEMS, 'a2', 2).length, 2);
    assert.equal(searchLocal(ITEMS, 'a2', 1).length, 1);
  });

  it('returns a complete hit object', () => {
    const [hit] = searchLocal(ITEMS, 'vinkeveen');
    assert.equal(hit.kind, 'item');
    assert.equal(hit.id, 'a');
    assert.equal(hit.road, 'A2');
    assert.equal(hit.roadType, 'A');
    assert.equal(hit.woonplaats, 'Vinkeveen');
    assert.equal(hit.cat, 'werk');
    assert.equal(hit.active, true);
    assert.equal(typeof hit.lon, 'number');
    assert.equal(typeof hit.lat, 'number');
  });

  it('returns nothing for a query nobody matches', () => {
    assert.deepEqual(searchLocal(ITEMS, 'zzzz'), []);
  });
});

describe('entity filters and sorting', () => {
  it('filters on road, ignoring how the number is written', () => {
    assert.deepEqual(itemsOnRoad(ITEMS, 'a 2').map((i) => i.id), ['a', 'e']);
    assert.deepEqual(itemsOnRoad(ITEMS, 'A27').map((i) => i.id), ['c']);
    assert.deepEqual(itemsOnRoad(ITEMS, 'A99'), []);
  });

  it('filters on gemeente and woonplaats, case and diacritics insensitive', () => {
    assert.deepEqual(itemsInGemeente(ITEMS, 'utrecht').map((i) => i.id), ['b']);
    assert.deepEqual(itemsInGemeente(ITEMS, 'sudwest-fryslan').map((i) => i.id), ['d']);
    assert.deepEqual(itemsInWoonplaats(ITEMS, 'BOLSWARD').map((i) => i.id), ['d']);
    assert.deepEqual(itemsInWoonplaats(ITEMS, 'Vinkeveen').map((i) => i.id), ['a']);
  });

  it('sorts active items first (impact) and upcoming items by start', () => {
    const sorted = sortIndexItems(ITEMS);
    assert.deepEqual(sorted.map((i) => i.id), ['a', 'b', 'd', 'e', 'c']);
    assert.ok(sorted.slice(0, 3).every((i) => i.active));
  });

  it('splits active from upcoming', () => {
    const { active, upcoming } = splitActive(ITEMS);
    assert.deepEqual(active.map((i) => i.id), ['a', 'b', 'd']);
    assert.deepEqual(upcoming.map((i) => i.id), ['c', 'e']);
  });
});

describe('WKT helpers and zoom levels', () => {
  it('reads coordinate pairs out of a WKT string', () => {
    assert.deepEqual(wktCoords('POINT(5.29 52.13)'), [[5.29, 52.13]]);
    assert.deepEqual(wktCoords('LINESTRING(4.1 51.9,5.2 52.4)'), [[4.1, 51.9], [5.2, 52.4]]);
    assert.deepEqual(wktCoords('POINT(onzin)'), []);
  });

  it('computes a bbox only when there are at least two points', () => {
    assert.deepEqual(wktBbox('LINESTRING(4.1 51.9,5.2 52.4)'), [4.1, 51.9, 5.2, 52.4]);
    assert.equal(wktBbox('POINT(5.29 52.13)'), null);
  });

  it('picks a zoom level per PDOK result type', () => {
    assert.equal(zoomForPlaceType('provincie'), 9);
    assert.equal(zoomForPlaceType('gemeente'), 11);
    assert.equal(zoomForPlaceType('woonplaats'), 12.5);
    assert.equal(zoomForPlaceType('weg'), 14);
    assert.equal(zoomForPlaceType('iets anders'), 12);
  });
});
