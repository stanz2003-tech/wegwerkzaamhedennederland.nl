import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { vehicleGroup } from '../src/impact.js';
import { buildItem, finalizeItem } from '../src/item.js';
import { DATA_VERSION, DETAIL_SHARDS, featureOf, indexRowOf, PROVINCE_CODES, shardName, shardOf, sha1Hex, writeOutputs } from '../src/output.js';
import { createVild } from '../src/vild.js';
import { parseFixture, VILD_SAMPLE } from './helpers.js';

const TYPES_TS = readFileSync(fileURLToPath(new URL('../../web/src/data/types.ts', import.meta.url)), 'utf8');
const NOW = Date.parse('2026-09-10T12:00:00Z');
const vild = createVild(VILD_SAMPLE);

/** Field names of an exported TypeScript interface, in declaration order. */
function interfaceFields(name) {
  const start = TYPES_TS.indexOf(`export interface ${name} {`);
  assert.ok(start > 0, `interface ${name} not found in types.ts`);
  const body = TYPES_TS.slice(start, TYPES_TS.indexOf('\n}', start));
  /** @type {{ name: string, optional: boolean }[]} */
  const fields = [];
  for (const line of body.split('\n').slice(1)) {
    const m = line.match(/^\s{2}(\w+)(\?)?:/);
    if (m) fields.push({ name: m[1], optional: m[2] === '?' });
  }
  assert.ok(fields.length > 0, `no fields parsed for ${name}`);
  return fields;
}

/** Labels of the positional IndexRow tuple, in order. */
function indexRowLabels() {
  const start = TYPES_TS.indexOf('export type IndexRow = [');
  assert.ok(start > 0, 'IndexRow not found in types.ts');
  const body = TYPES_TS.slice(start, TYPES_TS.indexOf('\n];', start));
  return body
    .split('\n')
    .slice(1)
    .map((line) => line.match(/^\s{2}(\w+):/))
    .filter((m) => m !== null)
    .map((m) => m[1]);
}

/** One finalized item from a fixture. */
async function itemFrom(fixture, role = 'planning', geo = undefined, now = NOW) {
  const situation = await parseFixture(fixture);
  const built = buildItem(situation, role, { vild, nowMs: now });
  assert.ok(built.item, `fixture ${fixture} produced no item (${built.skip})`);
  return finalizeItem(built.item, geo, now);
}

/** The A348 closure starts on 19 October; look at it from a day later. */
const OCTOBER = Date.parse('2026-10-20T12:00:00Z');

test('ItemProperties: every key the pipeline emits exists in types.ts, required keys always present', async () => {
  const fields = interfaceFields('ItemProperties');
  const allowed = new Set(fields.map((f) => f.name));
  const required = fields.filter((f) => !f.optional).map((f) => f.name);
  assert.ok(required.includes('imp'), 'imp is a required key in contract v3');
  for (const fixture of ['rws_plan.xml', 'afsl.xml', 'and01.xml', 'alertonly.xml', 'fiets_dicht.xml']) {
    const item = await itemFrom(fixture);
    for (const key of Object.keys(item.props)) assert.ok(allowed.has(key), `unknown ItemProperties key "${key}" (${fixture})`);
    for (const key of required) assert.ok(item.props[key] !== undefined, `missing required key "${key}" (${fixture})`);
    assert.equal(Object.values(item.props).some((v) => v === undefined || v === null), false, 'nulls must be omitted');
  }
  // the v3 keys appear where they apply, with the types the contract promises
  const cycle = await itemFrom('fiets_dicht.xml');
  assert.equal(cycle.props.imp, 'dicht');
  assert.deepEqual(cycle.props.veh, ['bicycle']);
  assert.equal(cycle.props.per, undefined, 'the whole window published twice is not a recurring measure');
  const work = await itemFrom('rws_plan.xml');
  assert.equal(work.props.imp, 'hinder');
  assert.equal(work.props.spd, 30);
  assert.equal(work.props.veh, undefined);
  assert.equal(work.props.per, undefined);
  assert.equal(work.props.lc, undefined, 'lanes.closed 0 gives no lc');
  const a348 = await itemFrom('rijbaan_omleiding.xml', 'planning', undefined, OCTOBER);
  assert.equal(a348.props.roadType, 'A');
  assert.equal(a348.props.imp, 'rijbaan');
});

test('ItemDetail: every key exists in types.ts and `id`, `src`, `upd` are always set', async () => {
  const fields = interfaceFields('ItemDetail');
  const allowed = new Set(fields.map((f) => f.name));
  for (const fixture of ['rws_plan.xml', 'melvin_multi.xml', 'abnormal.xml', 'rijbaan_omleiding.xml']) {
    const role = fixture === 'abnormal.xml' ? 'live' : 'planning';
    const item = await itemFrom(fixture, role, undefined, fixture === 'rijbaan_omleiding.xml' ? OCTOBER : NOW);
    for (const key of Object.keys(item.detail)) assert.ok(allowed.has(key), `unknown ItemDetail key "${key}" (${fixture})`);
    for (const key of ['id', 'src', 'upd']) assert.ok(item.detail[key] !== undefined, `missing "${key}" (${fixture})`);
  }
  const a348 = await itemFrom('rijbaan_omleiding.xml', 'planning', undefined, OCTOBER);
  assert.ok(Array.isArray(a348.detail.detourGeom) && a348.detail.detourGeom.length >= 2 && a348.detail.detourGeom.length <= 12);
  assert.equal(a348.detail.periods !== undefined, a348.props.per === true, 'per mirrors ItemDetail.periods');
  const work = await itemFrom('rws_plan.xml');
  assert.equal(work.detail.detourGeom, undefined);
});

test('IndexRow positions match the labelled tuple in types.ts', async () => {
  const labels = indexRowLabels();
  assert.deepEqual(labels, [
    'id',
    'cat',
    'sub',
    'sev',
    'title',
    'road',
    'roadType',
    'gemeente',
    'woonplaats',
    'prov',
    'start',
    'end',
    'lon',
    'lat',
    'closed',
    'hind',
    'active',
    'imp',
    'veh',
    'per',
    'spd',
    'lc',
  ]);
  assert.equal(labels.length, 22);
  const item = await itemFrom('rws_plan.xml');
  const row = indexRowOf(item, 1);
  assert.equal(row.length, labels.length);
  const at = (name) => row[labels.indexOf(name)];
  assert.equal(at('id'), item.props.id);
  assert.equal(at('cat'), item.props.cat);
  assert.equal(at('sub'), item.props.sub ?? null);
  assert.equal(at('sev'), item.props.sev);
  assert.equal(at('title'), item.props.title);
  assert.equal(at('road'), item.props.road ?? null);
  assert.equal(at('roadType'), item.props.roadType ?? null);
  assert.equal(at('start'), item.props.start);
  assert.equal(at('end'), item.props.end ?? null);
  assert.equal(at('lon'), item.mid[0]);
  assert.equal(at('lat'), item.mid[1]);
  assert.equal(at('active'), 1);
  // absent values are null, never undefined (JSON.stringify would turn those into null in arrays anyway)
  for (const value of row) assert.notEqual(value, undefined);
  // closed and active are 0/1, not booleans
  assert.ok(at('closed') === 0 || at('closed') === 1);
  const closedItem = await itemFrom('afsl.xml');
  assert.equal(indexRowOf(closedItem, 0)[labels.indexOf('closed')], 1);
  assert.equal(indexRowOf(closedItem, 0)[labels.indexOf('active')], 0);

  // v3 positions: imp always a string, veh array or null, per 0/1, spd/lc number or null
  assert.equal(at('imp'), 'hinder');
  assert.equal(at('veh'), null);
  assert.equal(at('per'), 0);
  assert.equal(at('spd'), 30);
  assert.equal(at('lc'), null);
  const cycleRow = indexRowOf(await itemFrom('fiets_dicht.xml'), 0);
  assert.equal(cycleRow.length, 22);
  assert.equal(cycleRow[labels.indexOf('imp')], 'dicht');
  assert.deepEqual(cycleRow[labels.indexOf('veh')], ['bicycle']);
  assert.equal(cycleRow[labels.indexOf('per')], 0);
  assert.equal(cycleRow[labels.indexOf('spd')], null);
  const nightlyRow = indexRowOf(await itemFrom('rijbaan_omleiding.xml', 'planning', undefined, OCTOBER), 1);
  assert.equal(nightlyRow[labels.indexOf('per')], 1);
  assert.equal(nightlyRow[labels.indexOf('imp')], 'rijbaan');
  // an item without a verdict (older code path) reads as onbekend
  const bare = { ...item, props: { ...item.props, imp: undefined } };
  assert.equal(indexRowOf(bare, 1)[labels.indexOf('imp')], 'onbekend');
});

test('feature: top-level id equals properties.id, geometry is 5-decimal WGS84', async () => {
  const item = await itemFrom('rws_plan.xml');
  const feature = featureOf(item);
  assert.equal(feature.type, 'Feature');
  assert.equal(feature.id, item.props.id);
  assert.ok(['Point', 'LineString', 'MultiLineString'].includes(feature.geometry.type));
  const coords =
    feature.geometry.type === 'Point'
      ? [feature.geometry.coordinates]
      : feature.geometry.type === 'LineString'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat(1);
  for (const [lon, lat] of coords) {
    assert.equal(lon, Math.round(lon * 1e5) / 1e5, `lon ${lon} not rounded to 5 decimals`);
    assert.equal(lat, Math.round(lat * 1e5) / 1e5, `lat ${lat} not rounded to 5 decimals`);
    assert.ok(lon > 3.2 && lon < 7.3 && lat > 50.5 && lat < 53.7, `outside NL: ${lon},${lat}`);
  }
  assert.equal(item.mid[0], Math.round(item.mid[0] * 1e5) / 1e5);
});

test('shardOf equals shardFromHashPrefix() in types.ts', () => {
  assert.ok(TYPES_TS.includes('export const DETAIL_SHARDS = 32;'), 'DETAIL_SHARDS changed in types.ts');
  assert.ok(TYPES_TS.includes('Number.parseInt(hexPrefix.slice(0, 8), 16) % DETAIL_SHARDS'), 'shard formula changed in types.ts');
  assert.equal(DETAIL_SHARDS, 32);
  for (const id of ['NDW18_ea0f089c', 'RWS01_1', 'BMS01_x', 'NLSPL002120533400126', '']) {
    const hex = createHash('sha1').update(id).digest('hex');
    assert.equal(shardOf(id), Number.parseInt(hex.slice(0, 8), 16) % 32);
    assert.ok(shardOf(id) >= 0 && shardOf(id) < 32);
  }
  assert.equal(shardName(0), 'detail/00.json');
  assert.equal(shardName(31), 'detail/31.json');
});

test('writeOutputs writes the full file set, deterministic key order, manifest last', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wegwerk-out-'));
  const active = await itemFrom('rws_plan.xml');
  const closed = await itemFrom('afsl.xml');
  const file = await itemFrom('abnormal.xml', 'live');
  closed.state = 'upcoming';
  const bridges = [{ id: 'NLSPL1', slug: 'brug-1', name: 'Brug 1', lon: 5, lat: 52, openNow: true, openings: [] }];
  const roads = [
    { road: 'A7', slug: 'a7' },
    { road: 'A7 hrb', slug: 'a7-hrb' },
    { road: 'A9', slug: 'a9' },
    { road: 'A2', slug: 'a2' },
  ];
  const gemeenten = [
    { naam: 'Zwolle', slug: 'zwolle' },
    { naam: 'Utrecht', slug: 'utrecht' },
  ];
  const manifest = writeOutputs({
    outDir: dir,
    generated: '2026-09-10T12:00:00Z',
    actueel: [active],
    gepland: [closed],
    live: [file],
    bridges,
    roads,
    gemeenten,
    meta: { sources: {}, counts: {}, upcoming: {}, dropped: 0, unknownTypes: {} },
  });

  const expected = [
    'werk-actueel.geojson',
    'werk-gepland.geojson',
    'live.geojson',
    'index/all.json',
    'bruggen.json',
    'meta.json',
    ...PROVINCE_CODES.map((c) => `index/prov/${c}.json`),
    ...Array.from({ length: DETAIL_SHARDS }, (_, i) => shardName(i)),
    'roads/a7.json',
    'roads/a7-hrb.json',
    'roads/a9.json',
    'gemeenten/zwolle.json',
  ];
  for (const rel of expected) {
    assert.ok(statSync(join(dir, rel)).isFile(), `missing ${rel}`);
    assert.equal(manifest[rel], sha1Hex(readFileSync(join(dir, rel))), `manifest hash wrong for ${rel}`);
  }
  assert.equal(Object.keys(manifest).length, expected.length);
  assert.equal(manifest['manifest.json'], undefined, 'the manifest must not list itself');

  // manifest.json is written last: it is the newest file and its keys are sorted
  const written = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(written), Object.keys(written).slice().sort());
  const manifestMs = statSync(join(dir, 'manifest.json')).mtimeMs;
  for (const rel of expected) assert.ok(statSync(join(dir, rel)).mtimeMs <= manifestMs, `${rel} newer than the manifest`);
  assert.equal(readdirSync(dir).some((n) => n.endsWith('.tmp')), false, 'temp files left behind');

  // meta gets generated + version, index rows carry the active flag
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.generated, '2026-09-10T12:00:00Z');
  assert.equal(meta.version, DATA_VERSION);
  const all = JSON.parse(readFileSync(join(dir, 'index/all.json'), 'utf8'));
  assert.equal(all.generated, '2026-09-10T12:00:00Z');
  assert.equal(all.rows.length, 3);
  assert.deepEqual(
    all.rows.map((r) => r[16]),
    [1, 1, 0],
    'actueel and live are active, gepland is not',
  );

  // details live in the shard of their id, keyed and sorted by id
  for (const item of [active, closed, file]) {
    const shard = JSON.parse(readFileSync(join(dir, shardName(shardOf(item.props.id))), 'utf8'));
    assert.deepEqual(shard[item.props.id], item.detail);
  }

  // every item appears exactly once in exactly one province index
  const perProv = PROVINCE_CODES.flatMap((c) => JSON.parse(readFileSync(join(dir, `index/prov/${c}.json`), 'utf8')).rows);
  assert.equal(perProv.length, 3);
  assert.deepEqual(new Set(perProv.map((r) => r[0])), new Set([active.props.id, closed.props.id, file.props.id]));

  // entity files: EntityFile shape per types.ts, the A7 work in roads/a7.json AND roads/a7-hrb.json,
  // the A9 file in roads/a9.json, the Zwolle closure in gemeenten/zwolle.json; A2/Utrecht have no items → no file
  const entityFields = interfaceFields('EntityFile').map((f) => f.name);
  const entityItemFields = interfaceFields('EntityItem').map((f) => f.name);
  const a7 = JSON.parse(readFileSync(join(dir, 'roads/a7.json'), 'utf8'));
  assert.deepEqual(Object.keys(a7), entityFields);
  assert.equal(a7.generated, active.detail.upd, 'entity generated = latest upd of its items, not the run time');
  assert.equal(a7.kind, 'road');
  assert.equal(a7.key, 'A7');
  assert.equal(a7.slug, 'a7');
  assert.equal(a7.items.length, 1);
  assert.deepEqual(Object.keys(a7.items[0]), entityItemFields);
  assert.deepEqual(a7.items[0].f, featureOf(active));
  assert.deepEqual(a7.items[0].d, active.detail);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'roads/a7-hrb.json'), 'utf8')).items, a7.items);
  assert.equal(JSON.parse(readFileSync(join(dir, 'roads/a9.json'), 'utf8')).items[0].f.id, file.props.id);
  const zwolle = JSON.parse(readFileSync(join(dir, 'gemeenten/zwolle.json'), 'utf8'));
  assert.equal(zwolle.kind, 'gemeente');
  assert.equal(zwolle.key, 'Zwolle');
  assert.equal(zwolle.items[0].f.id, closed.props.id);
  assert.equal(existsSync(join(dir, 'roads/a2.json')), false);
  assert.equal(existsSync(join(dir, 'gemeenten/utrecht.json')), false);

  // deterministic: writing the same input again yields the same hashes
  const again = writeOutputs({
    outDir: mkdtempSync(join(tmpdir(), 'wegwerk-out-')),
    generated: '2026-09-10T12:00:00Z',
    actueel: [active],
    gepland: [closed],
    live: [file],
    bridges,
    roads,
    gemeenten,
    meta: { sources: {}, counts: {}, upcoming: {}, dropped: 0, unknownTypes: {} },
  });
  assert.deepEqual(again, manifest);

  // a later run into the same directory removes entity files that no longer have items;
  // an entity file whose items did not change gets byte-identical content and the same hash
  // even though the run time moved on (the uploader then skips it) — also in a fresh directory,
  // as in GitHub Actions; one whose items changed gets a new hash
  const a7Before = readFileSync(join(dir, 'roads/a7.json'), 'utf8');
  const later = writeOutputs({
    outDir: dir,
    generated: '2026-09-10T12:05:00Z',
    actueel: [active],
    gepland: [],
    live: [],
    bridges,
    roads,
    gemeenten,
    meta: { sources: {}, counts: {}, upcoming: {}, dropped: 0, unknownTypes: {} },
  });
  assert.equal(later['roads/a7.json'], manifest['roads/a7.json'], 'unchanged entity file must keep its hash');
  assert.equal(readFileSync(join(dir, 'roads/a7.json'), 'utf8'), a7Before);
  assert.equal(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).generated, '2026-09-10T12:05:00Z', 'meta.json does move on');
  const fresh = writeOutputs({
    outDir: mkdtempSync(join(tmpdir(), 'wegwerk-out-')),
    generated: '2026-09-10T12:05:00Z',
    actueel: [active],
    gepland: [],
    live: [],
    bridges,
    roads,
    gemeenten,
    meta: { sources: {}, counts: {}, upcoming: {}, dropped: 0, unknownTypes: {} },
  });
  assert.equal(fresh['roads/a7.json'], manifest['roads/a7.json'], 'same hash without a previous file on disk');
  assert.equal(later['roads/a9.json'], undefined);
  assert.equal(existsSync(join(dir, 'roads/a9.json')), false, 'stale road file left behind');
  assert.equal(existsSync(join(dir, 'gemeenten/zwolle.json')), false, 'stale gemeente file left behind');
  assert.ok(existsSync(join(dir, 'roads/a7.json')));
  const changedItem = { ...active, detail: { ...active.detail, desc: 'changed' } };
  const changed = writeOutputs({
    outDir: dir,
    generated: '2026-09-10T12:10:00Z',
    actueel: [changedItem],
    gepland: [],
    live: [],
    bridges,
    roads,
    gemeenten,
    meta: { sources: {}, counts: {}, upcoming: {}, dropped: 0, unknownTypes: {} },
  });
  assert.notEqual(changed['roads/a7.json'], manifest['roads/a7.json']);
  const a7After = JSON.parse(readFileSync(join(dir, 'roads/a7.json'), 'utf8'));
  assert.equal(a7After.generated, active.detail.upd, 'generated only moves when an item was updated by its publisher');
  assert.equal(a7After.items[0].d.desc, 'changed');
  const updated = { ...active, detail: { ...active.detail, upd: '2026-09-10T12:14:00Z' } };
  const bumped = writeOutputs({
    outDir: dir,
    generated: '2026-09-10T12:15:00Z',
    actueel: [updated],
    gepland: [],
    live: [],
    bridges,
    roads,
    gemeenten,
    meta: { sources: {}, counts: {}, upcoming: {}, dropped: 0, unknownTypes: {} },
  });
  assert.equal(bumped['roads/a7.json'], sha1Hex(readFileSync(join(dir, 'roads/a7.json'))));
  assert.equal(JSON.parse(readFileSync(join(dir, 'roads/a7.json'), 'utf8')).generated, '2026-09-10T12:14:00Z');
  // without registries nothing is written and nothing crashes
  const bare = writeOutputs({
    outDir: mkdtempSync(join(tmpdir(), 'wegwerk-out-')),
    generated: '2026-09-10T12:00:00Z',
    actueel: [active],
    gepland: [],
    live: [],
    bridges,
    meta: { sources: {}, counts: {}, upcoming: {}, dropped: 0, unknownTypes: {} },
  });
  assert.equal(Object.keys(bare).some((k) => k.startsWith('roads/') || k.startsWith('gemeenten/')), false);
});

test('the data files listed in types.ts are exactly what the pipeline writes', () => {
  for (const rel of ['meta.json', 'werk-actueel.geojson', 'werk-gepland.geojson', 'live.geojson', 'index/all.json', 'bruggen.json', 'manifest.json']) {
    assert.ok(TYPES_TS.includes(`'${rel}'`), `${rel} missing from DATA_FILES in types.ts`);
  }
  assert.ok(TYPES_TS.includes('`index/prov/${provCode}.json`'));
  assert.ok(TYPES_TS.includes("`detail/${String(shard).padStart(2, '0')}.json`"));
  assert.ok(TYPES_TS.includes('`roads/${slug}.json`'), 'DATA_FILES.road missing in types.ts');
  assert.ok(TYPES_TS.includes('`gemeenten/${slug}.json`'), 'DATA_FILES.gemeente missing in types.ts');
  assert.deepEqual(PROVINCE_CODES.filter((c) => c !== '_').sort(), Object.keys(JSON.parse(provincesFromTypes())).sort());
});

test('contract v3: Meta.version, Impact and Vehicle unions match what the pipeline emits', () => {
  assert.equal(DATA_VERSION, '3');
  assert.ok(TYPES_TS.includes('Meta.version = "3"'), 'types.ts header does not announce version 3');
  const union = (name) => {
    const m = TYPES_TS.match(new RegExp(`export type ${name} = ([^;]+);`));
    assert.ok(m, `${name} not found in types.ts`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  assert.deepEqual(union('Impact'), ['dicht', 'rijbaan', 'hinder', 'geen', 'onbekend']);
  assert.deepEqual(union('Vehicle'), ['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other']);
  for (const v of ['car', 'lorry', 'heavyGoodsVehicle', 'heavyVehicle', 'bicycle', 'moped', 'bus', 'agriculturalVehicle', 'constructionOrMaintenanceVehicle']) {
    assert.ok(union('Vehicle').includes(vehicleGroup(v)), `vehicleGroup(${v}) not in the Vehicle union`);
  }
});

/** The PROVINCES map of types.ts as a JSON string. */
function provincesFromTypes() {
  const start = TYPES_TS.indexOf('export const PROVINCES');
  const body = TYPES_TS.slice(TYPES_TS.indexOf('{', start), TYPES_TS.indexOf('};', start) + 1);
  return body.replace(/(\w+):/g, '"$1":').replace(/'/g, '"').replace(/,\s*}/, '}');
}
