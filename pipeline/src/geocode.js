/**
 * Reverse geocoding via the PDOK Locatieserver (key-less, CC0 data) with a
 * persistent JSON cache. Lookups are sequential, paced ≥ 80 ms apart, capped
 * per run, time out after 10 s and never throw — an unreachable geocoder only
 * means fewer place names in this run.
 *
 * Cache file (`<cache>/geocode.json`): `{ "<lon3>,<lat3>": Entry }` — keyed on the
 * rounded coordinate only (~110 m cell), so items that share a cell share one
 * lookup and a new situation at a known spot costs no request.
 * Entries of live items (files/incidents) are pruned after 2 days, others
 * after 90 days without use, so the committed file stays small.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PDOK_REVERSE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse';
const FIELDS = 'straatnaam,woonplaatsnaam,gemeentenaam,gemeentecode,provincienaam,provinciecode,afstand';

export const DEFAULT_GEOCODE_MAX = 400;
export const DEFAULT_SPACING_MS = 80;
export const DEFAULT_TIMEOUT_MS = 10_000;
const LIVE_TTL_MS = 2 * 24 * 3600 * 1000;
const STALE_TTL_MS = 90 * 24 * 3600 * 1000;

/**
 * @typedef {object} GeoEntry
 * @property {string=} straat
 * @property {string=} woonplaats
 * @property {string=} gemeente
 * @property {string=} gemeenteCode
 * @property {string=} prov
 * @property {string=} provCode
 * @property {string} at        ISO time of the lookup
 * @property {1=} live          set for transient items (short TTL)
 */

/**
 * Cache key: the coordinate rounded to 3 decimals (~110 m north-south).
 * @param {number} lon
 * @param {number} lat
 */
export function geocodeKey(lon, lat) {
  return `${lon.toFixed(3)},${lat.toFixed(3)}`;
}

/**
 * Convert a Locatieserver document to a cache entry.
 * @param {Record<string, unknown> | undefined} doc
 * @param {string} at
 * @returns {GeoEntry}
 */
export function entryFromDoc(doc, at) {
  /** @type {GeoEntry} */
  const entry = { at };
  if (!doc) return entry;
  const str = (/** @type {unknown} */ v) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  entry.straat = str(doc.straatnaam);
  entry.woonplaats = str(doc.woonplaatsnaam);
  entry.gemeente = str(doc.gemeentenaam);
  entry.gemeenteCode = str(doc.gemeentecode);
  entry.prov = str(doc.provincienaam);
  entry.provCode = str(doc.provinciecode);
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  return entry;
}

/**
 * @param {object} options
 * @param {string=} options.cachePath      omit for an in-memory cache (tests)
 * @param {number=} options.maxNew         lookups allowed this run
 * @param {number=} options.spacingMs
 * @param {number=} options.timeoutMs
 * @param {typeof fetch=} options.fetchImpl
 * @param {boolean=} options.enabled       false = cache only (`--no-geocode`)
 * @param {number=} options.nowMs
 * @param {{ warn(m: string, f?: object): void, debug(m: string, f?: object): void }=} options.log
 * @param {string=} options.userAgent
 */
export function createGeocoder(options) {
  const {
    cachePath,
    maxNew = DEFAULT_GEOCODE_MAX,
    spacingMs = DEFAULT_SPACING_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    enabled = true,
    nowMs = Date.now(),
    log,
    userAgent = 'wegwerk-pipeline (+https://github.com/wegwerk)',
  } = options;

  /** @type {Record<string, GeoEntry>} */
  const cache = loadCache(cachePath, log);
  const used = new Set();
  const stats = { hits: 0, fetched: 0, failed: 0, pending: 0, skipped: 0 };
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  let lastRequestAt = 0;
  let consecutiveFailures = 0;

  /**
   * @param {number} lon
   * @param {number} lat
   * @returns {GeoEntry | undefined}
   */
  function cached(lon, lat) {
    const key = geocodeKey(lon, lat);
    const entry = cache[key];
    if (entry) used.add(key);
    return entry;
  }

  /**
   * Cached entry, or a fresh lookup when the cap allows it, else undefined.
   * @param {number} lon
   * @param {number} lat
   * @param {{ live?: boolean }=} opts
   * @returns {Promise<GeoEntry | undefined>}
   */
  function lookup(lon, lat, opts = {}) {
    const key = geocodeKey(lon, lat);
    const hit = cache[key];
    if (hit) {
      stats.hits++;
      used.add(key);
      // a cell first seen for a file/incident becomes long-lived once a planning item needs it
      if (hit.live && opts.live !== true) delete hit.live;
      return Promise.resolve(hit);
    }
    if (!enabled || stats.fetched + stats.failed >= maxNew || consecutiveFailures >= 5) {
      stats.pending++;
      return Promise.resolve(undefined);
    }
    const run = queue.then(() => fetchOne(key, lon, lat, opts.live === true));
    queue = run.catch(() => undefined);
    return run;
  }

  /** @param {string} key @param {number} lon @param {number} lat @param {boolean} live */
  async function fetchOne(key, lon, lat, live) {
    if (cache[key]) return cache[key];
    if (stats.fetched + stats.failed >= maxNew || consecutiveFailures >= 5) {
      stats.pending++;
      return undefined;
    }
    const wait = lastRequestAt + spacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const url = `${PDOK_REVERSE_URL}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&type=weg&rows=1&fl=${FIELDS}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': userAgent } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = /** @type {{ response?: { docs?: Record<string, unknown>[] } }} */ (await res.json());
      const doc = body?.response?.docs?.[0];
      const entry = entryFromDoc(doc, new Date(nowMs).toISOString());
      if (live) entry.live = 1;
      cache[key] = entry;
      used.add(key);
      stats.fetched++;
      consecutiveFailures = 0;
      return entry;
    } catch (err) {
      stats.failed++;
      consecutiveFailures++;
      log?.warn('geocode failed', { key, error: err instanceof Error ? err.message : String(err) });
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Wait for the queue to drain. */
  async function flush() {
    await queue;
  }

  /** Persist the cache (pruned). No-op for in-memory caches. */
  function save() {
    const pruned = prune(cache, used, nowMs);
    if (!cachePath) return pruned;
    mkdirSync(dirname(cachePath), { recursive: true });
    const keys = Object.keys(pruned).sort();
    const lines = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(pruned[k])}`);
    writeFileSync(cachePath, `{\n${lines.join(',\n')}\n}\n`);
    return pruned;
  }

  return { cached, lookup, flush, save, stats, size: () => Object.keys(cache).length };
}

/** @typedef {ReturnType<typeof createGeocoder>} Geocoder */

/**
 * @param {Record<string, GeoEntry>} cache
 * @param {Set<string>} used
 * @param {number} nowMs
 */
export function prune(cache, used, nowMs) {
  /** @type {Record<string, GeoEntry>} */
  const out = {};
  for (const [key, entry] of Object.entries(cache)) {
    if (used.has(key)) {
      out[key] = entry;
      continue;
    }
    const age = nowMs - (Date.parse(entry.at) || 0);
    const ttl = entry.live ? LIVE_TTL_MS : STALE_TTL_MS;
    if (age <= ttl) out[key] = entry;
  }
  return out;
}

/**
 * @param {string | undefined} cachePath
 * @param {{ warn(m: string, f?: object): void }=} log
 * @returns {Record<string, GeoEntry>}
 */
function loadCache(cachePath, log) {
  if (!cachePath || !existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    log?.warn('geocode cache unreadable, starting empty', { path: cachePath, error: err instanceof Error ? err.message : String(err) });
    return {};
  }
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
