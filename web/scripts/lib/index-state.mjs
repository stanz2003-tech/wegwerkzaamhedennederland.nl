/**
 * Noindex with a memory. activity.mjs says which place and bridge pages have nothing to show
 * today; on its own that flipped pages in and out of Google every day (/plaats/lexmond/, a top
 * page, was out on 2026-10-20), and Google re-crawls far more slowly than that.
 *
 * Now a page leaves the index only after NOINDEX_AFTER_DAYS days in a row without anything to
 * show, comes back the first day it has something again, and the pages in `seo.alwaysIndex` of
 * site.config.json never leave it.
 *
 * The memory is a file on the site itself (`/index-state.json`: path → last day with activity).
 * Every build reads the one the previous deploy published and publishes the next, so no commit
 * and no extra storage is needed. On the first run (404) a page without activity counts as long
 * inactive, which keeps the noindex set as it was. When the file exists but cannot be read (an
 * error or a timeout, three times), the build makes no page thin at all: a hiccup must never take
 * pages out of Google. Without usable data the memory is carried over unchanged (pages.mjs).
 */

export const INDEX_STATE_FILE = 'index-state.json';
export const NOINDEX_AFTER_DAYS = 60;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const FETCH_TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `{ v: 1, lastActive: { path: day } }` → Map, dropping anything malformed; null when unusable. */
export function parseIndexState(json) {
  if (!json || typeof json !== 'object' || json.v !== 1 || !json.lastActive || typeof json.lastActive !== 'object') return null;
  const map = new Map();
  for (const [path, day] of Object.entries(json.lastActive)) {
    if (typeof path === 'string' && path.startsWith('/') && typeof day === 'string' && DAY_KEY.test(day)) map.set(path, day);
  }
  return map;
}

export function serializeIndexState(lastActive, generatedIso) {
  const sorted = Object.fromEntries([...lastActive.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify({ v: 1, generated: generatedIso, noindexAfterDays: NOINDEX_AFTER_DAYS, lastActive: sorted });
}

/**
 * The state the live site publishes. Never throws.
 * @returns {Promise<{ status: 'ok' | 'missing' | 'failed', state: Map<string, string> | null }>}
 *   'missing': there is no file yet (404, the first run); 'failed': it exists but could not be read
 */
export async function loadIndexState({ siteUrl, fetchImpl = globalThis.fetch, warn = console.warn, retryDelayMs = RETRY_DELAY_MS }) {
  if (!siteUrl) return { status: 'missing', state: null };
  const url = `${String(siteUrl).replace(/\/+$/, '')}/${INDEX_STATE_FILE}`;
  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      // A query string past Cloudflare's edge cache, which keeps a 404 for a few minutes.
      const res = await fetchImpl(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status === 404) {
        warn(`[gen-pages] ${INDEX_STATE_FILE} bestaat nog niet op de site – geheugen voor noindex begint vandaag`);
        return { status: 'missing', state: null };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const state = parseIndexState(await res.json());
      if (!state) throw new Error('onleesbaar');
      return { status: 'ok', state };
    } catch (err) {
      last = err?.message ?? String(err);
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  warn(`[gen-pages] ${INDEX_STATE_FILE} niet geladen (${last}) – deze build zet geen enkele pagina op noindex`);
  return { status: 'failed', state: null };
}

/**
 * Decides which pages are thin, with memory.
 * @param {object} p
 * @param {{ path: string }[]} p.candidates    place and bridge pages
 * @param {(page: any) => boolean} p.inactiveToday   activity.mjs isThinPage for today's data
 * @param {Map<string, string> | null} p.previous    last day with activity per path
 * @param {string} p.today                         `YYYY-MM-DD`
 * @param {Set<string>} p.alwaysIndex              paths that are never thin
 * @returns {{ thin: Set<string>, lastActive: Map<string, string> }}
 */
export function decideThin({ candidates, inactiveToday, previous, today, alwaysIndex }) {
  const thin = new Set();
  const lastActive = new Map();
  for (const page of candidates) {
    if (!inactiveToday(page)) {
      lastActive.set(page.path, today);
      continue;
    }
    const last = previous?.get(page.path);
    const recent = last !== undefined && daysBetween(last, today) <= NOINDEX_AFTER_DAYS;
    if (last !== undefined) lastActive.set(page.path, last);
    if (!recent && !alwaysIndex.has(page.path)) thin.add(page.path);
  }
  return { thin, lastActive };
}
