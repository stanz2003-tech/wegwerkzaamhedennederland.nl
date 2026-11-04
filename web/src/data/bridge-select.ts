/**
 * Which meldingen count for "Kan ik over de Merwedebrug?": the item SELECTION of a road bridge's
 * page. The answer itself comes from the unchanged verdict / answer code (data/verdict.ts,
 * forecast.ts, answer.ts) over the items chosen here, so the only new decision is which items
 * touch the bridge.
 *
 * The site's promise is that it never says someone can pass when they cannot, so the rule leans
 * towards including: over-warning is acceptable, missing a closure on the bridge is not.
 *
 *   An item on the bridge's road (same road number, "A27 hrb" included) counts when its geometry
 *   comes within the bridge's radius (any segment of its line, not only its vertices: a closure
 *   whose line runs straight over the bridge has its vertices kilometres away), or when its text
 *   names the bridge or an alias (within NAME_MAX_KM, so a namesake elsewhere on the road does not).
 *
 *   An item on another road number never counts, however close: the A27 bridge is not closed by
 *   work on a parallel N-road 900 m away.
 *
 *   An item without a road number counts when it lies within the radius AND its text names the
 *   bridge, an alias or the bridge's road number ("A10, Amsterdam"), or when it names the bridge
 *   within NO_ROAD_NAME_MAX_KM. Distance alone is not enough there: next to a motorway bridge the
 *   items without a road number are the streets of the town underneath (18 of them within 1,2 km
 *   of the A15 bridge over the Merwedekanaal on 2026-11-04), which do not close the bridge.
 *
 * Pure; unit-tested in web/test/bridge-select.test.mjs.
 */
import { BRIDGE_EXTRAS, DEFAULT_BRIDGE_RADIUS_KM, type BridgeExtra } from './bridge-aliases';
import { matchesRoad, roadKey } from './entity';
import { normalizeText } from './filter';
import type { ForecastItem } from './forecast';
import type { ItemGeometry } from './types';

/** A name match on the same road beyond this distance is another bridge of that name. */
export const NAME_MAX_KM = 15;
/** A melding without a road number that names the bridge must lie at least this close. */
export const NO_ROAD_NAME_MAX_KM = 5;

/** What the selection needs to know about a bridge (registry entry or manifest row). */
export interface BridgeRef {
  slug: string;
  name: string;
  road?: string | null;
  lon: number;
  lat: number;
}

export interface BridgeProfile {
  slug: string;
  name: string;
  /** Road number the bridge carries ("A27"); null for a bridge without one. */
  road: string | null;
  point: [number, number];
  radiusKm: number;
  /** Other names, as written (for "Ook bekend als" and the search box). */
  aliases: readonly string[];
  /** Normalised names a melding text is matched against. */
  terms: readonly string[];
}

/** "Merwedebrug" from "Merwedebrug bij Gorinchem", "Maasbrug" from "Maasbrug (A2)". */
export function coreBridgeName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+bij\s+.*$/i, '')
    .replace(/,.*$/, '')
    .trim();
}

/** A core name that says "bridge" and is long enough to mean one bridge ("De Mark" is neither). */
function usableCore(core: string): boolean {
  return core.length >= 6 && /brug/i.test(core);
}

export function bridgeProfile(b: BridgeRef, extras: Readonly<Record<string, BridgeExtra>> = BRIDGE_EXTRAS): BridgeProfile {
  const extra = extras[b.slug] ?? {};
  const aliases = extra.aliases ?? [];
  const core = coreBridgeName(b.name);
  const names = [b.name, ...(usableCore(core) ? [core] : []), ...aliases];
  const terms = Array.from(new Set(names.map((n) => normalizeText(n).replace(/\s+/g, ' ')).filter((t) => t.length >= 4)));
  return {
    slug: b.slug,
    name: b.name,
    road: b.road && b.road.trim() !== '' ? b.road.trim() : null,
    point: [b.lon, b.lat],
    radiusKm: typeof extra.radiusKm === 'number' && extra.radiusKm > 0 ? extra.radiusKm : DEFAULT_BRIDGE_RADIUS_KM,
    aliases,
    terms,
  };
}

/** True for a bridge with curated names or radius (data/bridge-aliases.ts). */
export function hasBridgeExtra(slug: string, extras: Readonly<Record<string, BridgeExtra>> = BRIDGE_EXTRAS): boolean {
  return Object.prototype.hasOwnProperty.call(extras, slug);
}

/* --------------------------------- geometry -------------------------------- */

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;

type Line = readonly (readonly number[])[];

function linesOf(g: ItemGeometry): Line[] {
  if (g.type === 'Point') return [[g.coordinates]];
  if (g.type === 'LineString') return [g.coordinates];
  return g.coordinates;
}

/**
 * Shortest distance in km from `point` to the geometry: to any segment of a line, so a line that
 * crosses the point is at 0 whatever its vertices. Infinity for a geometry without coordinates or
 * at 0,0 (an index row without a location). Flat projection around the point: exact enough for
 * the few kilometres that matter here.
 */
export function distanceToGeometryKm(g: ItemGeometry, point: [number, number]): number {
  const [lon0, lat0] = point;
  const kx = KM_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  const xy = (c: readonly number[]): [number, number] | null => {
    const lon = c[0];
    const lat = c[1];
    if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon === 0 && lat === 0) return null;
    return [(lon - lon0) * kx, (lat - lat0) * KM_PER_DEG_LAT];
  };
  let best = Number.POSITIVE_INFINITY;
  for (const line of linesOf(g)) {
    const pts = line.map(xy).filter((p): p is [number, number] => p !== null);
    if (pts.length === 1) best = Math.min(best, Math.hypot(pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as [number, number];
      const b = pts[i + 1] as [number, number];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2));
      best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
    }
  }
  return best;
}

/* ----------------------------------- text ---------------------------------- */

/** The texts of a melding that can name a bridge: title, description, from and to. */
function itemText(item: ForecastItem): string {
  const d = item.d ?? null;
  return normalizeText([item.f.properties.title, d?.desc, d?.from, d?.to].filter(Boolean).join(' \n ')).replace(/\s+/g, ' ');
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the text names one of the terms; a term must start at a word ("merwedebruggen" counts). */
export function textNamesBridge(text: string, terms: readonly string[]): boolean {
  const hay = normalizeText(text).replace(/\s+/g, ' ');
  return terms.some((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`).test(hay));
}

/** True when the text names the road number as a word ("A10, Amsterdam", "afrit A 27"). */
export function textNamesRoad(text: string, road: string | null): boolean {
  const key = roadKey(road);
  if (!key) return false;
  const letter = key.charAt(0).toLowerCase();
  const num = key.slice(1);
  return new RegExp(`(^|[^a-z0-9])${letter}\\s?0*${num}([^0-9]|$)`).test(normalizeText(text));
}

/* --------------------------------- selection -------------------------------- */

/** Why an item counts for the bridge: near it on its road, or naming it; null when it does not. */
export type BridgeMatch = 'afstand' | 'naam' | null;

export function bridgeMatch(item: ForecastItem, profile: BridgeProfile): BridgeMatch {
  const p = item.f.properties;
  const road = typeof p.road === 'string' && p.road.trim() !== '' ? p.road : null;
  if (road && (!profile.road || !matchesRoad(road, profile.road))) return null;
  const km = distanceToGeometryKm(item.f.geometry, profile.point);
  const text = itemText(item);
  const named = textNamesBridge(text, profile.terms);
  if (road) {
    if (km <= profile.radiusKm) return 'afstand';
    // Without a location the distance is unknown: a name on the same road is then enough.
    return named && (km <= NAME_MAX_KM || !Number.isFinite(km)) ? 'naam' : null;
  }
  if (named && km <= NO_ROAD_NAME_MAX_KM) return 'naam';
  if (km <= profile.radiusKm && textNamesRoad(text, profile.road)) return 'afstand';
  return null;
}

/** The items that count for the bridge, in input order, each id once. */
export function selectBridgeItems<T extends ForecastItem>(items: readonly T[], profile: BridgeProfile): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const id = it.f.properties.id;
    if (seen.has(id) || bridgeMatch(it, profile) === null) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

/** The answer subject of a bridge page: its road, so headlines read "Rijbaan dicht tussen …". */
export function bridgeSubject(profile: BridgeProfile): { kind: 'road'; name: string } {
  return { kind: 'road', name: profile.road ?? profile.name };
}

/**
 * The bridge with its article for a question: "de Merwedebrug bij Gorinchem", "de brug over de
 * Dintel", but "De Mark" (the name already has one).
 */
export function bridgeWithArticle(name: string): string {
  if (/^(de|het)\s/i.test(name)) return name;
  if (/^brug\s/i.test(name)) return `de ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  return `de ${name}`;
}

/** "1,2 km" as the page says it. */
export function radiusLabel(km: number): string {
  return `${String(Math.round(km * 10) / 10).replace('.', ',')} km`;
}
