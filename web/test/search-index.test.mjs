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
      // A 17-column (v2) row: no impact data → onbekend, no vehicle groups.
      imp: 'onbekend', veh: null, per: false, spd: null, lc: null,
    });
  });

  it('reads the five v3 positions of a 22-column row', () => {
    const item = indexItemFromRow(['id2', 'werk', 'laneClosures', 2, 'A12 · Duiven', 'A12', 'A', 'Duiven', 'Duiven', 'Gelderland', '2026-09-09T06:00:00Z', null, 6.0, 51.95, 0, 'D', 1, 'hinder', ['lorry'], 1, 90, 1]);
    assert.equal(item.imp, 'hinder');
    assert.deepEqual(item.veh, ['lorry']);
    assert.equal(item.per, true);
    assert.equal(item.spd, 90);
    assert.equal(item.lc, 1);
  });

  it('tolerates garbage in the v3 positions (unknown impact, unknown vehicles, zero lanes)', () => {
    const item = indexItemFromRow(['id3', 'werk', null, 1, 't', null, null, null, null, null, '2026-09-09T06:00:00Z', null, 5, 52, 0, null, 1, 'gesloten', ['tank', 'car'], 0, 0, 0]);
    assert.equal(item.imp, 'onbekend');
    assert.deepEqual(item.veh, ['car']);
    assert.equal(item.per, false);
    assert.equal(item.spd, null);
    assert.equal(item.lc, null);
  });

  it('rowsToItems accepts a mix of 17- and 22-column rows', () => {
    const v2 = ['v2', 'werk', null, 1, 'oud', null, null, null, null, null, '2026-09-09T06:00:00Z', null, 5, 52, 0, null, 1];
    const v3 = [...v2.slice(0, 16), 1, 'geen', null, 0, null, null];
    v3[0] = 'v3';
    const items = rowsToItems([v2, v3]);
    assert.equal(items.length, 2);
    assert.equal(items[0].imp, 'onbekend');
    assert.equal(items[1].imp, 'geen');
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

describe('suggestion order (zoek-4, zoek-5, zoek-8)', () => {
  const { orderOptions, placeHitFromDoc, applyAlias, didYouMeanHits, roadFromName, noResultText } = searchIndex;
  const place = (doc) => placeHitFromDoc({ id: doc.weergavenaam, ...doc });
  const ALMKERK = place({ type: 'woonplaats', weergavenaam: 'Almkerk, Altena, Noord-Brabant', woonplaatsnaam: 'Almkerk', gemeentenaam: 'Altena' });
  const STREET = place({ type: 'weg', weergavenaam: 'Almkerksestraat, Almkerk', gemeentenaam: 'Altena' });
  const almRows = [
    row({ id: 'p1', title: 'Provincialeweg Noord, Almkerk', gemeente: 'Altena', woonplaats: 'Almkerk' }),
    row({ id: 'p2', title: 'Provincialeweg Noord, Almkerk', gemeente: 'Altena', woonplaats: 'Almkerk', active: 0, start: '2026-09-28T05:00:00Z' }),
    row({ id: 'p3', title: 'Provincialeweg Noord, Almkerk', gemeente: 'Altena', woonplaats: 'Almkerk', active: 0, start: '2026-10-05T05:00:00Z' }),
    row({ id: 'p4', title: 'N322 · Almkerk', road: 'N322', gemeente: 'Altena', woonplaats: 'Almkerk' }),
  ].map(indexItemFromRow);
  const kinds = (o) => o.options.map((x) => (x.kind === 'place' ? `place:${x.label}` : x.kind === 'item' ? `item:${x.id}` : x.kind));

  it('reads the place name and gemeente from a PDOK doc, with a fallback on the weergavenaam', () => {
    assert.equal(ALMKERK.label, 'Almkerk');
    assert.equal(ALMKERK.gemeente, 'Altena');
    assert.equal(place({ type: 'gemeente', weergavenaam: 'Gemeente Gorinchem' }).label, 'Gorinchem');
    assert.equal(STREET.label, 'Almkerksestraat, Almkerk');
  });

  it('puts the exact woonplaats before the items, preselects it, and keeps the filter row last', () => {
    const local = searchLocal(almRows, 'almkerk', 5);
    const o = orderOptions({ query: 'Almkerk', road: null, places: [ALMKERK], local, streets: [STREET] });
    assert.equal(kinds(o)[0], 'place:Almkerk');
    assert.equal(o.active, 0);
    assert.equal(o.options.filter((x) => x.kind === 'item').length, 3, 'at most three items');
    assert.equal(o.options.at(-1).kind, 'query');
    // Headings are rows, never options: arrow keys and aria-activedescendant skip them.
    assert.deepEqual(o.rows.filter((r) => r.kind === 'heading').map((r) => r.label), ['Meldingen', 'Straten']);
    assert.equal(o.rows.filter((r) => r.kind === 'option').length, o.options.length);
  });

  it('never merges items that share a label', () => {
    const local = searchLocal(almRows, 'provincialeweg', 5);
    const o = orderOptions({ query: 'provincialeweg', road: null, places: [], local, streets: [] });
    assert.deepEqual(o.options.filter((x) => x.kind === 'item').map((x) => x.id).sort(), ['p1', 'p2', 'p3']);
    // Every hit carries its row, for the verdict pill and the when-text that tell them apart.
    assert.ok(o.options.filter((x) => x.kind === 'item').every((x) => x.item && x.item.id === x.id));
  });

  it('a road number: the road option first and preselected, no "A27, Almere / Baarn …" duplicates', () => {
    const streets = ['A27, Almere', 'A27, Altena', 'A27, Baarn', 'Rijksweg A2, Utrecht', 'A2, Vinkeveen'].map((n) => place({ type: 'weg', weergavenaam: n }));
    const o = orderOptions({ query: 'A27', road: 'A27', places: [], local: searchLocal(ITEMS, 'a27', 5), streets });
    assert.equal(kinds(o)[0], 'road');
    assert.equal(o.active, 0);
    const streetNames = o.options.filter((x) => x.kind === 'place').map((x) => x.name);
    assert.ok(!streetNames.some((n) => roadFromName(n) === 'A27'), streetNames.join(' | '));
    // Other roads stay, but once per road number.
    assert.deepEqual(streetNames, ['Rijksweg A2, Utrecht']);
  });

  it('a place that only contains the query comes after the items; the town before its gemeente', () => {
    const gem = place({ type: 'gemeente', weergavenaam: 'Gemeente Utrecht', gemeentenaam: 'Utrecht', provincienaam: 'Utrecht' });
    const prov = place({ type: 'provincie', weergavenaam: 'Provincie Utrecht', provincienaam: 'Utrecht' });
    const town = place({ type: 'woonplaats', weergavenaam: 'Utrecht, Utrecht, Utrecht', woonplaatsnaam: 'Utrecht', gemeentenaam: 'Utrecht' });
    const heuvelrug = place({ type: 'gemeente', weergavenaam: 'Gemeente Utrechtse Heuvelrug', gemeentenaam: 'Utrechtse Heuvelrug' });
    const nieuw = place({ type: 'woonplaats', weergavenaam: 'Nieuw-Utrecht, X, Y', woonplaatsnaam: 'Nieuw-Utrecht' });
    const o = orderOptions({ query: 'Utrecht', road: null, places: [prov, gem, heuvelrug, town, nieuw], local: searchLocal(ITEMS, 'utrecht', 5), streets: [] });
    assert.deepEqual(kinds(o).slice(0, 4), ['place:Utrecht', 'place:Utrecht', 'place:Utrechtse Heuvelrug', 'place:Utrecht']);
    assert.equal(o.options[0].type, 'woonplaats');
    assert.equal(o.active, 0);
    const iNieuw = kinds(o).indexOf('place:Nieuw-Utrecht');
    assert.ok(iNieuw > kinds(o).lastIndexOf('item:b'), 'after the items');
  });

  it('no hit: "Bedoelde je Gorinchem?" first and preselected, without "Filter de lijst"', () => {
    const fuzzy = [
      place({ type: 'gemeente', weergavenaam: 'Gemeente Gorinchem', gemeentenaam: 'Gorinchem' }),
      place({ type: 'woonplaats', weergavenaam: 'Gorinchem, Gorinchem, Zuid-Holland', woonplaatsnaam: 'Gorinchem', gemeentenaam: 'Gorinchem' }),
      place({ type: 'woonplaats', weergavenaam: 'Dalem, Gorinchem, Zuid-Holland', woonplaatsnaam: 'Dalem', gemeentenaam: 'Gorinchem' }),
    ];
    const o = orderOptions({ query: 'Gorichem', road: null, places: [], local: [], streets: [], fuzzy });
    assert.equal(o.options[0].didYouMean, true);
    assert.equal(o.options[0].type, 'woonplaats', 'the town, not the gemeente PDOK ranked first');
    assert.equal(o.options[0].label, 'Gorinchem');
    assert.equal(o.active, 0);
    assert.ok(!o.options.some((x) => x.kind === 'query'));
    assert.equal(didYouMeanHits([]).length, 0);
  });

  it('nothing at all: an explanatory note and no options', () => {
    const o = orderOptions({ query: 'zzqx', road: null, places: [], local: [], streets: [], fuzzy: [] });
    assert.equal(o.options.length, 0);
    assert.equal(o.active, -1);
    assert.deepEqual(o.rows, [{ kind: 'note', text: noResultText('zzqx') }]);
    assert.equal(noResultText('zzqx'), 'Geen weg of plaats gevonden voor “zzqx”. Probeer een wegnummer (A27, N322) of een plaatsnaam.');
  });

  it('maps the aliases before anything is asked, compared after normalizeText', () => {
    assert.equal(applyAlias('den bosch'), "'s-Hertogenbosch");
    assert.equal(applyAlias('Den  Bosch '), "'s-Hertogenbosch");
    assert.equal(applyAlias('GORKUM'), 'Gorinchem');
    assert.equal(applyAlias('Den Haag'), "'s-Gravenhage");
    assert.equal(applyAlias('Den Helder'), 'Den Helder');
  });
});
