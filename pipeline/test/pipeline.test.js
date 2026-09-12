import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { parseCli } from '../bin/run.js';
import { wrapFixture } from '../src/parse.js';
import { runPipeline } from '../src/pipeline.js';
import { SOURCES } from '../src/sources.js';
import { fixture, VILD_SAMPLE } from './helpers.js';

const NOW = '2026-09-10T12:00:00Z';
const PLANNING_FIXTURES = ['rws_plan.xml', 'afsl.xml', 'and01.xml', 'melvin_multi.xml', 'alertonly.xml', 'rws_initial.xml'];
const LIVE_FIXTURES = ['abnormal.xml', 'accident.xml', 'srti.xml', 'bridge.xml', 'rws_live.xml'];

/**
 * A feed file built from committed situation fixtures, repeated with unique ids
 * so the validation floors of the real sources are met.
 * @param {string} dir @param {string} name @param {string[]} names @param {number} copies
 */
function writeFeed(dir, name, names, copies) {
  const inner = names.map(fixture).join('');
  let xml = '';
  for (let i = 0; i < copies; i++) xml += i === 0 ? inner : inner.replace(/id="/g, `id="c${i}-`);
  const path = join(dir, name);
  writeFileSync(path, wrapFixture(xml));
  return path;
}

/** Small static tables so the run is fast and deterministic. */
function writeStatics(dir) {
  const vildPath = join(dir, 'vild.json');
  writeFileSync(vildPath, JSON.stringify({ version: '6.13.A', loc: VILD_SAMPLE }));
  const plaatsenPath = join(dir, 'plaatsen.json');
  writeFileSync(
    plaatsenPath,
    JSON.stringify({
      version: '1',
      gemeenten: [
        { code: '0193', naam: 'Zwolle', slug: 'zwolle', prov: 'Overijssel', provCode: 'PV23', lon: 6.1, lat: 52.5 },
        { code: '0392', naam: 'Haarlem', slug: 'haarlem', prov: 'Noord-Holland', provCode: 'PV27', lon: 4.6, lat: 52.4 },
        { code: '0344', naam: 'Utrecht', slug: 'utrecht', prov: 'Utrecht', provCode: 'PV26', lon: 5.1, lat: 52.1 },
      ],
      woonplaatsen: [],
    }),
  );
  const registryPath = join(dir, 'bruggen.json');
  writeFileSync(
    registryPath,
    JSON.stringify({
      version: '1',
      bridges: [
        { id: 'NLHAR000220358500022', slug: 'harlinger-brug', name: 'Harlinger brug', water: 'Van Harinxmakanaal', gemeente: 'Harlingen', prov: 'Friesland', provCode: 'PV21', lon: 5.4436, lat: 53.17743 },
      ],
    }),
  );
  return { vildPath, plaatsenPath, registryPath };
}

/** One full offline run from local fixture feeds. */
async function run(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wegwerk-e2e-'));
  const outDir = join(dir, 'out');
  const cacheDir = join(dir, 'cache');
  const statics = writeStatics(dir);
  const fromFile = {
    planning: writeFeed(dir, 'planning.xml', PLANNING_FIXTURES, 200),
    actueel: writeFeed(dir, 'actueel.xml', LIVE_FIXTURES, 12),
    bruggen: writeFeed(dir, 'bruggen.xml', ['bridge.xml'], 3),
  };
  const result = await runPipeline({ outDir, cacheDir, fromFile, now: NOW, geocode: false, ...statics, ...overrides });
  return { ...result, dir, outDir, cacheDir, fromFile, statics };
}

const readJson = (/** @type {string} */ path) => JSON.parse(readFileSync(path, 'utf8'));

test('end to end: exit 0, every output file, counts and manifest', async () => {
  const { exitCode, summary, meta, outDir } = await run();
  assert.equal(exitCode, 0, summary);
  assert.match(summary, /^ok planning=1200 actueel=60 bruggen=3 /);
  assert.match(summary, / dropped=0 merged=12 geocoded=0\/\d+ ms=\d+ rss=\d+MB$/);

  const manifest = readJson(join(outDir, 'manifest.json'));
  assert.equal(Object.keys(manifest).length, 6 + 13 + 32, 'meta+3 geojson+index/all+bruggen, 13 provinces, 32 shards');
  for (const rel of Object.keys(manifest)) assert.ok(existsSync(join(outDir, rel)), `${rel} in the manifest but not on disk`);

  // 5 of the 6 planning fixtures produce an item (rws_initial starts in 2027 → future)
  const actueel = readJson(join(outDir, 'werk-actueel.geojson'));
  const gepland = readJson(join(outDir, 'werk-gepland.geojson'));
  const live = readJson(join(outDir, 'live.geojson'));
  assert.equal(actueel.type, 'FeatureCollection');
  // 4 active planning fixtures + rws_live per copy, minus the 12 rws_plan copies
  // that were merged into their own rws_live actual measure
  assert.equal(actueel.features.length, 200 * 4 + 12 - 12);
  assert.equal(gepland.features.length, 200); // the Melvin closure starts on 24 September
  assert.equal(live.features.length, 12 * 4); // file, 2 incidents, bridge per copy
  assert.equal(meta.counts.werk, 200 * 3 + 12 - 12); // rws_plan, and01, alertonly + rws_live, minus the merges
  assert.equal(meta.merged, 12);
  assert.equal(meta.counts.afsluiting, 200);
  assert.equal(meta.counts.file, 12);
  assert.equal(meta.counts.incident, 24);
  assert.equal(meta.counts.brug, 12);
  assert.equal(meta.upcoming.afsluiting, 200);
  assert.equal(meta.dropped, 0);
  assert.deepEqual(meta.unknownTypes, {});
  assert.equal(meta.sources.planning.situations, 1200);
  assert.equal(meta.sources.planning.ok, true);
  assert.equal(meta.sources.actueel.publicationTime, '2026-09-08T16:00:00Z');
  assert.ok(meta.runMs >= 0 && meta.peakRssMb > 0);

  // index/all.json has one row per feature and the rows are (id, cat, …) tuples of 17
  const all = readJson(join(outDir, 'index/all.json'));
  assert.equal(all.rows.length, actueel.features.length + gepland.features.length + live.features.length);
  assert.equal(all.generated, NOW);
  for (const row of all.rows.slice(0, 20)) assert.equal(row.length, 17);
  assert.equal(all.rows.filter((r) => r[16] === 0).length, 200);

  // every item id resolves to a detail record in its own shard
  const details = Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [i, readJson(join(outDir, `detail/${String(i).padStart(2, '0')}.json`))]),
  );
  const detailIds = new Set(Object.values(details).flatMap((shard) => Object.keys(shard)));
  assert.equal(detailIds.size, all.rows.length);
  for (const row of all.rows) assert.ok(detailIds.has(row[0]), `no detail for ${row[0]}`);
});

test('end to end: the four representative features look right', async () => {
  const { outDir } = await run();
  const actueel = readJson(join(outDir, 'werk-actueel.geojson'));
  const live = readJson(join(outDir, 'live.geojson'));
  const gepland = readJson(join(outDir, 'werk-gepland.geojson'));
  const detail = (/** @type {string} */ id) => {
    for (let i = 0; i < 32; i++) {
      const shard = readJson(join(outDir, `detail/${String(i).padStart(2, '0')}.json`));
      if (shard[id]) return shard[id];
    }
    throw new Error(`no detail for ${id}`);
  };

  // 1. RWS motorway work: road/from/to and geometry from VILD/AlertC. RWS
  // publishes this work twice, so only the actual measure ("_WWA", from
  // actueel_beeld) is emitted and the planning object is a related id on it.
  const rws = actueel.features.find((f) => f.id === 'RWS01_SM1172098_D2_WWA');
  assert.equal(actueel.features.find((f) => f.id === 'RWS01_SM1172098_D2'), undefined, 'the planning duplicate is still published');
  assert.equal(rws.properties.cat, 'werk');
  assert.equal(rws.properties.road, 'A7');
  assert.equal(rws.properties.roadType, 'A');
  assert.equal(rws.properties.src, 'Rijkswaterstaat');
  assert.equal(rws.properties.title, 'A7 · Wildinghe');
  assert.equal(rws.geometry.type, 'LineString');
  assert.deepEqual(detail(rws.id).lanes, { closed: 0, open: 1, total: 1 });
  assert.equal(detail(rws.id).from, 'Wildinghe');
  assert.equal(detail(rws.id).speed, 30);
  assert.deepEqual(detail(rws.id).related, ['RWS01_SM1172098_D2']);

  // 2. Municipal Melvin closure: gemeente and province from the publisher name
  const melvin = gepland.features.find((f) => f.id === 'NDW03_606942');
  assert.equal(melvin.properties.cat, 'afsluiting');
  assert.equal(melvin.properties.closed, true);
  assert.equal(melvin.properties.gemeente, 'Utrecht');
  assert.equal(melvin.properties.prov, 'Utrecht');
  assert.equal(melvin.properties.hind, 'C');
  assert.equal(detail(melvin.id).detour, 'Omleiding 1\nOmleiding 2');
  assert.equal(detail(melvin.id).status, 'published');
  const utrechtRow = readJson(join(outDir, 'index/prov/PV26.json')).rows.find((r) => r[0] === 'NDW03_606942');
  assert.ok(utrechtRow, 'the Melvin item is missing from the Utrecht province index');

  // 3. Live file: queue length and delay
  const file = live.features.find((f) => f.properties.cat === 'file');
  assert.equal(file.properties.sub, 'stationaryTraffic');
  assert.equal(file.properties.road, 'A9');
  assert.equal(detail(file.id).queueM, 3600);
  assert.equal(detail(file.id).delaySec, 555);
  assert.equal(detail(file.id).delay, 'upToTenMinutes');

  // 4. Bridge opening: live item plus an entry in bruggen.json from the registry
  const brug = live.features.find((f) => f.properties.cat === 'brug');
  assert.equal(brug.properties.sub, 'bridgeSwingInOperation');
  const bruggen = readJson(join(outDir, 'bruggen.json'));
  const entry = bruggen.bridges.find((b) => b.id === 'NLHAR000220358500022');
  assert.ok(entry, 'bridge missing from bruggen.json');
  assert.equal(entry.name, 'Harlinger brug');
  assert.equal(entry.slug, 'harlinger-brug');
  assert.equal(entry.openNow, true);
  assert.equal(bruggen.generated, NOW);
});

test('--now decides what is active, upcoming or gone', async () => {
  // the Melvin closure runs 24–25 September: with now inside it, it is active
  const during = await run({ now: '2026-09-24T21:00:00Z' });
  const activeIds = readJson(join(during.outDir, 'werk-actueel.geojson')).features.map((f) => f.id);
  assert.ok(activeIds.includes('NDW03_606942'));
  assert.equal(readJson(join(during.outDir, 'werk-gepland.geojson')).features.some((f) => f.id === 'NDW03_606942'), false);

  // a year later only the RWS project that runs until 2029 is left
  const later = await run({ now: '2027-12-01T12:00:00Z' });
  assert.equal(later.exitCode, 0, later.summary);
  const stillActive = readJson(join(later.outDir, 'werk-actueel.geojson')).features;
  assert.equal(stillActive.length, 200);
  assert.ok(stillActive.every((f) => f.id.endsWith('RWS01_SP466931_D2')), stillActive[0].id);
  assert.equal(readJson(join(later.outDir, 'werk-gepland.geojson')).features.length, 0);
  // open ended live records (files, incidents, bridge openings) stay active as long as the
  // current-picture feed lists them — actueel_beeld only ever contains what is happening now
  assert.equal(readJson(join(later.outDir, 'live.geojson')).features.length, 12 * 4);
  assert.equal(readJson(join(later.outDir, 'index/all.json')).rows.length, 200 + 12 * 4);
});

test('validation floor: too few situations → exit 2 and nothing is written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wegwerk-floor-'));
  const outDir = join(dir, 'out');
  const statics = writeStatics(dir);
  const result = await runPipeline({
    outDir,
    cacheDir: join(dir, 'cache'),
    fromFile: {
      planning: writeFeed(dir, 'planning.xml', PLANNING_FIXTURES, 1), // 6 « 1000
      actueel: writeFeed(dir, 'actueel.xml', LIVE_FIXTURES, 12),
      bruggen: writeFeed(dir, 'bruggen.xml', ['bridge.xml'], 1),
    },
    now: NOW,
    geocode: false,
    ...statics,
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.summary, /^invalid validation floor failed: planning=6<1000/);
  assert.equal(existsSync(join(outDir, 'manifest.json')), false, 'no output on a failed floor');
});

test('all sources unusable → exit 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wegwerk-fail-'));
  const statics = writeStatics(dir);
  const result = await runPipeline({
    outDir: join(dir, 'out'),
    cacheDir: join(dir, 'cache'),
    fromFile: { planning: join(dir, 'nope.xml'), actueel: join(dir, 'nope.xml'), bruggen: join(dir, 'nope.xml') },
    now: NOW,
    geocode: false,
    ...statics,
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.summary, /^error all sources failed/);
});

test('unchanged planning feed (HTTP 304) reuses the cached parse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wegwerk-etag-'));
  const cacheDir = join(dir, 'cache');
  const statics = writeStatics(dir);
  const planningXml = readFileSync(writeFeed(dir, 'planning.xml', PLANNING_FIXTURES, 200), 'utf8');
  const actueelXml = readFileSync(writeFeed(dir, 'actueel.xml', LIVE_FIXTURES, 12), 'utf8');
  const bruggenXml = readFileSync(writeFeed(dir, 'bruggen.xml', ['bridge.xml'], 3), 'utf8');
  const body = (/** @type {string} */ url) =>
    url === SOURCES.planning.url ? planningXml : url === SOURCES.actueel.url ? actueelXml : bruggenXml;

  /** @type {{ url: string, ifNoneMatch: string | null }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const ifNoneMatch = new Headers(init?.headers).get('if-none-match');
    calls.push({ url: String(url), ifNoneMatch });
    if (ifNoneMatch === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"' } });
    // the real feed URLs end in .xml.gz, so the pipeline gunzips the body
    return new Response(gzipSync(body(String(url))), { status: 200, headers: { etag: '"v1"' } });
  };

  const first = await runPipeline({ outDir: join(dir, 'out1'), cacheDir, now: NOW, geocode: false, fetchImpl, ...statics });
  assert.equal(first.exitCode, 0, first.summary);
  assert.equal(first.meta.sources.planning.reused, undefined);
  assert.equal(first.meta.sources.planning.etag, '"v1"');
  assert.ok(existsSync(join(cacheDir, 'last', 'planning.ndjson')));
  assert.equal(readJson(join(cacheDir, 'etags.json')).planning.etag, '"v1"');

  const second = await runPipeline({ outDir: join(dir, 'out2'), cacheDir, now: NOW, geocode: false, fetchImpl, ...statics });
  assert.equal(second.exitCode, 0, second.summary);
  assert.equal(second.meta.sources.planning.reused, true);
  assert.equal(second.meta.sources.planning.situations, 1200);
  assert.equal(second.meta.sources.planning.publicationTime, '2026-09-08T16:00:00Z');
  // only the planning feed is conditional; the live feeds are always downloaded
  assert.deepEqual(
    calls.filter((c) => c.url === SOURCES.planning.url).map((c) => c.ifNoneMatch),
    [null, '"v1"'],
  );
  assert.equal(calls.filter((c) => c.url === SOURCES.actueel.url && c.ifNoneMatch !== null).length, 0);
  // identical inputs → identical outputs
  assert.deepEqual(readJson(join(dir, 'out2', 'index/all.json')), readJson(join(dir, 'out1', 'index/all.json')));

  // --force ignores the ETag
  const forced = await runPipeline({ outDir: join(dir, 'out3'), cacheDir, now: NOW, geocode: false, force: true, fetchImpl, ...statics });
  assert.equal(forced.meta.sources.planning.reused, undefined);
  assert.equal(calls.filter((c) => c.url === SOURCES.planning.url).at(-1)?.ifNoneMatch, null);
});

test('a failing download falls back to the cached parse of the previous run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wegwerk-fallback-'));
  const cacheDir = join(dir, 'cache');
  const statics = writeStatics(dir);
  mkdirSync(join(cacheDir, 'last'), { recursive: true });
  const situation = { id: 'CACHED_1', sev: 'medium', ver: '2026-09-09T00:00:00Z', recs: [{ id: 'CACHED_1_01', type: 'MaintenanceWorks', start: '2026-09-09T00:00:00Z', end: '2026-09-30T00:00:00Z', src: 'Gemeente Zwolle', locs: [{ kind: 'point', point: [6.1, 52.5] }] }] };
  writeFileSync(join(cacheDir, 'last', 'planning.ndjson'), JSON.stringify(situation) + '\n');
  /** @type {typeof fetch} */
  const fetchImpl = async () => new Response('nope', { status: 500 });
  const result = await runPipeline({
    outDir: join(dir, 'out'),
    cacheDir,
    sources: 'planning',
    now: NOW,
    geocode: false,
    fetchImpl,
    ...statics,
  });
  // one cached situation is below the floor, so publishing is refused — but the cache was read
  assert.equal(result.exitCode, 2, result.summary);
  assert.match(result.summary, /planning=1<1000/);
});

test('--sources selects a subset', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wegwerk-subset-'));
  const statics = writeStatics(dir);
  const result = await runPipeline({
    outDir: join(dir, 'out'),
    cacheDir: join(dir, 'cache'),
    sources: 'actueel',
    fromFile: { actueel: writeFeed(dir, 'actueel.xml', LIVE_FIXTURES, 12) },
    now: NOW,
    geocode: false,
    ...statics,
  });
  assert.equal(result.exitCode, 0, result.summary);
  assert.match(result.summary, /^ok planning=0 actueel=60 bruggen=0 /);
  assert.deepEqual(Object.keys(result.meta.sources), ['actueel']);
});

test('parseCli: flags, defaults and errors', () => {
  const { options } = parseCli(['--out', 'dist/data']);
  assert.equal(options.outDir, 'dist/data');
  assert.equal(options.geocode, true);
  assert.equal(options.force, false);
  assert.equal(options.verbose, false);
  assert.equal(options.geocodeMax, undefined);
  assert.equal(options.fromFile, undefined);

  const full = parseCli([
    '--out', 'o',
    '--sources', 'planning,actueel',
    '--from-file', 'planning=a.xml',
    '--from-file', 'actueel=b.xml.gz',
    '--now', NOW,
    '--no-geocode',
    '--geocode-max', '25',
    '--cache', 'c',
    '--force',
    '--verbose',
  ]).options;
  assert.equal(full.sources, 'planning,actueel');
  assert.deepEqual(full.fromFile, { planning: 'a.xml', actueel: 'b.xml.gz' });
  assert.equal(full.now, NOW);
  assert.equal(full.geocode, false);
  assert.equal(full.geocodeMax, 25);
  assert.equal(full.cacheDir, 'c');
  assert.equal(full.force, true);
  assert.equal(full.verbose, true);

  assert.equal(parseCli(['--help']).help, true);
  assert.throws(() => parseCli([]), /--out <dir> is required/);
  assert.throws(() => parseCli(['--out', 'o', '--from-file', 'planning.xml']), /--from-file expects name=path/);
  assert.throws(() => parseCli(['--out', 'o', '--geocode-max', 'veel']), /--geocode-max expects a non-negative integer/);
  assert.throws(() => parseCli(['--out', 'o', '--geocode-max=-1']), /--geocode-max expects a non-negative integer/);
  // --sources is validated when the run starts, not while parsing
});

test('an invalid --now or an unknown source is rejected before anything is written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wegwerk-now-'));
  const base = { outDir: join(dir, 'out'), cacheDir: join(dir, 'cache'), geocode: false, ...writeStatics(dir) };
  await assert.rejects(() => runPipeline({ ...base, now: 'gisteren' }), /Invalid --now value/);
  await assert.rejects(() => runPipeline({ ...base, now: NOW, sources: 'onzin' }), /Unknown source "onzin"/);
  assert.equal(existsSync(join(dir, 'out', 'manifest.json')), false);
});
