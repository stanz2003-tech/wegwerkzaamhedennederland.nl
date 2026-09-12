import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  bridgeFallbackName,
  canonicalBridgeName,
  createBridgeBook,
  DEFAULT_REGISTRY_PATH,
  disambiguateNames,
  GENERIC_STREET_FUNCTION,
  loadRegistry,
  loadSeen,
  matchVildBridge,
  MAX_OPENINGS,
  metersBetween,
  OPENINGS_DAYS,
  RIS_MATCH_M,
  vildBridges,
} from '../src/bridges.js';
import { assignSlugs, registryEntry } from '../bin/build-bruggen.js';
import { normalizeVildRoad } from '../src/roads.js';
import { loadVild } from '../src/vild.js';
import { slugify } from '../src/slug.js';
import { createVild } from '../src/vild.js';
import { VILD_SAMPLE } from './helpers.js';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const vild = createVild(VILD_SAMPLE);
const tmp = () => mkdtempSync(join(tmpdir(), 'wegwerk-brug-'));

const REGISTRY = {
  version: '2026-09-08',
  bridges: [
    { id: 'NLALK002340557700383', slug: 'leeghwaterbrug', name: 'Leeghwaterbrug', road: 'N242', water: 'Noordhollandsch Kanaal', gemeente: 'Alkmaar', prov: 'Noord-Holland', provCode: 'PV27', lon: 4.76806, lat: 52.61654 },
    { id: 'NLSTILLE00000000001', slug: 'stille-brug', name: 'Stille Brug', gemeente: 'Nergens', lon: 5, lat: 52 },
  ],
};

test('the committed registry loads and a missing file is not fatal', () => {
  const real = loadRegistry(DEFAULT_REGISTRY_PATH);
  assert.ok(Array.isArray(real.bridges));
  assert.ok(real.bridges.length > 100, `only ${real.bridges.length} bridges in the registry`);
  for (const b of real.bridges.slice(0, 50)) {
    assert.equal(typeof b.id, 'string');
    assert.equal(typeof b.slug, 'string');
    assert.equal(typeof b.name, 'string');
    assert.equal(typeof b.lon, 'number');
    assert.equal(typeof b.lat, 'number');
  }
  assert.deepEqual(loadRegistry(join(tmp(), 'nope.json')), { version: '0', bridges: [] });
  const bad = join(tmp(), 'bad.json');
  writeFileSync(bad, '{"bridges": 3}');
  assert.throws(() => loadRegistry(bad), /Invalid bridge registry/);
});

test('RIS-code lookup: registry entry wins over the fallback name', () => {
  const book = createBridgeBook({ registry: REGISTRY, nowMs: NOW, vild });
  book.note({ ris: 'NLALK002340557700383', point: [4.76806, 52.61654], start: iso(NOW + 2 * HOUR), end: iso(NOW + 2 * HOUR + 600000), openNow: false });
  const [entry] = book.build();
  assert.equal(entry.name, 'Leeghwaterbrug');
  assert.equal(entry.slug, 'leeghwaterbrug');
  assert.equal(entry.road, 'N242');
  assert.equal(entry.water, 'Noordhollandsch Kanaal');
  assert.equal(entry.gemeente, 'Alkmaar');
  assert.equal(entry.openNow, false);
  assert.deepEqual(entry.openings, [['2026-09-10T14:00:00Z', '2026-09-10T14:10:00Z']]);
  // key order follows the BridgeEntry contract
  assert.deepEqual(Object.keys(entry), ['id', 'slug', 'name', 'road', 'water', 'gemeente', 'prov', 'lon', 'lat', 'openNow', 'openings']);
});

test('openings: aggregated per bridge, only now + 7 days, sorted, de-duplicated, capped', () => {
  const book = createBridgeBook({ registry: REGISTRY, nowMs: NOW, vild });
  const id = 'NLALK002340557700383';
  const add = (/** @type {number} */ offset) => book.note({ ris: id, point: [4.768, 52.616], start: iso(NOW + offset), end: iso(NOW + offset + 600000), openNow: false });
  add(3 * HOUR);
  add(HOUR);
  add(HOUR); // duplicate
  add(-5 * DAY); // over
  add((OPENINGS_DAYS + 3) * DAY); // beyond the horizon
  for (let i = 0; i < MAX_OPENINGS + 10; i++) add(6 * DAY + i * 60000);
  const [entry] = book.build();
  assert.equal(entry.openings.length, MAX_OPENINGS);
  assert.deepEqual(entry.openings[0], ['2026-09-10T13:00:00Z', '2026-09-10T13:10:00Z']);
  assert.deepEqual(entry.openings[1], ['2026-09-10T15:00:00Z', '2026-09-10T15:10:00Z']);
  for (let i = 1; i < entry.openings.length; i++) assert.ok(entry.openings[i - 1][0] <= entry.openings[i][0], 'not sorted');
});

test('a bridge without openings in the window is dropped unless it is open now', () => {
  const book = createBridgeBook({ registry: REGISTRY, nowMs: NOW, vild });
  book.note({ ris: 'NLALK002340557700383', point: [4.768, 52.616], start: iso(NOW - 5 * DAY), end: iso(NOW - 5 * DAY + 600000), openNow: false });
  assert.deepEqual(book.build(), []);

  const open = createBridgeBook({ registry: REGISTRY, nowMs: NOW, vild });
  open.note({ ris: 'NLSTILLE00000000001', point: [5, 52], start: iso(NOW), openNow: true });
  const built = open.build();
  assert.equal(built.length, 1);
  assert.equal(built[0].openNow, true);
});

test('unknown bridges get a VILD P3.2 name, else the fallback naming rules', () => {
  const book = createBridgeBook({ registry: REGISTRY, nowMs: NOW, vild });
  // 7031 is a P3.2 row: name1 "Eembrug", road "A1", water "Eem"
  book.note({ ris: 'NLNEW0000000000000A', point: [5.3081, 52.2187], alertC: '7031', start: iso(NOW + HOUR), openNow: false });
  // no AlertC: fall back to the geocoded street and place
  book.note({ ris: 'NLNEW0000000000000B', point: [4.9, 52.3], start: iso(NOW + HOUR), openNow: false });
  // nothing at all
  book.note({ ris: 'NLNEW0000000000000C', point: [4.7, 52.1], start: iso(NOW + HOUR), openNow: false });
  const places = {
    '4.9,52.3': { straat: 'Amstelveenseweg', woonplaats: 'Amsterdam', gemeente: 'Amsterdam', prov: 'Noord-Holland' },
  };
  const built = book.build((lon, lat) => places[`${lon},${lat}`]);
  const byId = Object.fromEntries(built.map((b) => [b.id, b]));
  assert.equal(byId['NLNEW0000000000000A'].name, 'Eembrug');
  assert.equal(byId['NLNEW0000000000000A'].road, 'A1');
  assert.equal(byId['NLNEW0000000000000A'].water, 'Eem');
  assert.equal(byId['NLNEW0000000000000A'].slug, 'eembrug-000a');
  assert.equal(byId['NLNEW0000000000000B'].name, 'Brug Amstelveenseweg, Amsterdam');
  assert.equal(byId['NLNEW0000000000000B'].woonplaats, 'Amsterdam');
  assert.equal(byId['NLNEW0000000000000B'].slug, 'brug-amstelveenseweg-amsterdam-000b');
  assert.equal(byId['NLNEW0000000000000C'].name, 'Brug NLNEW0000000000000C');
  // coordinates are rounded to 5 decimals
  assert.equal(byId['NLNEW0000000000000A'].lon, 5.3081);
});

test('the seen cache grows with unseen ids and keeps firstSeen for known ones', () => {
  const dir = tmp();
  const seenPath = join(dir, 'bruggen-seen.json');
  writeFileSync(
    seenPath,
    JSON.stringify([{ id: 'NLALK002340557700383', lon: 4.768, lat: 52.616, firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-01-02T00:00:00Z' }]),
  );
  const book = createBridgeBook({ registry: REGISTRY, seenPath, nowMs: NOW, vild });
  book.note({ ris: 'NLALK002340557700383', point: [4.768, 52.616], alertC: '3460', start: iso(NOW + HOUR), openNow: false });
  book.note({ ris: 'NLNEW0000000000000A', point: [5.30814321, 52.21871234], alertC: '7031', start: iso(NOW + HOUR), openNow: false });
  book.note({ ris: 'NLNEW0000000000000A', point: [5.3081, 52.2187], start: iso(NOW + 2 * HOUR), openNow: false }); // same bridge again
  assert.equal(book.saveSeen(), 1, 'exactly one new id');

  const seen = loadSeen(seenPath);
  assert.deepEqual(seen.map((s) => s.id), ['NLALK002340557700383', 'NLNEW0000000000000A']);
  const known = seen[0];
  assert.equal(known.firstSeen, '2026-01-01T00:00:00Z', 'firstSeen is never overwritten');
  assert.equal(known.lastSeen, new Date(NOW).toISOString());
  assert.equal(known.alertC, '3460', 'a newly observed AlertC code is filled in');
  const fresh = seen[1];
  assert.equal(fresh.firstSeen, new Date(NOW).toISOString());
  assert.equal(fresh.lon, 5.30814, 'coordinates rounded to 5 decimals');
  assert.equal(fresh.alertC, '7031');
  assert.equal(book.newSeen(), 1);

  // an unreadable or missing cache is not fatal
  writeFileSync(seenPath, 'not json');
  assert.deepEqual(loadSeen(seenPath), []);
  assert.deepEqual(loadSeen(join(dir, 'missing.json')), []);
  // without a path nothing is written
  const noPath = createBridgeBook({ registry: REGISTRY, nowMs: NOW, vild });
  assert.equal(noPath.saveSeen(), 0);
  assert.equal(existsSync(join(dir, 'nothing.json')), false);
});

test('entries are sorted by id and the observed map is exposed for geocoding', () => {
  const book = createBridgeBook({ registry: REGISTRY, nowMs: NOW, vild });
  for (const id of ['NLZZZ0000000000000Z', 'NLAAA0000000000000A', 'NLMMM0000000000000M']) {
    book.note({ ris: id, point: [5, 52], start: iso(NOW + HOUR), openNow: false });
  }
  assert.deepEqual(book.build().map((b) => b.id), ['NLAAA0000000000000A', 'NLMMM0000000000000M', 'NLZZZ0000000000000Z']);
  assert.equal(book.observed.size, 3);
  assert.equal(book.registrySize, 2);
  assert.deepEqual([...book.observed.values()][0], { lon: 5, lat: 52, alertC: undefined, openNow: false, openings: [{ start: iso(NOW + HOUR), end: undefined }] });
});

test('the seen-cache file is one JSON object per line (small diffs when committed)', () => {
  const seenPath = join(tmp(), 'bruggen-seen.json');
  const book = createBridgeBook({ registry: REGISTRY, seenPath, nowMs: NOW, vild });
  book.note({ ris: 'NLAAA0000000000000A', point: [5, 52], start: iso(NOW), openNow: true });
  book.note({ ris: 'NLBBB0000000000000B', point: [5, 52], start: iso(NOW), openNow: true });
  book.saveSeen();
  const text = readFileSync(seenPath, 'utf8');
  assert.equal(text.trim().split('\n').length, 2);
  assert.equal(JSON.parse(text).length, 2);
});

// ---------------------------------------------------------------------------
// Naming rules (bug: 104 of 108 names were reverse-geocoded fallbacks, several
// of them nonsense). Every input below is a real string from the old registry.
// ---------------------------------------------------------------------------

test('a street that already ends in brug/burg/sluis becomes the name itself', () => {
  // was "Brug in de Ringersbrug bij Alkmaar"
  assert.equal(bridgeFallbackName({ id: 'NLALK002340558400407', street: 'Ringersbrug', place: 'Alkmaar' }), 'Ringersbrug, Alkmaar');
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Vlielandbrug', place: 'Alkmaar' }), 'Vlielandbrug, Alkmaar');
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Koedijkervlotbrug', place: 'Alkmaar' }), 'Koedijkervlotbrug, Alkmaar');
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Julianasluis', place: 'Gouda' }), 'Julianasluis, Gouda');
  // an inventory number after the street name is not part of the name
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Kinkerbrug 0266', place: 'Amsterdam' }), 'Kinkerbrug, Amsterdam');
  // without a place the bare street name is still a fine name
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Ringersbrug' }), 'Ringersbrug');
  // never "Brug in de <X>brug"
  for (const street of ['Ringersbrug', 'Vlielandbrug', 'Koedijkervlotbrug']) {
    assert.ok(!/^Brug in de/.test(bridgeFallbackName({ id: 'X', street, place: 'Alkmaar' })));
  }
});

test('generic street types are named by function, never "Brug in de Fietspad"', () => {
  // was "Brug in de Fietspad bij Alkmaar"
  assert.equal(bridgeFallbackName({ id: 'NLALK002340559000415', street: 'Fietspad', place: 'Alkmaar' }), 'Fietsbrug bij Alkmaar');
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Voetpad', place: 'Alkmaar' }), 'Voetgangersbrug bij Alkmaar');
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Parallelweg', place: 'Alkmaar' }), 'Brug bij Alkmaar');
  assert.equal(bridgeFallbackName({ id: 'X', street: 'busbaan', place: 'Utrecht' }), 'Busbrug bij Utrecht');
  for (const street of Object.keys(GENERIC_STREET_FUNCTION)) {
    const name = bridgeFallbackName({ id: 'X', street, place: 'Alkmaar' });
    assert.ok(!new RegExp(street, 'i').test(name), `${street} leaked into "${name}"`);
    assert.ok(!/^Brug in de/.test(name), name);
  }
});

test('any other street reads as "Brug <straat>, <plaats>" (no de/het guessing)', () => {
  // was "Brug in de Noordveenweg bij Weteringbrug"
  assert.equal(bridgeFallbackName({ id: 'NLABE002010537100018', street: 'Noordveenweg', place: 'Weteringbrug' }), 'Brug Noordveenweg, Weteringbrug');
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Houtmankade', place: 'Amsterdam' }), 'Brug Houtmankade, Amsterdam');
  assert.equal(bridgeFallbackName({ id: 'X', street: 'Van Hallstraat' }), 'Brug Van Hallstraat');
  // a road number is more identifying than a street and keeps the documented form
  assert.equal(bridgeFallbackName({ id: 'X', road: 'N231', place: 'Aalsmeer', street: 'Parallelweg' }), 'Brug in de N231 bij Aalsmeer');
  assert.equal(bridgeFallbackName({ id: 'X', road: 'N231' }), 'Brug in de N231');
  // last resorts
  assert.equal(bridgeFallbackName({ id: 'X', place: 'Alkmaar' }), 'Brug bij Alkmaar');
  assert.equal(bridgeFallbackName({ id: 'NLXYZ' }), 'Brug NLXYZ');
});

test('canonicalBridgeName keeps the source spelling out of the title only', () => {
  // the VILD water name "Zuid-Willlemsvaart" is a source typo: the title uses a
  // clean canonical spelling, the `water` field keeps the source spelling
  assert.equal(canonicalBridgeName('brug over de Zuid-Willlemsvaart'), 'Brug over de Zuid-Willemsvaart');
  assert.equal(canonicalBridgeName('brug over het Noordhollands Kanaal'), 'Brug over het Noordhollands Kanaal');
  assert.equal(canonicalBridgeName('  Eembrug  '), 'Eembrug');
  assert.equal(canonicalBridgeName('IJsselbrug'), 'IJsselbrug');
  assert.equal(canonicalBridgeName(''), undefined);
  assert.equal(canonicalBridgeName(undefined), undefined);
  const vild = loadVild();
  const water = [...vild.rows()].find((r) => r.nr === '29137');
  assert.equal(water.name2, 'Zuid-Willlemsvaart', 'the source spelling must not be edited in vild.json');
});

test('colliding names are disambiguated deterministically, never with a hash', () => {
  // tier 1, the place — reads as "bij X" because the page title template
  // already appends "({road or woonplaats})"
  const places = [
    { id: 'VILD-7031', name: 'Eembrug', road: 'A1', woonplaats: 'Baarn' },
    { id: 'VILD-10692', name: 'Eembrug', road: 'N199', woonplaats: 'Amersfoort' },
  ];
  disambiguateNames(places);
  assert.deepEqual(Object.fromEntries(places.map((b) => [b.id, b.name])), {
    'VILD-7031': 'Eembrug bij Baarn',
    'VILD-10692': 'Eembrug bij Amersfoort',
  });
  for (const b of places) assert.ok(!/\)\s*$/.test(b.name), `${b.name} would give the page title two brackets`);

  // tier 2, the road — five "Maasbrug" bridges in five different places would
  // still be ambiguous if two shared a gemeente
  const roads = [
    { id: 'M', name: 'Maasbrug', road: 'A2', gemeente: 'Den Bosch' },
    { id: 'N', name: 'Maasbrug', road: 'A50', gemeente: 'Den Bosch' },
  ];
  disambiguateNames(roads);
  assert.deepEqual(roads.map((b) => b.name), ['Maasbrug (A2)', 'Maasbrug (A50)']);

  // tier 3, the street
  const streets = [
    { id: 'A', name: 'Prinsenbrug', woonplaats: 'Haarlem', street: 'Oudeweg' },
    { id: 'B', name: 'Prinsenbrug', woonplaats: 'Haarlem', street: 'Friese Varkenmarkt' },
  ];
  disambiguateNames(streets);
  assert.deepEqual(streets.map((b) => b.name), ['Prinsenbrug (Oudeweg)', 'Prinsenbrug (Friese Varkenmarkt)']);

  // a hint that only repeats the name explains nothing, so that tier is skipped
  const repeats = [
    { id: 'A', name: 'Sontbrug', woonplaats: 'Groningen', street: 'Sontbrug' },
    { id: 'B', name: 'Sontbrug', woonplaats: 'Groningen', street: 'Eltjo Ruggeweg' },
  ];
  disambiguateNames(repeats);
  assert.deepEqual(repeats.map((b) => b.name), ['Sontbrug', 'Sontbrug (2)']);

  // nothing separates them: the first in id order keeps the plain name and the
  // rest get a stable ordinal — never a hash
  const same = [
    { id: 'B', name: 'Fietsbrug bij Alkmaar', woonplaats: 'Alkmaar', street: 'Fietspad' },
    { id: 'A', name: 'Fietsbrug bij Alkmaar', woonplaats: 'Alkmaar', street: 'Fietspad' },
  ];
  disambiguateNames(same);
  assert.deepEqual(same.map((b) => `${b.id}=${b.name}`).sort(), ['A=Fietsbrug bij Alkmaar', 'B=Fietsbrug bij Alkmaar (2)']);
  // a unique name is untouched
  const unique = [{ id: 'S', name: 'Leeghwaterbrug', road: 'N242' }];
  disambiguateNames(unique);
  assert.equal(unique[0].name, 'Leeghwaterbrug');
  for (const b of [...places, ...roads, ...streets, ...repeats, ...same]) assert.ok(!/[0-9a-f]{6}/.test(b.name), `looks like a hash: ${b.name}`);
});

// ---------------------------------------------------------------------------
// The VILD merge: every P3.2 bridge deserves a page, RIS ids supply openings.
// ---------------------------------------------------------------------------

test('the VILD table yields every named P3.2 bridge, folded per physical bridge', () => {
  const table = vildBridges(loadVild(), normalizeVildRoad);
  assert.ok(table.length > 340, `only ${table.length} VILD bridges`);
  assert.ok(table.length <= 364, `more bridges than P3.2 rows: ${table.length}`);
  for (const b of table) {
    assert.ok(b.name.length > 0);
    assert.match(b.id, /^VILD-\d+$/);
    assert.equal(typeof b.lon, 'number');
    assert.equal(typeof b.lat, 'number');
    assert.ok(b.road === undefined || /^[ANEs]\d/.test(b.road), `bad road ${b.road}`);
  }
  // the two carriageway rows of the Galecopperbrug (A12 / "A12 hrb") are one bridge
  const galecopper = table.filter((b) => b.name === 'Galecopperbrug');
  assert.equal(galecopper.length, 1, 'A12 hrb should fold into A12');
  assert.equal(galecopper[0].nrs.length, 2);
  assert.equal(galecopper[0].water, 'Amsterdam-Rijnkanaal');
  // ids are unique
  assert.equal(new Set(table.map((b) => b.id)).size, table.length);
});

test('a VILD bridge matches a RIS bridge on proximity plus road agreement', () => {
  const table = [
    { id: 'VILD-1', nr: '1', nrs: ['1'], name: 'Galecopperbrug', road: 'A12', water: 'Amsterdam-Rijnkanaal', lon: 5.09733, lat: 52.06072 },
    { id: 'VILD-2', nr: '2', nrs: ['2'], name: 'Andere brug', road: 'N231', lon: 4.81012, lat: 52.30553 },
  ];
  // same spot, same road → match
  const hit = matchVildBridge(table, { lon: 5.0974, lat: 52.0607, road: 'A12' });
  assert.equal(hit.bridge.id, 'VILD-1');
  assert.ok(hit.m < 20, `${hit.m} m`);
  // same spot, contradicting road → no match
  assert.equal(matchVildBridge(table, { lon: 5.0974, lat: 52.0607, road: 'A2' }), undefined);
  // same road, too far away → no match
  assert.equal(matchVildBridge(table, { lon: 5.104, lat: 52.06072, road: 'A12' }), undefined);
  // an unknown road on either side is no contradiction
  assert.equal(matchVildBridge(table, { lon: 5.09733, lat: 52.06072 }).bridge.id, 'VILD-1');
  // the threshold is metres and the distance helper agrees with it
  assert.ok(metersBetween({ lon: 5, lat: 52 }, { lon: 5.00218, lat: 52 }) < RIS_MATCH_M);
  assert.ok(metersBetween({ lon: 5, lat: 52 }, { lon: 5.0025, lat: 52 }) > RIS_MATCH_M);
});

test('registryEntry: VILD name wins, road/water come along, place from the geocoder', () => {
  const vildBridge = { id: 'VILD-7290', nr: '7290', nrs: ['7290'], name: 'Galecopperbrug', road: 'A12', water: 'Amsterdam-Rijnkanaal', lon: 5.09733, lat: 52.06072 };
  const entry = registryEntry({
    obs: { id: 'NLUTR000000000000001', lon: 5.0973, lat: 52.0607 },
    vild: vildBridge,
    geo: { straat: 'Rijksweg A12', woonplaats: 'Utrecht', gemeente: 'Utrecht', prov: 'Utrecht', at: '2026-09-09T00:00:00Z' },
  });
  assert.equal(entry.name, 'Galecopperbrug');
  assert.equal(entry.road, 'A12');
  assert.equal(entry.water, 'Amsterdam-Rijnkanaal');
  assert.equal(entry.woonplaats, 'Utrecht');
  assert.equal(entry.provCode, 'PV26');

  // no VILD match → the fallback rules, and a bad old name is repaired
  const repaired = registryEntry({
    obs: { id: 'NLALK002340558400407', lon: 4.75003, lat: 52.63361 },
    geo: { straat: 'Ringersbrug', woonplaats: 'Alkmaar', gemeente: 'Alkmaar', prov: 'Noord-Holland', at: '2026-09-09T00:00:00Z' },
    existing: { id: 'NLALK002340558400407', slug: 'brug-in-de-ringersbrug-bij-alkmaar', name: 'Brug in de Ringersbrug bij Alkmaar', lon: 4.75003, lat: 52.63361 },
  });
  assert.equal(repaired.name, 'Ringersbrug, Alkmaar');
  assert.equal(repaired.slug, 'brug-in-de-ringersbrug-bij-alkmaar', 'the indexed slug survives the rename');
});

test('slugs of bridges already in the registry are frozen, new ones stay unique', () => {
  const bridges = [
    { id: 'NLALK002340558400407', name: 'Ringersbrug, Alkmaar', woonplaats: 'Alkmaar' },
    { id: 'VILD-7290', name: 'Galecopperbrug', woonplaats: 'Utrecht' },
    { id: 'VILD-7291', name: 'Galecopperbrug', woonplaats: 'Nieuwegein' },
    { id: 'VILD-7292', name: 'Galecopperbrug', woonplaats: 'Nieuwegein' },
  ];
  const frozen = new Map([['NLALK002340558400407', 'brug-in-de-ringersbrug-bij-alkmaar']]);
  assignSlugs(bridges, frozen);
  assert.equal(bridges[0].slug, 'brug-in-de-ringersbrug-bij-alkmaar', 'indexed URL kept');
  assert.equal(bridges[1].slug, 'galecopperbrug-utrecht');
  assert.equal(bridges[2].slug, 'galecopperbrug-nieuwegein');
  assert.equal(bridges[3].slug, 'galecopperbrug-nieuwegein-7292');
  assert.equal(new Set(bridges.map((b) => b.slug)).size, bridges.length, 'slugs must be unique');
  for (const b of bridges) assert.equal(b.slug, slugify(b.slug), 'slug must be slugify()-stable');
});

test('the committed registry: every slug unique and stable, no nonsense names', () => {
  const { bridges } = loadRegistry(DEFAULT_REGISTRY_PATH);
  assert.equal(new Set(bridges.map((b) => b.slug)).size, bridges.length, 'duplicate slugs');
  assert.equal(new Set(bridges.map((b) => b.id)).size, bridges.length, 'duplicate ids');
  for (const b of bridges) {
    assert.equal(b.slug, slugify(b.slug), `${b.slug} is not slugify()-stable`);
    assert.ok(!/^Brug in de \S*(brug|burg|sluis)\b/i.test(b.name), `double bridge in "${b.name}"`);
    assert.ok(!/^Brug in de (Fiets|Voet|Wandel|Loop|Ruiter)pad/i.test(b.name), `broken grammar in "${b.name}"`);
    assert.ok(!/lll|nnn|ttt/i.test(b.name), `uncorrected typo in "${b.name}"`);
  }
});
