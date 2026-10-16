/**
 * Which entity pages have roadworks to show, from the live data at build time (`DATA_BASE`).
 *
 * On 2026-10-16, 1.522 of the 3.274 place and bridge pages showed nothing: their text is the
 * shared template with only the name swapped. Search engines call that thin content, and AdSense
 * rejects sites for it. Those pages stay online (the map and the lists link to them), but get
 * `noindex, follow`, leave the sitemap and load no ads, until the data has something for them
 * again. The Deploy workflow rebuilds daily so this follows the data.
 *
 * Road pages are never thin: "is er iets op de A28?" is a real question, also when the answer is
 * no. A data outage must never take pages out of Google, so nothing is thin without data (no
 * DATA_BASE, a failed fetch), with an index that looks broken (too few rows, a failed planning
 * source), and no bridge is thin when the bridge source failed or listed no bridge at all. The
 * page model adds one more guard: if most gemeenten would be thin, the data is not believed
 * (pages.mjs, buildModel).
 */

/** Below this many index rows the data is treated as broken; a normal day has about 11.000. */
export const MIN_INDEX_ROWS = 1000;

/** What makes a place worth a page. Files and incidents come and go within the hour. */
export const LASTING_CATEGORIES = new Set(['werk', 'afsluiting', 'evenement', 'overig']);

const FETCH_TIMEOUT_MS = 30_000;

// Positions in an IndexRow (web/src/data/types.ts).
const ROW_CAT = 1;
const ROW_GEMEENTE = 7;
const ROW_WOONPLAATS = 8;

/** Same algorithm as `slugify()` in web/src/data/types.ts and pipeline/src/slug.js. */
export function slugify(input) {
  return String(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Same as `normalizeText()` in web/src/data/filter.ts, which the place pages match names with. */
export function normalizeName(input) {
  return String(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * A woonplaats page reads the file of its gemeente (`gemeenten/<slug>.json`, matched on the
 * gemeente slug) and keeps the items whose woonplaats name matches; this key does the same.
 */
export function woonplaatsKey(gemeente, woonplaats) {
  return `${slugify(gemeente)}|${normalizeName(woonplaats)}`;
}

/**
 * @typedef {object} Activity
 * @property {string | null} generated       index/all.json `generated`
 * @property {number} rows                   rows in the index
 * @property {Set<string>} gemeenten          gemeente slugs with at least one lasting item
 * @property {Set<string>} woonplaatsen       `woonplaatsKey()`s with at least one lasting item
 * @property {Set<string> | null} bridges     bridge ids open now or with a planned opening; null = unknown
 */

/** `meta.json` says whether a source failed in the run that wrote the files (pipeline.js). */
function sourceFailed(meta, name) {
  return Boolean(meta && typeof meta === 'object' && meta.sources?.[name]?.ok === false);
}

/**
 * @param {{ index: unknown, bridges?: unknown, meta?: unknown }} data  parsed index/all.json, bruggen.json, meta.json
 * @returns {Activity | null}  null when the index is unusable: then no page counts as thin
 */
export function buildActivity({ index, bridges, meta }, { warn = console.warn } = {}) {
  if (sourceFailed(meta, 'planning')) {
    warn("[gen-pages] de planning-bron faalde in de laatste run – alle pagina's blijven indexeerbaar");
    return null;
  }
  const rows = index && typeof index === 'object' && Array.isArray(index.rows) ? index.rows : null;
  if (!rows) {
    warn("[gen-pages] index/all.json heeft geen rijen – alle pagina's blijven indexeerbaar");
    return null;
  }
  if (rows.length < MIN_INDEX_ROWS) {
    warn(`[gen-pages] index/all.json heeft maar ${rows.length} rijen (minimaal ${MIN_INDEX_ROWS}) – alle pagina's blijven indexeerbaar`);
    return null;
  }

  const gemeenten = new Set();
  const woonplaatsen = new Set();
  for (const row of rows) {
    if (!Array.isArray(row) || !LASTING_CATEGORIES.has(row[ROW_CAT])) continue;
    const gemeente = row[ROW_GEMEENTE];
    if (typeof gemeente !== 'string' || gemeente === '') continue;
    gemeenten.add(slugify(gemeente));
    const woonplaats = row[ROW_WOONPLAATS];
    if (typeof woonplaats === 'string' && woonplaats !== '') woonplaatsen.add(woonplaatsKey(gemeente, woonplaats));
  }

  // bruggen.json lists only bridges with an opening, and the bridge feed has no validation floor:
  // a dead NDW feed publishes `bridges: []`. An empty list is therefore "unknown", not "no openings".
  const listed = bridges && typeof bridges === 'object' && Array.isArray(bridges.bridges) ? bridges.bridges : null;
  const list = listed && listed.length > 0 && !sourceFailed(meta, 'bruggen') ? listed : null;
  if (!list) warn("[gen-pages] bruggen.json ontbreekt, is leeg of de bron faalde – alle brugpagina's blijven indexeerbaar");
  const activeBridges = list
    ? new Set(list.filter((b) => b && typeof b.id === 'string' && (b.openNow === true || (Array.isArray(b.openings) && b.openings.length > 0))).map((b) => b.id))
    : null;

  return {
    generated: typeof index.generated === 'string' ? index.generated : null,
    rows: rows.length,
    gemeenten,
    woonplaatsen,
    bridges: activeBridges,
  };
}

/**
 * True when the page would show no roadworks (place) or no openings (bridge) today.
 * @param {{ type: string, kind?: string, entity?: any }} page  a page from buildModel()
 * @param {Activity | null} activity
 */
export function isThinPage(page, activity) {
  if (!activity) return false;
  if (page.type === 'place' && page.kind === 'gemeente') return !activity.gemeenten.has(slugify(page.entity.naam));
  if (page.type === 'place' && page.kind === 'woonplaats') {
    return !activity.woonplaatsen.has(woonplaatsKey(page.entity.gemeente ?? '', page.entity.naam));
  }
  if (page.type === 'bridge') return activity.bridges !== null && !activity.bridges.has(page.entity.id);
  return false;
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetches index/all.json, bruggen.json and meta.json from the published data (`DATA_BASE`, e.g.
 * https://data.wegwerkzaamhedennederland.nl/v1/). Never throws.
 * @returns {Promise<Activity | null>}
 */
export async function loadActivity({ dataBase, fetchImpl = globalThis.fetch, warn = console.warn } = {}) {
  if (!dataBase) return null;
  const base = dataBase.endsWith('/') ? dataBase : `${dataBase}/`;
  const [index, bridges, meta] = await Promise.allSettled(['index/all.json', 'bruggen.json', 'meta.json'].map((f) => fetchJson(base + f, fetchImpl)));
  if (index.status === 'rejected') {
    warn(`[gen-pages] live data niet geladen (${index.reason?.message ?? index.reason}) – alle pagina's blijven indexeerbaar`);
    return null;
  }
  if (bridges.status === 'rejected') warn(`[gen-pages] bruggen.json niet geladen (${bridges.reason?.message ?? bridges.reason})`);
  if (meta.status === 'rejected') warn(`[gen-pages] meta.json niet geladen (${meta.reason?.message ?? meta.reason})`);
  const value = (/** @type {PromiseSettledResult<unknown>} */ r) => (r.status === 'fulfilled' ? r.value : null);
  return buildActivity({ index: index.value, bridges: value(bridges), meta: value(meta) }, { warn });
}
