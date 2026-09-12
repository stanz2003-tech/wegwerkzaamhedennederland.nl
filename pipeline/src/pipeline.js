/**
 * Orchestrator: fetch/reuse each source → stream-parse → build items →
 * geocode → finalize → write outputs. Exit codes per build-contracts.md:
 * 0 ok, 1 all sources failed / output not writable, 2 validation floor.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridgeBook, loadRegistry } from './bridges.js';
import { dedupeDoublePublications, spread } from './dedup.js';
import { fetchFeed, openLocalFile, readEtags, writeEtags } from './fetch.js';
import { createGeocoder, DEFAULT_GEOCODE_MAX } from './geocode.js';
import { buildItem, finalizeItem } from './item.js';
import { createLogger } from './log.js';
import { createNdjsonWriter, readNdjson, writeOutputs } from './output.js';
import { parseFeed } from './parse.js';
import { selectSources } from './sources.js';
import { normalizeProvince } from './sources-friendly.js';
import { toMs } from './time.js';
import { loadVild } from './vild.js';

export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../cache', import.meta.url));
const DEFAULT_PLAATSEN_PATH = fileURLToPath(new URL('../static/plaatsen.json', import.meta.url));
const CATEGORIES = ['werk', 'afsluiting', 'file', 'incident', 'brug', 'evenement', 'overig'];
const LIVE_CATS = new Set(['file', 'incident', 'brug']);

/**
 * @typedef {object} RunOptions
 * @property {string} outDir
 * @property {string=} sources                 comma separated
 * @property {Record<string, string>=} fromFile  source name → local path
 * @property {string=} now                     ISO time override
 * @property {boolean=} geocode                default true
 * @property {number=} geocodeMax
 * @property {string=} cacheDir
 * @property {boolean=} force
 * @property {boolean=} verbose
 * @property {typeof fetch=} fetchImpl
 * @property {string=} vildPath
 * @property {string=} registryPath
 * @property {string=} plaatsenPath
 * @property {ReturnType<typeof createLogger>=} log
 */

/**
 * @param {RunOptions} options
 * @returns {Promise<{ exitCode: 0|1|2, summary: string, meta?: object }>}
 */
export async function runPipeline(options) {
  const t0 = Date.now();
  const sampler = startRssSampler();
  const log = options.log ?? createLogger({ level: options.verbose ? 'debug' : 'info' });
  const nowMs = options.now ? toMs(options.now) : Date.now();
  if (nowMs === undefined) throw new Error(`Invalid --now value: ${options.now}`);
  const cacheDir = resolve(options.cacheDir ?? DEFAULT_CACHE_DIR);
  const outDir = resolve(options.outDir);
  const defs = selectSources(options.sources);
  const fetchImpl = options.fetchImpl ?? fetch;

  const vild = loadVild(options.vildPath);
  const provOfGemeente = loadGemeenteProvinces(options.plaatsenPath ?? DEFAULT_PLAATSEN_PATH, log);
  const geocoder = createGeocoder({
    cachePath: join(cacheDir, 'geocode.json'),
    maxNew: options.geocodeMax ?? DEFAULT_GEOCODE_MAX,
    enabled: options.geocode !== false,
    fetchImpl,
    nowMs,
    log,
  });
  const bridges = createBridgeBook({ registry: loadRegistry(options.registryPath), seenPath: join(cacheDir, 'bruggen-seen.json'), nowMs, vild });
  const etags = readEtags(cacheDir);

  /** @type {import('./item.js').Item[]} */
  const items = [];
  const seenIds = new Set();
  /** @type {Record<string, object>} */
  const sourcesMeta = {};
  const totals = { dropped: 0, duplicates: 0, skipped: {} };
  /** @type {Record<string, number>} */
  const unknownTypes = {};
  const ctx = { vild, nowMs, provOfGemeente };

  for (const def of defs) {
    const result = await ingestSource(def, {
      cacheDir,
      etags,
      force: options.force === true,
      fromFile: options.fromFile?.[def.name],
      fetchImpl,
      log,
      nowMs,
      handle: (/** @type {import('./parse.js').Situation} */ situation, /** @type {Stage} */ stage) =>
        handleSituation(situation, def.role, ctx, stage),
    });
    sourcesMeta[def.name] = result.meta;
    if (result.stage) {
      for (const item of result.stage.items) {
        if (seenIds.has(item.id)) {
          totals.duplicates++;
          continue;
        }
        seenIds.add(item.id);
        items.push(item);
      }
      for (const note of result.stage.bridgeNotes) bridges.note(note);
      totals.dropped += result.stage.dropped;
      for (const [k, v] of Object.entries(result.stage.skipped)) totals.skipped[k] = (totals.skipped[k] ?? 0) + v;
      for (const [k, v] of Object.entries(result.stage.unknown)) unknownTypes[k] = (unknownTypes[k] ?? 0) + v;
    }
    log.info('source done', { source: def.name, ...result.meta });
  }

  const failed = defs.filter((d) => !sourcesMeta[d.name].ok && sourcesMeta[d.name].situations === 0);
  if (failed.length === defs.length) {
    sampler.stop();
    const summary = `error all sources failed: ${failed.map((d) => `${d.name}=${sourcesMeta[d.name].error ?? 'unknown'}`).join(' ')}`;
    return { exitCode: 1, summary };
  }
  const belowFloor = defs.filter((d) => d.floor > 0 && sourcesMeta[d.name].situations < d.floor);
  if (belowFloor.length > 0) {
    sampler.stop();
    const summary = `invalid validation floor failed: ${belowFloor.map((d) => `${d.name}=${sourcesMeta[d.name].situations}<${d.floor}`).join(' ')}`;
    return { exitCode: 2, summary };
  }

  await geocodeItems(items, geocoder, nowMs);
  await geocodeBridges(bridges, geocoder);
  await geocoder.flush();
  const bridgeEntries = bridges.build((lon, lat) => geocoder.cached(lon, lat));

  // RWS publishes a running measure twice (planning object + actual measure).
  const deduped = dedupeDoublePublications(items);
  log.info('deduplicated double publications', {
    merged: deduped.stats.merged,
    sameIdBase: deduped.stats.sameIdBase,
    declaredRelated: deduped.stats.declaredRelated,
    crossCategory: deduped.stats.crossCategory,
    multiCandidate: deduped.stats.multiCandidate,
    ambiguousSkipped: deduped.stats.ambiguousSkipped,
    blockedBySrc: deduped.stats.blockedBySrc,
    enriched: deduped.stats.enriched,
    distanceM: spread(deduped.stats.distances),
    nearMissM: spread(deduped.stats.nearMissM),
    actualsWithoutRoad: deduped.stats.nearMissNoRoad,
  });
  if (deduped.stats.unproven.length > 0) {
    log.debug('merges without an explicit publisher link', { count: deduped.stats.unproven.length, pairs: deduped.stats.unproven.slice(0, 40) });
  }

  const actueel = deduped.items.filter((i) => i.state === 'active' && !LIVE_CATS.has(i.cat));
  const live = deduped.items.filter((i) => LIVE_CATS.has(i.cat));
  const gepland = deduped.items.filter((i) => i.state === 'upcoming');
  sortItems(actueel);
  sortItems(live);
  sortItems(gepland);

  const runMs = Date.now() - t0;
  const meta = {
    sources: sourcesMeta,
    merged: deduped.stats.merged,
    counts: countByCat([...actueel, ...live]),
    upcoming: countByCat(gepland),
    dropped: totals.dropped,
    unknownTypes,
    runMs,
    peakRssMb: sampler.peakMb(),
  };
  const generated = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

  try {
    writeOutputs({ outDir, generated, actueel, gepland, live, bridges: bridgeEntries, meta });
  } catch (err) {
    sampler.stop();
    return { exitCode: 1, summary: `error writing outputs: ${err instanceof Error ? err.message : String(err)}` };
  }
  geocoder.save();
  bridges.saveSeen();
  writeEtags(cacheDir, etags);
  sampler.stop();

  const stats = geocoder.stats;
  const n = (/** @type {string} */ name) => sourcesMeta[name]?.situations ?? 0;
  const finalMs = Date.now() - t0;
  meta.runMs = finalMs;
  meta.peakRssMb = sampler.peakMb();
  log.debug('run details', { skipped: totals.skipped, duplicates: totals.duplicates, geocode: stats, bridges: bridgeEntries.length, newBridgeIds: bridges.newSeen() });
  const summary =
    `ok planning=${n('planning')} actueel=${n('actueel')} bruggen=${n('bruggen')} ` +
    `active=${actueel.length} upcoming=${gepland.length} live=${live.length} dropped=${totals.dropped} merged=${deduped.stats.merged} ` +
    `geocoded=${stats.fetched}/${stats.pending} ms=${finalMs} rss=${sampler.peakMb()}MB`;
  return { exitCode: 0, summary, meta };
}

/**
 * @typedef {object} Stage
 * @property {import('./item.js').Item[]} items
 * @property {object[]} bridgeNotes
 * @property {number} dropped
 * @property {Record<string, number>} skipped
 * @property {Record<string, number>} unknown
 */

/** @returns {Stage} */
function newStage() {
  return { items: [], bridgeNotes: [], dropped: 0, skipped: {}, unknown: {} };
}

/**
 * @param {import('./parse.js').Situation} situation
 * @param {'planning'|'live'|'bridges'} role
 * @param {import('./item.js').BuildContext} ctx
 * @param {Stage} stage
 */
function handleSituation(situation, role, ctx, stage) {
  if (role === 'bridges') {
    for (const note of bridgeNotesOf(situation, false)) stage.bridgeNotes.push(note);
    return;
  }
  const result = buildItem(situation, role, ctx);
  stage.dropped += result.dropped;
  for (const type of result.unknown) stage.unknown[type] = (stage.unknown[type] ?? 0) + 1;
  if (result.skip) {
    stage.skipped[result.skip] = (stage.skipped[result.skip] ?? 0) + 1;
    return;
  }
  const item = /** @type {import('./item.js').Item} */ (result.item);
  stage.items.push(item);
  if (item.cat === 'brug' && role === 'live') {
    for (const note of bridgeNotesOf(situation, true)) stage.bridgeNotes.push(note);
  }
}

/**
 * @param {import('./parse.js').Situation} situation
 * @param {boolean} openNow
 */
function bridgeNotesOf(situation, openNow) {
  /** @type {object[]} */
  const notes = [];
  for (const rec of situation.recs) {
    if (rec.gnm !== 'bridgeSwingInOperation') continue;
    const loc = rec.locs.find((l) => l.ris && l.point);
    if (!loc || !loc.ris || !loc.point) continue;
    notes.push({ ris: loc.ris, point: loc.point, alertC: loc.alertC?.p, start: rec.start, end: rec.end, openNow });
  }
  return notes;
}

/**
 * Fetch (or reuse) one source and stream it through `handle`.
 * @param {import('./sources.js').SourceDef} def
 * @param {object} ctx
 * @param {string} ctx.cacheDir
 * @param {Record<string, import('./fetch.js').EtagEntry>} ctx.etags
 * @param {boolean} ctx.force
 * @param {string=} ctx.fromFile
 * @param {typeof fetch} ctx.fetchImpl
 * @param {ReturnType<typeof createLogger>} ctx.log
 * @param {number} ctx.nowMs
 * @param {(situation: import('./parse.js').Situation, stage: Stage) => void} ctx.handle
 * @returns {Promise<{ meta: Record<string, unknown>, stage?: Stage }>}
 */
async function ingestSource(def, ctx) {
  const { cacheDir, etags, log } = ctx;
  const lastPath = join(cacheDir, 'last', `${def.name}.ndjson`);
  const prior = etags[def.name];
  /** @type {Record<string, unknown>} */
  const meta = { url: def.url, ok: false, situations: 0 };

  /** @type {AsyncIterable<string> | undefined} */
  let stream;
  let reuse = false;
  /** @type {string | undefined} */
  let etag;
  /** @type {string | undefined} */
  let lastModified;

  if (ctx.fromFile) {
    meta.url = ctx.fromFile;
    try {
      stream = openLocalFile(ctx.fromFile);
    } catch (err) {
      meta.error = err instanceof Error ? err.message : String(err);
      return { meta };
    }
  } else {
    const canReuse = def.conditional && !ctx.force && prior?.etag !== undefined && existsSync(lastPath);
    const res = await fetchFeed(def.url, { ifNoneMatch: canReuse ? prior?.etag : undefined, fetchImpl: ctx.fetchImpl, log });
    if (res.status === 'unchanged') {
      reuse = true;
      etag = res.etag;
      lastModified = res.lastModified ?? prior?.lastModified;
      log.info('feed unchanged, reusing cached parse', { source: def.name, etag });
    } else if (res.status === 'ok') {
      stream = res.stream;
      etag = res.etag;
      lastModified = res.lastModified;
    } else {
      meta.error = res.error;
      if (existsSync(lastPath)) {
        reuse = true;
        log.warn('fetch failed, falling back to cached parse', { source: def.name, error: res.error });
      } else {
        log.error('fetch failed, no cached parse available', { source: def.name, error: res.error });
        return { meta };
      }
    }
  }

  if (stream) {
    const stage = newStage();
    const writer = createNdjsonWriter(lastPath);
    try {
      const { publicationTime, count } = await parseFeed(stream, async (situation) => {
        await writer.write(situation);
        ctx.handle(situation, stage);
      });
      await writer.close();
      meta.ok = true;
      meta.situations = count;
      if (publicationTime) meta.publicationTime = publicationTime;
      if (lastModified) meta.lastModified = lastModified;
      if (etag) meta.etag = etag;
      if (!ctx.fromFile) etags[def.name] = compact({ etag, lastModified, publicationTime, fetchedAt: new Date(ctx.nowMs).toISOString() });
      return { meta, stage };
    } catch (err) {
      await writer.abort();
      meta.error = err instanceof Error ? err.message : String(err);
      log.error('parse failed', { source: def.name, error: meta.error });
      if (!existsSync(lastPath) || ctx.fromFile) return { meta };
      reuse = true;
      log.warn('falling back to cached parse', { source: def.name });
    }
  }

  if (reuse) {
    const stage = newStage();
    try {
      const count = await readNdjson(lastPath, (situation) => ctx.handle(situation, stage));
      meta.situations = count;
      meta.reused = true;
      meta.ok = meta.error === undefined;
      if (prior?.publicationTime) meta.publicationTime = prior.publicationTime;
      if (lastModified ?? prior?.lastModified) meta.lastModified = lastModified ?? prior?.lastModified;
      if (etag ?? prior?.etag) meta.etag = etag ?? prior?.etag;
      return { meta, stage };
    } catch (err) {
      meta.error = `${meta.error ? meta.error + '; ' : ''}cache unreadable: ${err instanceof Error ? err.message : String(err)}`;
      meta.ok = false;
      return { meta };
    }
  }
  return { meta };
}

/**
 * Live items first, then active, then upcoming; the cap decides how far we get.
 * @param {import('./item.js').Item[]} items
 * @param {import('./geocode.js').Geocoder} geocoder
 * @param {number} nowMs
 */
async function geocodeItems(items, geocoder, nowMs) {
  const rank = (/** @type {import('./item.js').Item} */ i) => (LIVE_CATS.has(i.cat) ? 0 : i.state === 'active' ? 1 : 2);
  const ordered = [...items].sort((a, b) => rank(a) - rank(b));
  for (const item of ordered) {
    const geo = await geocoder.lookup(item.mid[0], item.mid[1], { live: LIVE_CATS.has(item.cat) });
    finalizeItem(item, geo, nowMs);
  }
}

/**
 * Observed bridges that are not in the registry need a place for their fallback name.
 * @param {ReturnType<typeof createBridgeBook>} bridges
 * @param {import('./geocode.js').Geocoder} geocoder
 */
async function geocodeBridges(bridges, geocoder) {
  for (const obs of bridges.observed.values()) {
    await geocoder.lookup(obs.lon, obs.lat);
  }
}

/** @param {import('./item.js').Item[]} items */
function sortItems(items) {
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** @param {import('./item.js').Item[]} items */
function countByCat(items) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const item of items) counts[item.cat] = (counts[item.cat] ?? 0) + 1;
  return counts;
}

/**
 * gemeente name → province from static/plaatsen.json (when present) so Melvin
 * items get a province without a geocoder round trip.
 * @param {string} path
 * @param {ReturnType<typeof createLogger>} log
 */
function loadGemeenteProvinces(path, log) {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    /** @type {Map<string, { prov: string, provCode: string }>} */
    const map = new Map();
    for (const g of parsed.gemeenten ?? []) {
      const prov = normalizeProvince(g.prov);
      if (g.naam && prov) map.set(String(g.naam).toLowerCase(), { prov: prov.name, provCode: prov.code });
    }
    return (/** @type {string} */ gemeente) => map.get(gemeente.toLowerCase());
  } catch (err) {
    log.warn('plaatsen.json unreadable, provinces of gemeenten unknown', { path, error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

function startRssSampler() {
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
  }, 250);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      const rss = process.memoryUsage().rss;
      if (rss > peak) peak = rss;
    },
    peakMb: () => Math.round(peak / 1048576),
  };
}

/**
 * @template {object} T
 * @param {T} obj
 */
function compact(obj) {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key];
  return obj;
}
