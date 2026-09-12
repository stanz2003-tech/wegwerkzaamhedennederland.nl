/**
 * Bridges: static registry lookup by RIS code, aggregation of openings
 * (open now from `actueel_beeld`, planned from `planningsfeed_brugopeningen`)
 * into `bruggen.json`, and the `<cache>/bruggen-seen.json` list of bridge ids
 * seen in the feeds so `bin/build-bruggen.js` can grow the registry.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundCoord } from './geometry.js';
import { normalizeVildRoad } from './roads.js';
import { slugify } from './slug.js';
import { openingsWithin } from './time.js';

export const DEFAULT_REGISTRY_PATH = fileURLToPath(new URL('../static/bruggen.json', import.meta.url));
export const OPENINGS_DAYS = 7;
export const MAX_OPENINGS = 50;

/**
 * @typedef {object} RegistryEntry
 * @property {string} id
 * @property {string} slug
 * @property {string} name
 * @property {string=} road
 * @property {string=} water
 * @property {string=} gemeente
 * @property {string=} woonplaats
 * @property {string=} prov
 * @property {string=} provCode
 * @property {number} lon
 * @property {number} lat
 */

/**
 * @typedef {object} SeenBridge
 * @property {string} id
 * @property {number} lon
 * @property {number} lat
 * @property {string=} alertC     VILD specificLocation of the alertCPoint
 * @property {string} firstSeen
 * @property {string} lastSeen
 */

/**
 * @param {string} [path]
 * @returns {{ version: string, bridges: RegistryEntry[] }}
 */
export function loadRegistry(path = DEFAULT_REGISTRY_PATH) {
  if (!existsSync(path)) return { version: '0', bridges: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || !Array.isArray(parsed.bridges)) throw new Error(`Invalid bridge registry: ${path}`);
  return parsed;
}

/**
 * @param {string} path
 * @returns {SeenBridge[]}
 */
export function loadSeen(path) {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {object} options
 * @param {{ bridges: RegistryEntry[] }} options.registry
 * @param {string=} options.seenPath
 * @param {number} options.nowMs
 * @param {import('./vild.js').Vild=} options.vild
 */
export function createBridgeBook({ registry, seenPath, nowMs, vild }) {
  const byId = new Map(registry.bridges.map((b) => [b.id, b]));
  /** @type {Map<string, { lon: number, lat: number, alertC?: string, openNow: boolean, openings: { start?: string, end?: string }[] }>} */
  const observed = new Map();
  const seen = seenPath ? loadSeen(seenPath) : [];
  const seenById = new Map(seen.map((s) => [s.id, s]));
  let newSeen = 0;

  /**
   * Record one bridge situation.
   * @param {object} input
   * @param {string} input.ris
   * @param {[number, number]} input.point
   * @param {string=} input.alertC
   * @param {string=} input.start
   * @param {string=} input.end
   * @param {boolean} input.openNow     true = bridgeSwingInOperation active now (live feed)
   */
  function note({ ris, point, alertC, start, end, openNow }) {
    const entry = observed.get(ris) ?? { lon: point[0], lat: point[1], alertC, openNow: false, openings: [] };
    if (openNow) entry.openNow = true;
    if (alertC && !entry.alertC) entry.alertC = alertC;
    if (start) entry.openings.push({ start, end });
    observed.set(ris, entry);

    const iso = new Date(nowMs).toISOString();
    const known = seenById.get(ris);
    if (known) {
      known.lastSeen = iso;
      if (alertC && !known.alertC) known.alertC = alertC;
    } else {
      const [lon, lat] = roundCoord(point);
      const fresh = { id: ris, lon, lat, alertC, firstSeen: iso, lastSeen: iso };
      if (!alertC) delete fresh.alertC;
      seen.push(fresh);
      seenById.set(ris, fresh);
      newSeen++;
    }
  }

  /**
   * Build `bruggen.json` entries: every registry bridge with an opening now or
   * within 7 days, plus observed bridges missing from the registry.
   * @param {(lon: number, lat: number) => { straat?: string, woonplaats?: string, gemeente?: string, prov?: string } | undefined} [placeOf]
   */
  function build(placeOf) {
    /** @type {import('./output.js').BridgeEntry[]} */
    const out = [];
    for (const [id, obs] of observed) {
      const openings = openingsWithin(obs.openings, nowMs, OPENINGS_DAYS, MAX_OPENINGS);
      if (!obs.openNow && openings.length === 0) continue;
      const reg = byId.get(id);
      const entry = reg ?? fallbackEntry(id, obs, placeOf?.(obs.lon, obs.lat));
      out.push(orderedEntry(entry, obs.openNow, openings));
    }
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }

  /**
   * @param {string} id
   * @param {{ lon: number, lat: number, alertC?: string }} obs
   * @param {{ straat?: string, woonplaats?: string, gemeente?: string, prov?: string } | undefined} place
   * @returns {RegistryEntry}
   */
  function fallbackEntry(id, obs, place) {
    const row = vild?.lookup(obs.alertC);
    const [lon, lat] = roundCoord([obs.lon, obs.lat]);
    const where = place?.woonplaats ?? place?.gemeente;
    if (row && row.type === 'P3.2' && row.name1) {
      const vildName = /** @type {string} */ (canonicalBridgeName(row.name1));
      return compact({ id, slug: `${slugify(vildName)}-${id.slice(-4).toLowerCase()}`, name: vildName, road: row.road || undefined, water: row.name2 || undefined, gemeente: place?.gemeente, woonplaats: place?.woonplaats, prov: place?.prov, lon, lat });
    }
    const name = bridgeFallbackName({ id, street: place?.straat, place: where, road: normalizeVildRoad(row?.road) });
    return compact({ id, slug: `${slugify(name)}-${id.slice(-4).toLowerCase()}`, name, road: normalizeVildRoad(row?.road), gemeente: place?.gemeente, woonplaats: place?.woonplaats, prov: place?.prov, lon, lat });
  }

  /** Append newly seen ids to the cache file. */
  function saveSeen() {
    if (!seenPath) return newSeen;
    mkdirSync(dirname(seenPath), { recursive: true });
    seen.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    writeFileSync(seenPath, JSON.stringify(seen, null, 0).replace(/},{/g, '},\n{') + '\n');
    return newSeen;
  }

  return { note, build, saveSeen, observed, registrySize: byId.size, newSeen: () => newSeen };
}

/**
 * @param {RegistryEntry} e
 * @param {boolean} openNow
 * @param {[string, string][]} openings
 * @returns {import('./output.js').BridgeEntry}
 */
function orderedEntry(e, openNow, openings) {
  return compact({
    id: e.id,
    slug: e.slug,
    name: e.name,
    road: e.road,
    water: e.water,
    gemeente: e.gemeente,
    woonplaats: e.woonplaats,
    prov: e.prov,
    lon: e.lon,
    lat: e.lat,
    openNow,
    openings,
  });
}

/**
 * @template {object} T
 * @param {T} obj
 */
function compact(obj) {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key];
  return obj;
}

// ---------------------------------------------------------------------------
// Naming rules and the VILD merge (used by bin/build-bruggen.js and the
// runtime fallback above). Kept pure and exported so every rule is testable.
// ---------------------------------------------------------------------------

/** Street names that already are a bridge name: use them as the name. */
const BRIDGE_SUFFIX_RE = /(brug|burg|sluis)$/i;

/**
 * Generic street types carry no name, so the bridge is named by its function.
 * Keys are lowercased street names.
 */
export const GENERIC_STREET_FUNCTION = Object.freeze({
  fietspad: 'Fietsbrug',
  fietspaden: 'Fietsbrug',
  rijwielpad: 'Fietsbrug',
  fietsroute: 'Fietsbrug',
  voetpad: 'Voetgangersbrug',
  wandelpad: 'Voetgangersbrug',
  looppad: 'Voetgangersbrug',
  trottoir: 'Voetgangersbrug',
  ruiterpad: 'Ruiterbrug',
  parallelweg: 'Brug',
  ventweg: 'Brug',
  weg: 'Brug',
  rijksweg: 'Brug',
  provincialeweg: 'Brug',
  busbaan: 'Busbrug',
  busstrook: 'Busbrug',
  onbekend: 'Brug',
});

/**
 * Clean a raw VILD bridge name for use in a title: whitespace collapsed, a
 * letter typed three times in a row reduced to two ("Zuid-Willlemsvaart" ->
 * "Zuid-Willemsvaart"; Dutch has no triple letters) and a capital at the start.
 * The source spelling is never overwritten in the data - `water` keeps it and
 * only the title uses this. Trailing numbers are kept on purpose: the three
 * "brug over de Drentse Hoofdvaart hm 408/369/118" rows are three bridges.
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
export function canonicalBridgeName(raw) {
  if (!raw) return undefined;
  const text = raw
    .replace(/\s+/g, ' ')
    .replace(/([A-Za-z])\1\1+/g, '$1$1')
    .trim();
  if (text.length === 0) return undefined;
  return /^[a-z]/.test(text) ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * The same, for a reverse-geocoded street name: a trailing inventory number is
 * part of the municipality's asset code, not of the name
 * ("Kinkerbrug 0266" -> "Kinkerbrug").
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
export function canonicalStreetName(raw) {
  return canonicalBridgeName(raw?.replace(/[\s,;:-]*\b\d{2,}[a-zA-Z]?\s*$/, ''));
}

/**
 * Fallback name for a bridge without a VILD name.
 *
 *   street ends in brug/burg/sluis -> "Ringersbrug, Alkmaar"
 *   road number known              -> "Brug in de N231 bij Aalsmeer"
 *   generic street type            -> "Fietsbrug bij Alkmaar"
 *   any other street               -> "Brug Noordveenweg, Weteringbrug"
 *   only a place                   -> "Brug bij Alkmaar"
 *   nothing at all                 -> "Brug <id>"
 *
 * Never "Brug in de <X>brug" and never "Brug in de Fietspad".
 * @param {object} input
 * @param {string} input.id
 * @param {string=} input.street    reverse-geocoded straatnaam
 * @param {string=} input.place     woonplaats or gemeente
 * @param {string=} input.road      road number ("N231")
 * @returns {string}
 */
export function bridgeFallbackName({ id, street, place, road }) {
  const name = canonicalStreetName(street);
  if (name && BRIDGE_SUFFIX_RE.test(name)) return place ? `${name}, ${place}` : name;
  if (road) return place ? `Brug in de ${road} bij ${place}` : `Brug in de ${road}`;
  if (name) {
    const fn = GENERIC_STREET_FUNCTION[name.toLowerCase()];
    if (fn) return place ? `${fn} bij ${place}` : fn;
    return place ? `Brug ${name}, ${place}` : `Brug ${name}`;
  }
  if (place) return `Brug bij ${place}`;
  return `Brug ${id}`;
}

/**
 * Make colliding names unique without a hash. Three tiers are tried in order —
 * the place ("Maasbrug bij Empel"), the road number (five different
 * "Maasbrug" bridges) and the street — and the first one where every member of
 * the group has a different, non-empty value that does not merely repeat the
 * name wins. When no tier separates them, a 1-based ordinal in id order does.
 * All of it is stable as long as the id set is, and slugs are frozen anyway.
 *
 * The place tier reads as "<name> bij <plaats>" rather than a parenthetical,
 * because the page generator already appends "({road or woonplaats})" to the
 * page title and two brackets in a row look broken.
 * @template {{ id: string, name: string, road?: string, street?: string, woonplaats?: string, gemeente?: string }} T
 * @param {T[]} bridges
 * @returns {T[]}
 */
export function disambiguateNames(bridges) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const b of bridges) {
    const key = b.name.toLowerCase();
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }
  /** @type {{ of: (b: T) => string | undefined, label: (name: string, hint: string) => string }[]} */
  const tiers = [
    { of: (b) => b.woonplaats ?? b.gemeente, label: (name, hint) => `${name} bij ${hint}` },
    { of: (b) => b.road, label: (name, hint) => `${name} (${hint})` },
    { of: (b) => canonicalStreetName(b.street), label: (name, hint) => `${name} (${hint})` },
  ];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const tier = tiers.find((t) => {
      const hints = group.map((b) => t.of(b));
      if (hints.some((h) => !h)) return false;
      if (group.some((b, i) => b.name.toLowerCase().includes(String(hints[i]).toLowerCase()))) return false;
      return new Set(hints.map((h) => String(h).toLowerCase())).size === group.length;
    });
    if (tier) {
      for (const b of group) b.name = tier.label(b.name, /** @type {string} */ (tier.of(b)));
      continue;
    }
    // Nothing separates them: the first in id order keeps the plain name.
    group.forEach((b, i) => {
      if (i > 0) b.name = `${b.name} (${i + 1})`;
    });
  }
  return bridges;
}

/**
 * @typedef {object} VildBridge
 * @property {string} id        synthetic registry id, "VILD-7290"
 * @property {string} nr        VILD location number
 * @property {string[]} nrs     every VILD row folded into this bridge
 * @property {string} name
 * @property {string=} road     normalised road number
 * @property {string=} water    source spelling of the waterway
 * @property {number} lon
 * @property {number} lat
 */

/**
 * Two VILD rows with the same name closer together than this are one physical
 * bridge — the separate carriageway rows "A12" and "A12 hrb" of the
 * Galecopperbrug are 230 m apart. Two different bridges never share a name at
 * this range (only 5 of the 364 rows fold).
 */
export const VILD_FOLD_M = 300;
/** A VILD bridge and a RIS bridge closer than this are the same bridge. */
export const RIS_MATCH_M = 150;

/**
 * Every P3.2 (bridge) row of the VILD table, folded per physical bridge.
 * @param {import('./vild.js').Vild} vild
 * @param {(road: string | undefined) => string | undefined} normalizeRoad
 * @returns {VildBridge[]}
 */
export function vildBridges(vild, normalizeRoad) {
  /** @type {VildBridge[]} */
  const out = [];
  for (const row of vild.rows()) {
    if (row.type !== 'P3.2' || !row.name1 || !row.lonlat) continue;
    const name = canonicalBridgeName(row.name1);
    if (!name) continue;
    const [lon, lat] = roundCoord(row.lonlat);
    const fold = out.find((b) => b.name.toLowerCase() === name.toLowerCase() && metersBetween(b, { lon, lat }) < VILD_FOLD_M);
    if (fold) {
      fold.nrs.push(row.nr);
      if (!fold.road) fold.road = normalizeRoad(row.road);
      if (!fold.water && row.name2) fold.water = row.name2;
      continue;
    }
    out.push(compact({ id: `VILD-${row.nr}`, nr: row.nr, nrs: [row.nr], name, road: normalizeRoad(row.road), water: row.name2 || undefined, lon, lat }));
  }
  out.sort((a, b) => (a.nr.padStart(8, '0') < b.nr.padStart(8, '0') ? -1 : 1));
  return out;
}

/**
 * Nearest VILD bridge within `RIS_MATCH_M` whose road does not contradict the
 * RIS bridge's road (equal, or unknown on either side).
 * @param {VildBridge[]} candidates
 * @param {{ lon: number, lat: number, road?: string }} ris
 * @returns {{ bridge: VildBridge, m: number } | undefined}
 */
export function matchVildBridge(candidates, ris) {
  /** @type {{ bridge: VildBridge, m: number } | undefined} */
  let best;
  for (const bridge of candidates) {
    const m = metersBetween(bridge, ris);
    if (m >= RIS_MATCH_M) continue;
    if (bridge.road && ris.road && bridge.road !== ris.road) continue;
    if (!best || m < best.m) best = { bridge, m };
  }
  return best;
}

/**
 * Equirectangular distance in metres - exact enough at Dutch latitudes for a
 * 150 m threshold and far cheaper than haversine over 364 x 500 pairs.
 * @param {{ lon: number, lat: number }} a
 * @param {{ lon: number, lat: number }} b
 */
export function metersBetween(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * R;
}
