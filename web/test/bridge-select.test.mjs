/**
 * The item selection of a road bridge's page (data/bridge-select.ts) and its safety: the bridge
 * page must never say someone can pass when they cannot. The answer itself is the unchanged
 * answer code; these tests pin down which meldingen reach it, and that the answer over them is
 * never lighter than the heaviest of them.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fixtureFiles, readJson } from './helpers/fixtures.mjs';
import { answer as answerMod, bridgeSelect, entityPages, forecast, searchIndex, verdict } from './helpers/src.mjs';

const { bridgeMatch, bridgeProfile, bridgeSubject, bridgeWithArticle, distanceToGeometryKm, selectBridgeItems, textNamesRoad, coreBridgeName } = bridgeSelect;
const { answerFor } = answerMod;
const { dayStrip, itemVerdict } = forecast;
const { VERDICT_SEVERITY } = verdict;

const NOW = Date.parse('2026-11-04T12:00:00Z');
const MODES = ['auto', 'vracht', 'fiets'];
const rank = (level) => VERDICT_SEVERITY.indexOf(level);

// The real registry entry: A27 over de Merwede at Gorinchem.
const MERWEDE = { slug: 'merwedebrug-bij-gorinchem', name: 'Merwedebrug bij Gorinchem', road: 'A27', lon: 4.94241, lat: 51.8273 };
const profile = bridgeProfile(MERWEDE);

/** Degrees per km at this latitude, to place test geometry. */
const KM_LAT = 1 / 110.574;
const KM_LON = 1 / (111.32 * Math.cos((51.8273 * Math.PI) / 180));
const at = (dxKm, dyKm) => [MERWEDE.lon + dxKm * KM_LON, MERWEDE.lat + dyKm * KM_LAT];

let seq = 0;
function item({ road = 'A27', title = 'A27 · Gorinchem → Werkendam', imp = 'dicht', geometry, desc, from, to, veh } = {}) {
  seq += 1;
  return {
    f: {
      type: 'Feature',
      geometry: geometry ?? { type: 'Point', coordinates: at(0, 0) },
      properties: {
        id: `t${seq}`,
        cat: 'afsluiting',
        sev: 3,
        title,
        start: '2026-11-04T06:00:00Z',
        end: '2026-11-06T06:00:00Z',
        src: 'NDW',
        imp,
        ...(road ? { road } : {}),
        ...(veh ? { veh } : {}),
      },
    },
    d: { id: `t${seq}`, ...(desc ? { desc } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) },
  };
}

describe('which meldingen count for a road bridge', () => {
  it('a closure whose line runs straight over the bridge counts, though its vertices are kilometres away', () => {
    const line = { type: 'LineString', coordinates: [at(0, 3), at(0, -3)] };
    assert.equal(distanceToGeometryKm(line, profile.point), 0);
    const closure = item({ geometry: line });
    assert.equal(bridgeMatch(closure, profile), 'afstand');
    assert.deepEqual(selectBridgeItems([closure], profile), [closure]);
  });

  it('work just before or after the bridge on its road counts; further away it does not', () => {
    const before = item({ geometry: { type: 'LineString', coordinates: [at(0, 1.0), at(0, 2.5)] } });
    const far = item({ geometry: { type: 'LineString', coordinates: [at(0, 4), at(0, 8)] } });
    assert.equal(bridgeMatch(before, profile), 'afstand');
    assert.equal(bridgeMatch(far, profile), null);
  });

  it('a melding on the road that names the bridge or an alias counts, also outside the radius', () => {
    const named = item({ title: 'A27 · Werkendam → Merwedebrug', geometry: { type: 'Point', coordinates: at(0, -6) } });
    const alias = item({ title: 'A27 · Hooipolder', desc: 'Afsluiting bij de Gorkumse brug wegens inspectie', geometry: { type: 'Point', coordinates: at(0, -5) } });
    assert.equal(bridgeMatch(named, profile), 'naam');
    assert.equal(bridgeMatch(alias, profile), 'naam');
    // …but not a namesake far down the same road.
    const namesake = item({ title: 'A27 · Merwedebrug', geometry: { type: 'Point', coordinates: at(0, 40) } });
    assert.equal(bridgeMatch(namesake, profile), null);
  });

  it('a melding on another road number does not count, however close or however named', () => {
    const parallel = item({ road: 'N216', title: 'N216 · Gorinchem', geometry: { type: 'Point', coordinates: at(0.9, 0) } });
    const farOther = item({ road: 'A15', title: 'A15 · Gorinchem → Sleeuwijk', geometry: { type: 'Point', coordinates: at(5, 20) } });
    const namedOther = item({ road: 'N3', title: 'N3 · Merwedebrug', geometry: { type: 'Point', coordinates: at(0.5, 0) } });
    assert.deepEqual(selectBridgeItems([parallel, farOther, namedOther], profile), []);
  });

  it('without a road number, distance alone is not enough: the name or the road number decides', () => {
    const street = item({ road: null, title: 'Van Gochstraat, Gorinchem', geometry: { type: 'Point', coordinates: at(0.4, 0.3) } });
    const fietspad = item({ road: null, title: 'Afsluiting fietspad Merwedebrug westzijde, Gorinchem', geometry: { type: 'Point', coordinates: at(0.1, 0.2) } });
    const motorway = item({ road: null, title: 'A27, Gorinchem', geometry: { type: 'Point', coordinates: at(0.2, 0.5) } });
    const papendrecht = item({ road: null, title: 'Merwedebrug, Papendrecht', geometry: { type: 'Point', coordinates: at(-16, 0) } });
    assert.equal(bridgeMatch(street, profile), null);
    assert.equal(bridgeMatch(fietspad, profile), 'naam');
    assert.equal(bridgeMatch(motorway, profile), 'afstand');
    assert.equal(bridgeMatch(papendrecht, profile), null);
  });

  it('each melding once, in input order', () => {
    const a = item();
    const b = item({ title: 'A27 · Werkendam → Gorinchem' });
    assert.deepEqual(selectBridgeItems([a, b, a], profile).map((x) => x.f.properties.id), [a.f.properties.id, b.f.properties.id]);
  });

  it('long bridges get their own radius; the names come from bridge-aliases.json', () => {
    assert.equal(profile.radiusKm, 1.2);
    assert.deepEqual(profile.aliases, ['Gorkumse brug', 'Gorinchemse brug', 'Merwedebrug A27']);
    assert.ok(profile.terms.includes('merwedebrug'));
    assert.equal(bridgeProfile({ slug: 'zeelandbrug', name: 'Zeelandbrug', road: 'N256', lon: 3.89, lat: 51.61 }).radiusKm, 3);
    // "De Mark" is too general to look for in a text; only its full name is.
    assert.deepEqual(bridgeProfile({ slug: 'de-mark', name: 'De Mark', road: 'A17', lon: 4.5, lat: 51.6 }).terms, ['de mark']);
  });

  it('small helpers', () => {
    assert.equal(coreBridgeName('Maasbrug (A2)'), 'Maasbrug');
    assert.equal(coreBridgeName('Merwedebrug bij Gorinchem'), 'Merwedebrug');
    assert.equal(bridgeWithArticle('Merwedebrug bij Gorinchem'), 'de Merwedebrug bij Gorinchem');
    assert.equal(bridgeWithArticle('Brug over de Dintel'), 'de brug over de Dintel');
    assert.equal(bridgeWithArticle('De Mark'), 'De Mark');
    assert.ok(textNamesRoad('A27, Gorinchem', 'A27'));
    assert.ok(textNamesRoad('afrit a 27 dicht', 'A27'));
    assert.ok(!textNamesRoad('A270, Helmond', 'A27'));
    assert.equal(distanceToGeometryKm({ type: 'Point', coordinates: [0, 0] }, profile.point), Number.POSITIVE_INFINITY);
    assert.deepEqual(bridgeSubject(profile), { kind: 'road', name: 'A27' });
  });
});

/** True when the melding runs at some point of [from, to): itemVerdict itself does not look at the span. */
function overlaps(x, from, to) {
  const start = Date.parse(x.f.properties.start);
  const end = x.f.properties.end ? Date.parse(x.f.properties.end) : Number.POSITIVE_INFINITY;
  return start < to && end > from;
}

/** The heaviest relevant level, null when none applies. */
function heaviest(levels) {
  const relevant = levels.filter((l) => l !== 'nvt');
  return relevant.length === 0 ? null : relevant.reduce((a, b) => (rank(b) < rank(a) ? b : a));
}

describe('the bridge answer is never lighter than the heaviest selected melding', () => {
  it('synthetic: a rijbaan closure next to harmless work reads as a closure', () => {
    const items = selectBridgeItems([item({ imp: 'hinder' }), item({ imp: 'rijbaan', title: 'A27 · Werkendam → Gorinchem' }), item({ imp: 'geen' })], profile);
    const a = answerFor(items, 'auto', { kind: 'moment', at: NOW }, bridgeSubject(profile), NOW);
    assert.equal(a.level, 'rijbaan');
  });

  // Every bridge of the registry on a road that has a fixture file, for every mode, now and per strip day.
  const registry = JSON.parse(readFileSync(fileURLToPath(new URL('../../pipeline/static/bruggen.json', import.meta.url)), 'utf8')).bridges;
  const roadFiles = new Map(fixtureFiles().filter((f) => f.startsWith('roads/')).map((f) => [f.slice(6, -5), readJson(f)]));
  const fixtureNow = Date.parse(readJson('meta.json').generated);
  const cases = registry
    .filter((b) => b.road && roadFiles.has(b.road.toLowerCase()))
    .map((b) => ({ b, items: selectBridgeItems(roadFiles.get(b.road.toLowerCase()).items, bridgeProfile(b)) }))
    .filter((c) => c.items.length > 0);

  it('the fixtures hold bridges with meldingen to protect', () => {
    assert.ok(cases.length >= 5, `${cases.length} bridges with selected meldingen`);
  });

  for (const mode of MODES) {
    it(`${mode}: now and on every strip day`, () => {
      let closures = 0;
      for (const { b, items } of cases) {
        const subject = bridgeSubject(bridgeProfile(b));
        const nowLevel = answerFor(items, mode, { kind: 'moment', at: fixtureNow }, subject, fixtureNow).level;
        const worstNow = heaviest(items.filter((x) => overlaps(x, fixtureNow, fixtureNow + 1)).map((x) => itemVerdict(x, mode, fixtureNow).level));
        if (worstNow !== null) assert.ok(nowLevel !== null && rank(nowLevel) <= rank(worstNow), `${b.name} ${mode}: ${nowLevel} lighter than ${worstNow}`);
        for (const cell of dayStrip(items, mode, fixtureNow, 14)) {
          const window = { from: Math.max(cell.from, fixtureNow), to: cell.to };
          const level = answerFor(items, mode, { kind: 'window', ...window }, subject, fixtureNow).level;
          const worst = heaviest(items.filter((x) => overlaps(x, window.from, window.to)).map((x) => itemVerdict(x, mode, undefined, window).level));
          if (worst !== null) assert.ok(level !== null && rank(level) <= rank(worst), `${b.name} ${mode} ${new Date(cell.from).toISOString()}: ${level} lighter than ${worst}`);
          if (worst === 'dicht' || worst === 'rijbaan') closures += 1;
        }
      }
      if (mode === 'auto') assert.ok(closures > 0, 'at least one bridge day carries a closure');
    });
  }
});

describe('finding a bridge', () => {
  const bridges = [
    { slug: 'merwedebrug-bij-gorinchem', name: 'Merwedebrug bij Gorinchem', road: 'A27' },
    { slug: 'merwedebrug-bij-papendrecht', name: 'Merwedebrug bij Papendrecht', road: 'N3' },
    { slug: 'korte-brug', name: 'Korte Brug, Gorinchem', road: null },
  ];

  it('"Gorkumse brug" finds the Merwedebrug by its alias, and is preselected', () => {
    const hits = searchIndex.searchBridges(bridges, 'Gorkumse brug');
    assert.equal(hits[0].slug, 'merwedebrug-bij-gorinchem');
    assert.equal(hits[0].alias, 'Gorkumse brug');
    const ordered = searchIndex.orderOptions({ query: 'Gorkumse brug', road: null, places: [], local: [], streets: [], bridges: hits });
    assert.deepEqual(ordered.rows[0], { kind: 'heading', label: 'Bruggen' });
    assert.equal(ordered.options[ordered.active].slug, 'merwedebrug-bij-gorinchem');
  });

  it('"Merwedebrug" lists both, the one in the motorway first; a road number finds no bridge', () => {
    assert.deepEqual(searchIndex.searchBridges(bridges, 'merwedebrug').map((h) => h.slug), ['merwedebrug-bij-gorinchem', 'merwedebrug-bij-papendrecht']);
    assert.deepEqual(searchIndex.searchBridges(bridges, 'A27'), []);
  });

  it('the manifest links a melding on the map to the bridge page that counts it', () => {
    const pages = entityPages.entityPagesFrom({ v: 1, roads: [], woonplaatsen: [], gemeenten: [], bridges: [{ ...bridges[0], gemeente: 'Gorinchem', lon: MERWEDE.lon, lat: MERWEDE.lat }, { slug: 'x', name: 'Brug zonder weg', gemeente: null, lon: 5, lat: 52 }] });
    assert.equal(pages.bridges.length, 2);
    assert.deepEqual(pages.bridgesForItem(item()).map((b) => b.slug), ['merwedebrug-bij-gorinchem']);
    assert.deepEqual(pages.bridgesForItem(item({ road: 'N216' })), []);
    // A manifest from before the bridges keeps working.
    assert.deepEqual(entityPages.entityPagesFrom({ v: 1, roads: [], woonplaatsen: [], gemeenten: [] }).bridges, []);
  });
});
