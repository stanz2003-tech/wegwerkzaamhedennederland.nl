/**
 * Contract regression net, part 1: file set, manifest hashes, meta.json and the three
 * GeoJSON collections of web/fixtures/data/** (written by scripts/make-fixtures.mjs).
 * Part 2 (index rows, detail shards, bridges, generator) lives in fixtures-index.test.mjs.
 *
 * If the pipeline output or the contract in web/src/data/types.ts changes, these tests are
 * the first thing that breaks.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ISO_MINUTE, NL_BBOX, coordsOf, loadFixtureData, readFixture, sha1 } from './helpers/fixtures.mjs';
import { dataLoad, filter, time, types } from './helpers/src.mjs';

const { DETAIL_SHARDS, PROVINCES } = types;
const { isItemCollection, isMeta, sanitizeFeatures } = dataLoad;
const { bboxOf } = filter;
const { isActiveAt } = time;

const CATEGORY_SET = new Set(types.CATEGORIES);
const PROVINCE_NAMES = new Set(Object.values(PROVINCES));

const data = loadFixtureData();
const NOW = data.now;
const allFeatures = data.allFeatures;
const activeFeatures = data.activeFeatures;

describe('file set and manifest', () => {
  it('contains every file of the contract', () => {
    for (const required of ['meta.json', 'werk-actueel.geojson', 'werk-gepland.geojson', 'live.geojson', 'index/all.json', 'bruggen.json', 'manifest.json', 'roads/a2.json', 'gemeenten/utrecht.json']) {
      assert.ok(data.files.includes(required), `missing ${required}`);
    }
  });

  it('has one index file per province code plus the unknown bucket', () => {
    const expected = [...Object.keys(PROVINCES), '_'].map((c) => `index/prov/${c}.json`).sort();
    assert.deepEqual(data.provFiles.sort(), expected);
  });

  it('only writes detail shards that actually hold items, with two-digit names', () => {
    assert.ok(data.detailFiles.length > 0);
    assert.ok(data.detailFiles.length <= DETAIL_SHARDS);
    for (const file of data.detailFiles) assert.match(file, /^detail\/\d{2}\.json$/);
  });

  it('manifest lists exactly the other files with their sha1', () => {
    const listed = Object.keys(data.manifest).sort();
    const onDisk = data.files.filter((f) => f !== 'manifest.json').sort();
    assert.deepEqual(listed, onDisk);
    for (const [rel, hash] of Object.entries(data.manifest)) {
      assert.match(hash, /^[0-9a-f]{40}$/, `${rel} hash format`);
      assert.equal(sha1(readFixture(rel)), hash, `${rel} content matches its manifest hash`);
    }
  });

  it('every file is minified JSON (no pretty printing)', () => {
    for (const rel of data.files) assert.equal(readFixture(rel).includes('\n'), false, `${rel} is one line`);
  });
});

describe('meta.json', () => {
  it('passes the frontend validator and has the agreed shape', () => {
    assert.equal(isMeta(data.meta), true);
    assert.match(data.meta.generated, ISO_MINUTE);
    assert.equal(data.meta.version, '3');
    assert.equal(typeof data.meta.dropped, 'number');
    assert.equal(typeof data.meta.runMs, 'number');
    assert.equal(typeof data.meta.peakRssMb, 'number');
  });

  it('reports how many double publications were folded into one item', () => {
    // Contract addition (Meta.merged): RWS publishes a running roadwork twice — a planning
    // situation plus the actual measure — and the pipeline merges them. Optional in the type,
    // so a file without it must stay valid.
    assert.equal(typeof data.meta.merged, 'number');
    assert.ok(data.meta.merged >= 0);
    const { merged, ...withoutMerged } = data.meta;
    assert.equal(isMeta(withoutMerged), true, 'older files without `merged` still load');
  });

  it('describes the three NDW sources', () => {
    assert.deepEqual(Object.keys(data.meta.sources).sort(), ['actueel', 'bruggen', 'planning']);
    for (const [name, source] of Object.entries(data.meta.sources)) {
      assert.equal(source.ok, true, `${name} ok`);
      assert.ok(source.url.startsWith('https://opendata.ndw.nu/'), `${name} url`);
      assert.match(source.publicationTime, ISO_MINUTE, `${name} publicationTime`);
      assert.ok(source.situations > 0, `${name} situations`);
      assert.ok(Date.parse(source.publicationTime) <= NOW, `${name} published before generated`);
    }
  });

  it('counts match the actual features (active = werk-actueel + live)', () => {
    const counted = (features) => {
      const counts = { werk: 0, afsluiting: 0, file: 0, incident: 0, brug: 0, evenement: 0, overig: 0 };
      for (const f of features) counts[f.properties.cat] += 1;
      return counts;
    };
    assert.deepEqual(data.meta.counts, counted(activeFeatures));
    assert.deepEqual(data.meta.upcoming, counted(data.gepland.features));
  });

  it('has the item volumes the fixture promises', () => {
    assert.equal(data.actueel.features.length, 41);
    assert.equal(data.gepland.features.length, 20);
    assert.equal(data.live.features.length, 9);
  });
});

describe('GeoJSON collections', () => {
  const collections = [
    ['werk-actueel', data.actueel],
    ['werk-gepland', data.gepland],
    ['live', data.live],
  ];

  it('pass the frontend validator and survive sanitizeFeatures untouched', () => {
    for (const [name, fc] of collections) {
      assert.equal(isItemCollection(fc), true, `${name} is a FeatureCollection`);
      assert.equal(sanitizeFeatures(fc).length, fc.features.length, `${name} keeps every feature`);
    }
  });

  it('every feature has a top-level id equal to properties.id', () => {
    for (const f of allFeatures) {
      assert.equal(typeof f.id, 'string');
      assert.equal(f.id, f.properties.id);
      assert.equal(f.type, 'Feature');
    }
  });

  it('item ids are unique across all three files', () => {
    const ids = allFeatures.map((f) => f.properties.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('properties follow the compact contract', () => {
    for (const f of allFeatures) {
      const p = f.properties;
      assert.ok(CATEGORY_SET.has(p.cat), `${p.id} category ${p.cat}`);
      assert.ok(Number.isInteger(p.sev) && p.sev >= 0 && p.sev <= 4, `${p.id} severity`);
      assert.ok(p.title.length > 0 && p.title.length <= 120, `${p.id} title length`);
      assert.ok(p.src.length > 0, `${p.id} src`);
      assert.match(p.start, ISO_MINUTE, `${p.id} start`);
      if (p.end !== undefined) assert.match(p.end, ISO_MINUTE, `${p.id} end`);
      if (p.roadType !== undefined) assert.ok(['A', 'N', 'S', 'E', 'lokaal'].includes(p.roadType), `${p.id} roadType`);
      if (p.prov !== undefined) assert.ok(PROVINCE_NAMES.has(p.prov), `${p.id} province ${p.prov}`);
      if (p.hind !== undefined) assert.ok(['A', 'B', 'C', 'D', 'E'].includes(p.hind), `${p.id} hindrance`);
      if (p.prob !== undefined) assert.ok(['certain', 'probable', 'riskOf'].includes(p.prob), `${p.id} probability`);
      if (p.closed !== undefined) assert.equal(p.closed, true, `${p.id} closed is only ever true`);
      // Contract v3: every item carries a verdict; the optional fields have the agreed shapes.
      assert.ok(['dicht', 'rijbaan', 'hinder', 'geen', 'onbekend'].includes(p.imp), `${p.id} imp ${p.imp}`);
      if (p.veh !== undefined) {
        assert.ok(Array.isArray(p.veh) && p.veh.length > 0, `${p.id} veh is a non-empty array`);
        for (const v of p.veh) assert.ok(['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other'].includes(v), `${p.id} vehicle ${v}`);
      }
      if (p.per !== undefined) assert.equal(p.per, true, `${p.id} per is only ever true`);
      if (p.spd !== undefined) assert.ok(Number.isInteger(p.spd) && p.spd > 0, `${p.id} spd`);
      if (p.lc !== undefined) assert.ok(Number.isInteger(p.lc) && p.lc > 0, `${p.id} lc`);
      assert.equal(Object.values(p).some((v) => v === null), false, `${p.id} has no null values`);
    }
  });

  it('ends never lie before starts', () => {
    for (const f of allFeatures) {
      if (f.properties.end) assert.ok(Date.parse(f.properties.end) >= Date.parse(f.properties.start), f.properties.id);
    }
  });

  it('geometry is Point, LineString or MultiLineString with coordinates inside the NL bbox', () => {
    for (const f of allFeatures) {
      assert.ok(['Point', 'LineString', 'MultiLineString'].includes(f.geometry.type), `${f.id} geometry type`);
      const coords = coordsOf(f.geometry);
      assert.ok(coords.length > 0, `${f.id} has coordinates`);
      for (const [lon, lat] of coords) {
        assert.ok(lon >= NL_BBOX[0] && lon <= NL_BBOX[2], `${f.id} lon ${lon} inside NL`);
        assert.ok(lat >= NL_BBOX[1] && lat <= NL_BBOX[3], `${f.id} lat ${lat} inside NL`);
        assert.equal(Number(lon.toFixed(5)), lon, `${f.id} lon has at most 5 decimals`);
        assert.equal(Number(lat.toFixed(5)), lat, `${f.id} lat has at most 5 decimals`);
      }
      assert.notEqual(bboxOf(f.geometry), null, `${f.id} has a bbox`);
    }
  });

  it('exercises every verdict path: a closed cycle path, a lorry-only measure, an A-road rijbaan with a detour, nightly work', () => {
    const byId = new Map(allFeatures.map((f) => [f.properties.id, f.properties]));
    const cycle = byId.get('AND01_2100016');
    assert.equal(cycle.imp, 'dicht');
    assert.deepEqual(cycle.veh, ['bicycle', 'moped']);
    const lorry = byId.get('NDW03_2100004');
    assert.equal(lorry.imp, 'hinder');
    assert.deepEqual(lorry.veh, ['lorry']);
    assert.equal(lorry.spd, 90);
    const rijbaan = byId.get('NDW03_2100002');
    assert.equal(rijbaan.imp, 'rijbaan');
    assert.equal(rijbaan.lc, 3);
    const nightly = byId.get('NDW03_2200001');
    assert.equal(nightly.per, true);
    assert.equal(nightly.imp, 'dicht');
    const imps = new Set(allFeatures.map((f) => f.properties.imp));
    for (const imp of ['dicht', 'rijbaan', 'hinder', 'geen', 'onbekend']) assert.ok(imps.has(imp), `fixture has an item with imp=${imp}`);
  });

  it('has all three geometry types and a mix of categories', () => {
    const geomTypes = new Set(allFeatures.map((f) => f.geometry.type));
    assert.deepEqual([...geomTypes].sort(), ['LineString', 'MultiLineString', 'Point']);
    const cats = new Set(allFeatures.map((f) => f.properties.cat));
    assert.deepEqual([...cats].sort(), ['afsluiting', 'brug', 'evenement', 'file', 'incident', 'overig', 'werk']);
  });

  it('werk-actueel and live are active at meta.generated, werk-gepland is not', () => {
    for (const f of activeFeatures) assert.equal(isActiveAt(f.properties, NOW), true, `${f.id} should be active`);
    for (const f of data.gepland.features) {
      assert.equal(isActiveAt(f.properties, NOW), false, `${f.id} should not be active yet`);
      const days = (Date.parse(f.properties.start) - NOW) / 86_400_000;
      assert.ok(days > 0 && days <= 30, `${f.id} starts within 30 days (${days.toFixed(1)})`);
    }
  });

  it('closures carry the closed flag and live files carry queue details', () => {
    for (const f of allFeatures) {
      if (f.properties.cat === 'afsluiting') assert.equal(f.properties.closed, true, `${f.id} closed flag`);
    }
    const files = data.live.features.filter((f) => f.properties.cat === 'file');
    assert.equal(files.length, 3);
    for (const f of files) {
      assert.ok(['slowTraffic', 'stationaryTraffic'].includes(f.properties.sub), `${f.id} sub`);
      assert.equal(f.geometry.type, 'LineString', `${f.id} is a line`);
      assert.equal(f.properties.end, undefined, `${f.id} is open ended`);
    }
    assert.equal(data.live.features.filter((f) => f.properties.cat === 'incident').length, 4);
    assert.equal(data.live.features.filter((f) => f.properties.cat === 'brug').length, 2);
  });
});

