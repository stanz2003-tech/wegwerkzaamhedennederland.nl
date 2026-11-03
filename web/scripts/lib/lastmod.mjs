/**
 * An honest <lastmod> in the sitemap: the day a page's content last changed.
 *
 * Until 2026-11 each of the 2,578 sitemap URLs carried the build day, twice a day. Google only
 * uses lastmod when it is "consistently and verifiably accurate"; a field that says "changed today"
 * for every page says nothing, and on 2026-10-23 Search Console listed 2,799 URLs as "Gevonden –
 * momenteel niet geïndexeerd" while 75% of Google's requests re-crawled pages it already had.
 *
 * Each sitemap page gets a fingerprint of what it shows (road and place pages: their lasting
 * roadworks and whether each runs now; bridges: their published openings; lists and texts: their
 * source). The memory of the previous deploy (`lastmod` in /index-state.json: path → [fingerprint,
 * day]) says when the fingerprint last changed. Traffic jams and incidents do not count: they come
 * and go within the hour, and the page's lasting content stays the same.
 *
 * Without data a page keeps its day. Without the memory (the first deploy, or a file that could
 * not be read) every page gets the build day, as before, and the memory starts over from there.
 */

import { createHash } from 'node:crypto';

import { LASTING_CATEGORIES } from './activity.mjs';

/** Part of every fingerprint: raise it when a template change alters the content of all pages. */
export const LASTMOD_VERSION = 1;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Short, stable hash of any JSON-able value. */
export function fingerprint(value) {
  return createHash('sha1').update(JSON.stringify([LASTMOD_VERSION, value])).digest('hex').slice(0, 12);
}

/** Before, during or after: the moment a roadwork starts or ends, its page answers differently. */
function phase(start, end, now) {
  const s = Date.parse(start ?? '');
  const e = Date.parse(end ?? '');
  if (Number.isFinite(s) && now < s) return 'later';
  if (Number.isFinite(e) && now > e) return 'voorbij';
  return 'nu';
}

/**
 * What a road or place page shows that lasts: its roadworks, closures and events, each with the
 * facts its row prints, and whether it runs now.
 * @param {{ f: { properties: Record<string, any> } }[]} items   snapshot items (`{ f, d }`)
 * @param {number} now   epoch ms of the data
 */
export function itemsFingerprint(items, now) {
  const rows = [];
  for (const it of items) {
    const p = it?.f?.properties;
    if (!p || !LASTING_CATEGORIES.has(p.cat)) continue;
    rows.push([
      p.id, p.cat, p.sub ?? null, p.sev ?? null, p.title ?? '', p.start ?? null, p.end ?? null,
      p.closed === true, p.hind ?? null, p.imp ?? null, p.veh ?? null, p.spd ?? null, p.lc ?? null,
      phase(p.start, p.end, now),
    ]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return fingerprint(rows);
}

/** The lists the build prerenders from the static lists; the other list pages are live. */
const STATIC_LISTS = new Set(['wegen', 'plaatsen', 'bruggen']);

/**
 * What a page's <lastmod> follows; null = unknown in this build. Road, place and bridge pages:
 * their data (`fingerprintFor`, snapshot.mjs createFingerprinter). Static lists and texts: their
 * Markdown and, for the lists, the static list they render. Live lists change all day, so their
 * fingerprint is the build moment itself.
 */
export function pageFingerprint(page, model, fingerprintFor) {
  switch (page.type) {
    case 'road':
    case 'place':
    case 'bridge':
      return fingerprintFor ? fingerprintFor(page) : null;
    case 'list': {
      if (!STATIC_LISTS.has(page.list)) return fingerprint(['live', model.buildIso]);
      const entry = model.content.get(page.slug);
      const { roads, gemeenten, woonplaatsen, bridges } = model.lists;
      const data = page.list === 'wegen' ? roads : page.list === 'plaatsen' ? [gemeenten, woonplaatsen] : bridges;
      return fingerprint([page.list, entry?.data ?? null, entry?.body ?? null, data]);
    }
    case 'static': {
      const entry = model.content.get(page.slug);
      return entry ? fingerprint([entry.data, entry.body]) : null;
    }
    default:
      return null;
  }
}

/**
 * @param {object} p
 * @param {Map<string, string | null>} p.fingerprints   path → fingerprint; null = unknown today (no data)
 * @param {Map<string, { h: string, d: string }> | null} p.previous   the memory of the previous deploy
 * @param {string} p.today   `YYYY-MM-DD`
 * @returns {{ lastmod: Map<string, string>, memory: Map<string, { h: string, d: string }> }}
 */
export function decideLastmod({ fingerprints, previous, today }) {
  const lastmod = new Map();
  const memory = new Map();
  for (const [path, h] of fingerprints) {
    const prev = previous?.get(path);
    const known = prev && prev.d <= today ? prev : null;
    if (h === null || h === undefined) {
      // No data for this page in this build: an outage is not a change.
      lastmod.set(path, known?.d ?? today);
      if (known) memory.set(path, known);
    } else if (known && known.h === h) {
      lastmod.set(path, known.d);
      memory.set(path, known);
    } else {
      lastmod.set(path, today);
      memory.set(path, { h, d: today });
    }
  }
  return { lastmod, memory };
}

/** `lastmod` of an index-state file → Map, dropping anything malformed; null when absent. */
export function parseLastmodMemory(json) {
  const raw = json?.lastmod;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const map = new Map();
  for (const [path, entry] of Object.entries(raw)) {
    if (!path.startsWith('/') || !Array.isArray(entry) || entry.length !== 2) continue;
    const [h, d] = entry;
    if (typeof h === 'string' && h !== '' && typeof d === 'string' && DAY_KEY.test(d)) map.set(path, { h, d });
  }
  return map;
}

/** The memory as it is published: `{ path: [fingerprint, day] }`, sorted by path. */
export function lastmodMemoryJson(memory) {
  return Object.fromEntries([...memory.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, { h, d }]) => [path, [h, d]]));
}
