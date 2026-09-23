#!/usr/bin/env node
/**
 * Deterministic fixture generator for the frontend data contract (web/src/data/types.ts).
 *
 * Writes a complete, contract-valid data set to web/fixtures/data/ so `npm run dev`,
 * `npm run build` and the test suite never need the real NDW feeds. Everything is derived
 * from one fixed base timestamp — no randomness, no network, no reading of the system clock —
 * so re-running the script produces byte-identical files.
 *
 * Usage:
 *   node scripts/make-fixtures.mjs [--now <ISO>] [--out <dir>]
 *
 *   --now   base timestamp; every item time is an offset from it.
 *           Default 2026-09-09T12:00:00Z = Wednesday 14:00 Europe/Amsterdam (CEST),
 *           chosen so "vandaag" still has hours left and the weekend window lies ahead.
 *   --out   output directory (default web/fixtures/data).
 *
 * Produced files (contract v4): meta.json, werk-actueel.geojson, werk-gepland.geojson, live.geojson,
 * index/all.json, index/prov/<PVxx>.json (13 codes incl. `_`), detail/<NN>.json for the
 * occupied shards only, bruggen.json, roads/<slug>.json and gemeenten/<slug>.json (EntityFile per
 * road / gemeente that has items) and manifest.json (sha1 per file, written last).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN, PROVINCES, PROVINCE_CODES, compact, impactOf, iso, midpointOf, roadKey, round5, sha1, shardOf, slugify, vehiclesOf,
} from '../fixtures/source/helpers.mjs';
import { activeItems, bridges, liveItems, plannedItems } from '../fixtures/source/items.mjs';

const DEFAULT_NOW = '2026-09-09T12:00:00Z';
const DATA_VERSION = '4';
/** Same boundary as pipeline/src/time.js UPCOMING_DAYS: measures starting later are not published. */
const HORIZON_DAYS = 30;

/* -------------------------------- assembling -------------------------------- */

function propertiesOf(spec, nowMs) {
  return compact({
    id: spec.id,
    cat: spec.cat,
    sub: spec.sub,
    sev: spec.sev,
    title: spec.title,
    road: spec.road,
    roadType: spec.roadType,
    gemeente: spec.gemeente,
    woonplaats: spec.woonplaats,
    prov: spec.prov ? PROVINCES[spec.prov] : undefined,
    start: iso(nowMs + spec.s),
    end: spec.e === null || spec.e === undefined ? undefined : iso(nowMs + spec.e),
    closed: spec.closed ? true : undefined,
    hind: spec.hind,
    prob: spec.prob,
    src: spec.src,
    // Contract v3 impact data.
    imp: impactOf(spec),
    veh: vehiclesOf(spec),
    // As the pipeline: per = periods || tl || tlTo (contract v4).
    per: spec.d?.periods || spec.d?.tl || spec.d?.tlTo ? true : undefined,
    spd: spec.d?.speed,
    lc: spec.d?.lanes?.closed > 0 ? spec.d.lanes.closed : undefined,
  });
}

function featureOf(spec, nowMs) {
  return { type: 'Feature', id: spec.id, geometry: spec.g, properties: propertiesOf(spec, nowMs) };
}

function rowOf(spec, nowMs, active) {
  const p = propertiesOf(spec, nowMs);
  const [lon, lat] = midpointOf(spec.g);
  return [
    p.id, p.cat, p.sub ?? null, p.sev, p.title, p.road ?? null, p.roadType ?? null, p.gemeente ?? null,
    p.woonplaats ?? null, p.prov ?? null, p.start, p.end ?? null, round5(lon), round5(lat),
    p.closed ? 1 : 0, p.hind ?? null, active,
    // v3 positions 17–21.
    p.imp, p.veh ?? null, p.per ? 1 : 0, p.spd ?? null, p.lc ?? null,
  ];
}

/**
 * EntityFiles: every item of one road (`roads/<slug>.json`) or gemeente (`gemeenten/<slug>.json`)
 * with geometry AND full detail, active items first, then by start. Slugs follow the static
 * lists: the road number lower-cased ("A2" → "a2"), `slugify(gemeente)` for gemeenten.
 */
function entityFiles(specsWithActive, nowMs) {
  const groups = new Map();
  const add = (kind, key, slug, entry) => {
    const id = `${kind}:${slug}`;
    if (!groups.has(id)) groups.set(id, { kind, key, slug, entries: [] });
    groups.get(id).entries.push(entry);
  };
  for (const [spec, active] of specsWithActive) {
    const entry = { spec, active };
    const road = roadKey(spec.road);
    if (road) add('road', road, road.toLowerCase(), entry);
    if (spec.gemeente) add('gemeente', spec.gemeente, slugify(spec.gemeente), entry);
  }
  const files = [];
  for (const g of [...groups.values()].sort((a, b) => (a.kind + a.slug < b.kind + b.slug ? -1 : 1))) {
    const items = g.entries
      .sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : a.spec.s - b.spec.s || (a.spec.id < b.spec.id ? -1 : 1)))
      .map(({ spec }) => ({ f: featureOf(spec, nowMs), d: detailOf(spec, nowMs) }));
    const dir = g.kind === 'road' ? 'roads' : 'gemeenten';
    files.push([`${dir}/${g.slug}.json`, { generated: iso(nowMs), kind: g.kind, key: g.key, slug: g.slug, items }]);
  }
  return files;
}

function detailOf(spec, nowMs) {
  const { upd, ...rest } = spec.d;
  return compact({ id: spec.id, ...rest, src: spec.src, upd: iso(nowMs + upd) });
}

function collection(specs, nowMs) {
  return { type: 'FeatureCollection', features: specs.map((s) => featureOf(s, nowMs)) };
}

function countsOf(specs) {
  const counts = { werk: 0, afsluiting: 0, file: 0, incident: 0, brug: 0, evenement: 0, overig: 0 };
  for (const s of specs) counts[s.cat] += 1;
  return counts;
}

function metaOf(nowMs, active, planned, live) {
  const counts = countsOf([...active, ...live]);
  const upcoming = countsOf(planned);
  return {
    generated: iso(nowMs),
    version: DATA_VERSION,
    sources: {
      planning: {
        url: 'https://opendata.ndw.nu/planningsfeed_wegwerkzaamheden_en_evenementen.xml.gz', ok: true,
        publicationTime: iso(nowMs - 22 * MIN), etag: '"fixture-planning-1"', reused: true, situations: 17446,
      },
      actueel: {
        url: 'https://opendata.ndw.nu/actueel_beeld.xml.gz', ok: true,
        publicationTime: iso(nowMs - 3 * MIN), lastModified: iso(nowMs - 3 * MIN), situations: 1110,
      },
      bruggen: {
        url: 'https://opendata.ndw.nu/planningsfeed_brugopeningen.xml.gz', ok: true,
        publicationTime: iso(nowMs - 9 * MIN), situations: 1610,
      },
    },
    counts,
    upcoming,
    horizon: { days: HORIZON_DAYS, until: iso(nowMs + HORIZON_DAYS * 24 * 60 * MIN) },
    dropped: 2,
    // Double publications folded into one item: equal to the number of ids in every
    // `ItemDetail.related` of this fixture set (see fixtures/source/items.mjs).
    merged: 3,
    unknownTypes: { 'sit:WinterDrivingManagement': 3 },
    runMs: 8421,
    peakRssMb: 312,
  };
}

/* ---------------------------------- writing --------------------------------- */

function parseArgs(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  let now = DEFAULT_NOW;
  let out = resolve(here, '..', 'fixtures', 'data');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--now' && argv[i + 1]) now = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) out = resolve(argv[++i]);
    else throw new Error(`onbekend argument: ${argv[i]}`);
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) throw new Error(`--now is geen geldige ISO-tijd: ${now}`);
  if (nowMs % MIN !== 0) throw new Error('--now moet op een hele minuut liggen');
  return { nowMs, out };
}

export function buildFixtures(nowMs) {
  const active = activeItems();
  const planned = plannedItems(nowMs);
  const live = liveItems();

  /** @type {Array<[string, unknown]>} */
  const files = [];
  files.push(['werk-actueel.geojson', collection(active, nowMs)]);
  files.push(['werk-gepland.geojson', collection(planned, nowMs)]);
  files.push(['live.geojson', collection(live, nowMs)]);

  const rows = [];
  const byProv = Object.fromEntries(PROVINCE_CODES.map((c) => [c, []]));
  const push = (spec, isActive) => {
    const row = rowOf(spec, nowMs, isActive);
    rows.push(row);
    byProv[spec.prov && byProv[spec.prov] ? spec.prov : '_'].push(row);
  };
  for (const s of active) push(s, 1);
  for (const s of live) push(s, 1);
  for (const s of planned) push(s, 0);
  const generated = iso(nowMs);
  files.push(['index/all.json', { generated, rows }]);
  for (const code of PROVINCE_CODES) files.push([`index/prov/${code}.json`, { generated, rows: byProv[code] }]);

  const shards = new Map();
  for (const spec of [...active, ...live, ...planned]) {
    const shard = shardOf(spec.id);
    if (!shards.has(shard)) shards.set(shard, {});
    shards.get(shard)[spec.id] = detailOf(spec, nowMs);
  }
  for (const shard of [...shards.keys()].sort((a, b) => a - b)) {
    const entries = Object.entries(shards.get(shard)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    files.push([`detail/${String(shard).padStart(2, '0')}.json`, Object.fromEntries(entries)]);
  }

  files.push(['bruggen.json', { generated, bridges: bridges(nowMs) }]);
  files.push(...entityFiles([...active.map((s) => [s, 1]), ...live.map((s) => [s, 1]), ...planned.map((s) => [s, 0])], nowMs));
  files.push(['meta.json', metaOf(nowMs, active, planned, live)]);
  return files;
}

function main() {
  const { nowMs, out } = parseArgs(process.argv.slice(2));
  rmSync(out, { recursive: true, force: true });
  const files = buildFixtures(nowMs);
  const manifest = {};
  for (const [rel, obj] of files) {
    const json = JSON.stringify(obj);
    const target = join(out, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, json);
    manifest[rel] = sha1(json);
  }
  const manifestJson = JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1))));
  writeFileSync(join(out, 'manifest.json'), manifestJson);
  const total = files.reduce((n, [, obj]) => n + JSON.stringify(obj).length, 0) + manifestJson.length;
  console.log(`[make-fixtures] ${files.length + 1} bestanden, ${(total / 1024).toFixed(1)} KB, now = ${iso(nowMs)}`);
  console.log(`[make-fixtures] doelmap: ${out}`);
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`[make-fixtures] mislukt: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
