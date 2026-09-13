/**
 * Contract regression net, part 2: index rows, detail shards, bruggen.json and the
 * determinism of scripts/make-fixtures.mjs. Part 1 (files, manifest, meta, GeoJSON) lives
 * in fixtures.test.mjs.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFixtures } from '../scripts/make-fixtures.mjs';
import { ISO_MINUTE, NL_BBOX, loadDetails, loadFixtureData, readFixture, readJson, sha1 } from './helpers/fixtures.mjs';
import { dataLoad, filter, periods as periodsMod, time, types } from './helpers/src.mjs';

const { PROVINCES, shardFromHashPrefix, slugify } = types;
const { isBridgeFile, isIndexFile, isIndexRow } = dataLoad;
const { midpointOf } = filter;
const { isActiveAt } = time;

const CATEGORY_SET = new Set(types.CATEGORIES);
const PROVINCE_NAMES = new Set(Object.values(PROVINCES));

const data = loadFixtureData();
const NOW = data.now;
const allFeatures = data.allFeatures;
const activeFeatures = data.activeFeatures;

describe('index files', () => {
  it('index/all.json passes the validator and holds one row per feature', () => {
    assert.equal(isIndexFile(data.indexAll), true);
    assert.equal(data.indexAll.generated, data.meta.generated);
    assert.equal(data.indexAll.rows.length, allFeatures.length);
    const rowIds = data.indexAll.rows.map((r) => r[0]).sort();
    assert.deepEqual(rowIds, allFeatures.map((f) => f.properties.id).sort());
  });

  it('every row has the positional shape of IndexRow', () => {
    for (const row of data.indexAll.rows) {
      assert.equal(isIndexRow(row), true, `${row[0]} row shape`);
      assert.equal(row.length, 22, `${row[0]} row length (contract v3)`);
      assert.ok(['dicht', 'rijbaan', 'hinder', 'geen', 'onbekend'].includes(row[17]), `${row[0]} imp`);
      assert.ok(row[18] === null || (Array.isArray(row[18]) && row[18].every((v) => ['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other'].includes(v))), `${row[0]} veh`);
      assert.ok(row[19] === 0 || row[19] === 1, `${row[0]} per flag`);
      assert.ok(row[20] === null || (Number.isInteger(row[20]) && row[20] > 0), `${row[0]} spd`);
      assert.ok(row[21] === null || (Number.isInteger(row[21]) && row[21] > 0), `${row[0]} lc`);
      assert.ok(CATEGORY_SET.has(row[1]));
      assert.ok(row[2] === null || typeof row[2] === 'string');
      assert.ok(Number.isInteger(row[3]));
      assert.match(row[10], ISO_MINUTE);
      assert.ok(row[11] === null || ISO_MINUTE.test(row[11]));
      assert.equal(typeof row[12], 'number');
      assert.equal(typeof row[13], 'number');
      assert.ok(row[14] === 0 || row[14] === 1, `${row[0]} closed flag`);
      assert.ok(row[16] === 0 || row[16] === 1, `${row[0]} active flag`);
    }
  });

  it('row fields agree with the feature properties and geometry midpoint', () => {
    const features = new Map(allFeatures.map((f) => [f.properties.id, f]));
    for (const row of data.indexAll.rows) {
      const f = features.get(row[0]);
      const p = f.properties;
      assert.deepEqual(
        [row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[14], row[15], row[17], row[18], row[19], row[20], row[21]],
        [p.cat, p.sub ?? null, p.sev, p.title, p.road ?? null, p.roadType ?? null, p.gemeente ?? null, p.woonplaats ?? null, p.prov ?? null, p.start, p.end ?? null, p.closed ? 1 : 0, p.hind ?? null, p.imp, p.veh ?? null, p.per ? 1 : 0, p.spd ?? null, p.lc ?? null],
        `row of ${row[0]}`,
      );
      const mid = midpointOf(f.geometry);
      assert.equal(row[12], Number(mid[0].toFixed(5)), `${row[0]} lon is the geometry midpoint`);
      assert.equal(row[13], Number(mid[1].toFixed(5)), `${row[0]} lat is the geometry midpoint`);
    }
  });

  it('the active flag matches the file the feature came from', () => {
    const activeIds = new Set(activeFeatures.map((f) => f.properties.id));
    for (const row of data.indexAll.rows) assert.equal(row[16], activeIds.has(row[0]) ? 1 : 0, `${row[0]} active flag`);
  });

  it('province files partition index/all.json', () => {
    const seen = [];
    for (const file of data.provFiles) {
      const code = file.slice('index/prov/'.length, -'.json'.length);
      const provFile = readJson(file);
      assert.equal(isIndexFile(provFile), true, `${file} validator`);
      assert.equal(provFile.generated, data.meta.generated, `${file} generated`);
      for (const row of provFile.rows) {
        assert.equal(row[9], code === '_' ? null : PROVINCES[code], `${row[0]} belongs in ${code}`);
        seen.push(row[0]);
      }
    }
    assert.deepEqual(seen.sort(), data.indexAll.rows.map((r) => r[0]).sort());
  });

  it('the three provinces named in the brief carry rows', () => {
    for (const code of ['PV26', 'PV27', 'PV30']) {
      assert.ok(readJson(`index/prov/${code}.json`).rows.length > 0, `${code} has rows`);
    }
  });

  it('the unknown-province bucket holds exactly the rows without a province', () => {
    const unknown = readJson('index/prov/_.json').rows;
    assert.equal(unknown.length, data.indexAll.rows.filter((r) => r[9] === null).length);
    assert.ok(unknown.length > 0, 'the fixture exercises the unknown-province path');
  });
});

describe('detail shards', () => {
  const details = loadDetails(data.detailFiles);

  it('every item has a detail entry and every entry belongs to an item', () => {
    const ids = new Set(allFeatures.map((f) => f.properties.id));
    for (const id of ids) assert.ok(details.has(id), `detail missing for ${id}`);
    for (const id of details.keys()) assert.ok(ids.has(id), `detail for unknown id ${id}`);
    assert.equal(details.size, ids.size);
  });

  it('every entry sits in the shard sha1(id) prescribes', () => {
    for (const [id, { shard }] of details) {
      assert.equal(shard, shardFromHashPrefix(sha1(id)), `shard of ${id}`);
    }
  });

  it('every entry has the required ItemDetail fields', () => {
    for (const [id, { detail }] of details) {
      assert.equal(detail.id, id);
      assert.ok(typeof detail.src === 'string' && detail.src.length > 0, `${id} src`);
      assert.match(detail.upd, ISO_MINUTE, `${id} upd`);
      assert.ok(Date.parse(detail.upd) <= NOW, `${id} was updated in the past`);
      if (detail.url !== undefined) assert.ok(detail.url.startsWith('https://'), `${id} url`);
      if (detail.lanes !== undefined) {
        for (const v of Object.values(detail.lanes)) assert.ok(Number.isInteger(v) && v >= 0, `${id} lanes`);
      }
      if (detail.speed !== undefined) assert.ok(detail.speed >= 5 && detail.speed <= 130, `${id} speed`);
      if (detail.queueM !== undefined) assert.ok(detail.queueM > 0, `${id} queue length`);
      if (detail.delaySec !== undefined) assert.ok(detail.delaySec > 0, `${id} delay`);
      if (detail.dir !== undefined) assert.ok(['positive', 'negative', 'both'].includes(detail.dir), `${id} direction`);
      assert.equal(Object.values(detail).some((v) => v === null), false, `${id} has no null values`);
    }
  });

  it('merged double publications point at ids that are not items themselves', () => {
    // Contract addition (ItemDetail.related): the actual measure survives and the planning
    // situation is dropped, so a related id may never be an item of its own — otherwise the
    // same work would be on the map twice.
    const ids = new Set(allFeatures.map((f) => f.properties.id));
    let relatedIds = 0;
    let withRelated = 0;
    for (const [id, { detail }] of details) {
      if (detail.related === undefined) continue;
      withRelated += 1;
      assert.ok(Array.isArray(detail.related) && detail.related.length > 0, `${id} related is a non-empty array`);
      for (const other of detail.related) {
        assert.equal(typeof other, 'string', `${id} related entry is a string`);
        assert.ok(other.length > 0, `${id} related entry is not empty`);
        assert.notEqual(other, id, `${id} does not relate to itself`);
        assert.equal(ids.has(other), false, `${other} was merged away and must not be an item`);
        relatedIds += 1;
      }
      assert.deepEqual([...detail.related].sort(), detail.related, `${id} related is sorted`);
    }
    assert.ok(withRelated >= 2, 'the fixture covers both the single and the plural wording');
    assert.equal(relatedIds, data.meta.merged, 'meta.merged counts exactly the merged-away ids');
  });

  it('the detail source equals the feature source', () => {
    for (const f of allFeatures) assert.equal(details.get(f.properties.id).detail.src, f.properties.src, f.properties.id);
  });

  it('recurring periods are ISO pairs inside the item window, sorted and capped', () => {
    let withPeriods = 0;
    const byId = new Map(allFeatures.map((f) => [f.properties.id, f.properties]));
    for (const [id, { detail }] of details) {
      if (!detail.periods) continue;
      withPeriods += 1;
      const p = byId.get(id);
      assert.ok(detail.periods.length <= 60, `${id} at most 60 periods`);
      let previous = 0;
      for (const [start, end] of detail.periods) {
        assert.match(start, ISO_MINUTE, `${id} period start`);
        assert.match(end, ISO_MINUTE, `${id} period end`);
        const s = Date.parse(start);
        assert.ok(s >= previous, `${id} periods are sorted`);
        assert.ok(Date.parse(end) >= s, `${id} period ends after it starts`);
        assert.ok(s >= Date.parse(p.start), `${id} period starts inside the item window`);
        assert.ok(Date.parse(end) <= Date.parse(p.end), `${id} period ends inside the item window`);
        previous = s;
      }
    }
    assert.ok(withPeriods >= 1, 'the fixture contains at least one item with sub-periods');
  });

  it('the nightly item is recognised as a recurring pattern', () => {
    const nightly = details.get('NDW03_2200001');
    assert.ok(nightly, 'the nightly fixture item exists');
    assert.equal(nightly.detail.periods.length, 10);
    const summary = periodsMod.summarizePeriods(nightly.detail.periods, NOW);
    assert.equal(summary.kind, 'pattern');
    assert.equal(summary.from, '21:00');
    assert.equal(summary.to, '05:00');
    assert.equal(summary.days, 'dagelijks');
  });
});

describe('EntityFiles (roads/<slug>.json, gemeenten/<slug>.json)', () => {
  const { isEntityFile } = dataLoad;
  const entityFiles = data.files.filter((f) => f.startsWith('roads/') || f.startsWith('gemeenten/'));
  const ids = new Set(allFeatures.map((f) => f.properties.id));
  const activeIds = new Set(activeFeatures.map((f) => f.properties.id));
  const details = loadDetails(data.detailFiles);
  const roadKeyOf = (road) => {
    const m = /^([ANSE])\s*0*(\d{1,3})/i.exec(road ?? '');
    return m ? `${m[1].toUpperCase()}${Number(m[2])}` : null;
  };

  it('exist for the A2 and the gemeente Utrecht and pass the validator', () => {
    assert.ok(entityFiles.includes('roads/a2.json'));
    assert.ok(entityFiles.includes('gemeenten/utrecht.json'));
    for (const file of entityFiles) {
      const ef = readJson(file);
      assert.equal(isEntityFile(ef), true, `${file} validator`);
      assert.equal(ef.generated, data.meta.generated, `${file} generated`);
      assert.equal(ef.kind, file.startsWith('roads/') ? 'road' : 'gemeente', `${file} kind`);
      assert.equal(file, `${ef.kind === 'road' ? 'roads' : 'gemeenten'}/${ef.slug}.json`, `${file} slug matches the path`);
      assert.ok(ef.items.length > 0, `${file} has items`);
    }
  });

  it('every item references an existing id and carries geometry plus the same detail as the shard', () => {
    for (const file of entityFiles) {
      for (const { f, d } of readJson(file).items) {
        assert.ok(ids.has(f.properties.id), `${file}: unknown item ${f.properties.id}`);
        assert.ok(['Point', 'LineString', 'MultiLineString'].includes(f.geometry.type), `${file}: ${f.id} geometry`);
        assert.equal(d.id, f.properties.id, `${file}: detail id`);
        assert.deepEqual(d, details.get(f.properties.id).detail, `${file}: detail equals the shard entry of ${f.properties.id}`);
      }
    }
  });

  it('lists active items first, then by start, and belongs entirely to its entity', () => {
    for (const file of entityFiles) {
      const ef = readJson(file);
      let seenPlanned = false;
      let previousStart = '';
      for (const { f } of ef.items) {
        const active = activeIds.has(f.properties.id);
        if (!active) seenPlanned = true;
        else assert.equal(seenPlanned, false, `${file}: active item ${f.id} after a planned one`);
        if (!active) {
          assert.ok(f.properties.start >= previousStart, `${file}: planned items sorted by start`);
          previousStart = f.properties.start;
        }
        if (ef.kind === 'road') assert.equal(roadKeyOf(f.properties.road), ef.key, `${file}: ${f.id} is on ${ef.key}`);
        else assert.equal(f.properties.gemeente, ef.key, `${file}: ${f.id} lies in ${ef.key}`);
      }
    }
  });

  it('covers every road and gemeente that has items', () => {
    const roads = new Set(allFeatures.map((f) => roadKeyOf(f.properties.road)).filter(Boolean).map((r) => r.toLowerCase()));
    for (const r of roads) assert.ok(entityFiles.includes(`roads/${r}.json`), `roads/${r}.json`);
    const gemeenten = new Set(allFeatures.map((f) => f.properties.gemeente).filter(Boolean).map(slugify));
    for (const g of gemeenten) assert.ok(entityFiles.includes(`gemeenten/${g}.json`), `gemeenten/${g}.json`);
  });

  it('the A2 file holds the rijbaan closure with its detour geometry; the nightly A12 work keeps its periods', () => {
    const a2 = readJson('roads/a2.json');
    const rijbaan = a2.items.find((it) => it.f.properties.id === 'NDW03_2100002');
    assert.ok(rijbaan, 'A2 rijbaan closure present');
    assert.ok(Array.isArray(rijbaan.d.detourGeom) && rijbaan.d.detourGeom.length >= 2 && rijbaan.d.detourGeom.length <= 12);
    for (const [lon, lat] of rijbaan.d.detourGeom) {
      assert.ok(lon >= NL_BBOX[0] && lon <= NL_BBOX[2] && lat >= NL_BBOX[1] && lat <= NL_BBOX[3], 'detour inside NL');
    }
    const a12 = readJson('roads/a12.json');
    const nightly = a12.items.find((it) => it.f.properties.id === 'NDW03_2200001');
    assert.equal(nightly.f.properties.per, true);
    assert.equal(nightly.d.periods.length, 10);
  });
});

describe('bruggen.json', () => {
  it('passes the validator and has five bridges', () => {
    assert.equal(isBridgeFile(data.bruggen), true);
    assert.equal(data.bruggen.generated, data.meta.generated);
    assert.equal(data.bruggen.bridges.length, 5);
  });

  it('every bridge has an id, a slug derived from its name and coordinates inside NL', () => {
    const slugs = new Set();
    for (const b of data.bruggen.bridges) {
      assert.ok(b.id.length > 0, 'id');
      assert.equal(b.slug, slugify(b.name), `${b.id} slug follows slugify(name)`);
      assert.equal(slugs.has(b.slug), false, `${b.slug} is unique`);
      slugs.add(b.slug);
      assert.ok(b.lon >= NL_BBOX[0] && b.lon <= NL_BBOX[2], `${b.id} lon`);
      assert.ok(b.lat >= NL_BBOX[1] && b.lat <= NL_BBOX[3], `${b.id} lat`);
      assert.equal(typeof b.openNow, 'boolean');
      if (b.prov !== undefined) assert.ok(PROVINCE_NAMES.has(b.prov), `${b.id} province`);
    }
  });

  it('openings are sorted ISO pairs within the next seven days', () => {
    for (const b of data.bruggen.bridges) {
      assert.ok(Array.isArray(b.openings));
      assert.ok(b.openings.length <= 50, `${b.id} at most 50 openings`);
      let previous = 0;
      for (const [start, end] of b.openings) {
        assert.match(start, ISO_MINUTE, `${b.id} opening start`);
        assert.match(end, ISO_MINUTE, `${b.id} opening end`);
        const s = Date.parse(start);
        assert.ok(s >= previous, `${b.id} openings are sorted`);
        assert.ok(Date.parse(end) >= s, `${b.id} opening ends after it starts`);
        assert.ok(s <= NOW + 7 * 86_400_000, `${b.id} opening within 7 days`);
        previous = s;
      }
    }
  });

  it('two bridges are open now and each matches a live bridge feature', () => {
    const open = data.bruggen.bridges.filter((b) => b.openNow);
    assert.equal(open.length, 2);
    const liveBridgeIds = data.live.features.filter((f) => f.properties.cat === 'brug').map((f) => f.properties.id);
    for (const b of open) {
      assert.ok(liveBridgeIds.some((id) => id.includes(b.id)), `${b.id} has a live bridgeSwingInOperation record`);
      assert.ok(b.openings.some(([s, e]) => Date.parse(s) <= NOW && Date.parse(e) >= NOW), `${b.id} has an opening running now`);
    }
  });

  it('includes a bridge without any planned opening (the empty-state path)', () => {
    assert.equal(data.bruggen.bridges.filter((b) => b.openings.length === 0).length, 1);
  });
});

describe('the generator and the committed fixtures', () => {
  it('is deterministic: two builds with the same base timestamp are identical', () => {
    const first = buildFixtures(NOW);
    const second = buildFixtures(NOW);
    assert.deepEqual(second.map(([rel]) => rel), first.map(([rel]) => rel));
    for (const [i, [rel, obj]] of first.entries()) {
      assert.equal(JSON.stringify(second[i][1]), JSON.stringify(obj), `${rel} identical between runs`);
    }
  });

  it('the files on disk are what the generator produces now (run `npm run fixtures -w @wegwerk/web`)', () => {
    const built = buildFixtures(NOW);
    assert.deepEqual(built.map(([rel]) => rel).sort(), data.files.filter((f) => f !== 'manifest.json').sort());
    for (const [rel, obj] of built) {
      assert.equal(readFixture(rel), JSON.stringify(obj), `${rel} is up to date`);
    }
  });

  it('produces a usable set for a completely different base timestamp', () => {
    const winter = Date.parse('2026-12-24T08:30:00Z');
    const built = new Map(buildFixtures(winter));
    const actueel = built.get('werk-actueel.geojson');
    assert.equal(actueel.features.length, 41);
    for (const f of actueel.features) assert.equal(isActiveAt(f.properties, winter), true, `${f.id} active in December`);
    const nightly = Object.values(built.get(`detail/${String(shardFromHashPrefix(sha1('NDW03_2200001'))).padStart(2, '0')}.json`)).find((d) => d.id === 'NDW03_2200001');
    const summary = periodsMod.summarizePeriods(nightly.periods, winter);
    assert.equal(summary.kind, 'pattern');
    assert.equal(summary.from, '21:00', 'nightly periods keep their local wall clock in winter time');
    assert.equal(summary.to, '05:00');
  });
});
