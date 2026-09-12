/**
 * Data helpers shared by the generated entity pages (road / place / bridge / list):
 * road-number matching, index rows → map features, small geo helpers and the impact sort.
 * Pure functions only (no DOM, no fetch).
 */
import { CATEGORY_PRIORITY, compareByImpact, haversineKm, midpointOf, sameRoad, unionBbox, type BBox } from './filter';
import type { IndexItem } from './index';
import { MS, toMs } from './time';
import type { Category, ItemFeature, ItemProperties } from './types';

/** Upcoming horizon of the generated pages, matching werk-gepland.geojson. */
export const UPCOMING_DAYS = 30;

/**
 * Normalised road key: the letter plus the number without leading zeros, ignoring any suffix.
 * "A12" → "A12", "a 02" → "A2", "A12 hrb" → "A12", "s100" → "S100". Null when not a road number.
 */
export function roadKey(road: string | null | undefined): string | null {
  const m = /^([ANSE])\s*0*(\d{1,3})/i.exec((road ?? '').trim());
  if (!m) return null;
  return `${(m[1] ?? '').toUpperCase()}${Number(m[2])}`;
}

/** True when the item road is the same road as `target`, including "A12 hrb"-style variants. */
export function matchesRoad(itemRoad: string | null | undefined, target: string): boolean {
  if (!itemRoad || !target) return false;
  if (sameRoad(itemRoad, target)) return true;
  const a = roadKey(itemRoad);
  const b = roadKey(target);
  return a !== null && a === b;
}

export function itemsOnRoadLoose(items: readonly IndexItem[], road: string): IndexItem[] {
  return items.filter((it) => matchesRoad(it.road, road));
}

/* ------------------------------- index → map ------------------------------- */

function propsFromIndexItem(it: IndexItem): ItemProperties {
  const p: ItemProperties = {
    id: it.id,
    cat: it.cat,
    sev: it.sev,
    title: it.title,
    start: it.start,
    src: 'NDW',
  };
  if (it.sub !== null) p.sub = it.sub;
  if (it.road !== null) p.road = it.road;
  if (it.roadType !== null) p.roadType = it.roadType;
  if (it.gemeente !== null) p.gemeente = it.gemeente;
  if (it.woonplaats !== null) p.woonplaats = it.woonplaats;
  if (it.prov !== null) p.prov = it.prov;
  if (it.end !== null) p.end = it.end;
  if (it.closed) p.closed = true;
  if (it.hind !== null) p.hind = it.hind;
  return p;
}

/**
 * A point feature at the representative coordinate of an index row. The entity pages use this
 * instead of downloading the large GeoJSON files; real line geometry is merged in from
 * live.geojson where available (see `mapFeatures`).
 */
export function featureFromIndexItem(it: IndexItem): ItemFeature {
  return {
    type: 'Feature',
    id: it.id,
    geometry: { type: 'Point', coordinates: [it.lon, it.lat] },
    properties: propsFromIndexItem(it),
  };
}

/** Features for the small entity map: real geometry when we have it, else the index point. */
export function mapFeatures(items: readonly IndexItem[], real: readonly ItemFeature[] = []): ItemFeature[] {
  const byId = new Map<string, ItemFeature>();
  for (const f of real) byId.set(f.properties.id, f);
  return items.map((it) => byId.get(it.id) ?? featureFromIndexItem(it));
}

/* --------------------------------- geometry -------------------------------- */

export function parseCoord(value: string | undefined, min: number, max: number): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Parses a `data-bbox="w,s,e,n"` attribute; null when malformed or degenerate. */
export function parseBbox(value: string | undefined): BBox | null {
  if (!value) return null;
  const parts = value.split(',').map((p) => Number.parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts as [number, number, number, number];
  if (e < w || n < s) return null;
  return [w, s, e, n];
}

export function bboxOfItems(items: readonly IndexItem[]): BBox | null {
  const boxes: BBox[] = items.map((it) => [it.lon, it.lat, it.lon, it.lat]);
  return unionBbox(boxes);
}

/** Items whose representative point lies within `km` of `center`, nearest first. */
export function itemsWithinKm(items: readonly IndexItem[], center: [number, number], km: number): IndexItem[] {
  return items
    .map((it) => ({ it, d: haversineKm(center, [it.lon, it.lat]) }))
    .filter((x) => x.d <= km)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.it);
}

/** Distance in km from `center` to the feature midpoint (Infinity when unknown). */
export function featureDistanceKm(f: ItemFeature, center: [number, number]): number {
  const mid = midpointOf(f.geometry);
  return mid ? haversineKm(center, mid) : Number.POSITIVE_INFINITY;
}

/* ---------------------------------- sorting -------------------------------- */

function startMs(it: IndexItem): number {
  const s = toMs(it.start);
  return Number.isNaN(s) ? Number.POSITIVE_INFINITY : s;
}

/**
 * Impact order for index rows: exactly the order the map list uses (`compareByImpact` in
 * data/filter.ts) — severity dominates, semi-permanent measures are demoted and something that
 * starts or ends soon is promoted. Items the pipeline marked active still come first, because a
 * page that mixes "nu actief" and "gepland" in one list must not bury the current situation.
 */
export function compareImpact(a: IndexItem, b: IndexItem, now: number = Date.now()): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return compareByImpact(a, b, now);
}

/** Upcoming order: start asc, then impact. */
export function compareStart(a: IndexItem, b: IndexItem): number {
  return startMs(a) - startMs(b) || b.sev - a.sev || CATEGORY_PRIORITY[a.cat] - CATEGORY_PRIORITY[b.cat] || a.id.localeCompare(b.id);
}

export interface SplitItems {
  active: IndexItem[];
  upcoming: IndexItem[];
}

/**
 * Splits into "nu actief" (sorted by impact) and "gepland" within `days` days (sorted by start).
 *
 * Whether something is active is decided by the pipeline (`active`), not recomputed here: an
 * item with recurring sub-periods can have a start in the past while it is between periods, and
 * only the pipeline knows that. Items that have ended and items starting beyond the horizon are
 * dropped, so a page stays correct while the data ages between two runs.
 */
export function splitForEntity(items: readonly IndexItem[], now: number, days = UPCOMING_DAYS): SplitItems {
  const horizon = now + days * MS.day;
  const active: IndexItem[] = [];
  const upcoming: IndexItem[] = [];
  for (const it of items) {
    const end = toMs(it.end);
    if (!Number.isNaN(end) && end < now) continue;
    if (it.active) {
      active.push(it);
      continue;
    }
    if (startMs(it) <= horizon) upcoming.push(it);
  }
  return {
    active: active.sort((a, b) => compareImpact(a, b, now)),
    upcoming: upcoming.sort(compareStart),
  };
}

/** Counts per category (only the categories that occur). */
export function countCategories(items: readonly IndexItem[]): Map<Category, number> {
  const counts = new Map<Category, number>();
  for (const it of items) counts.set(it.cat, (counts.get(it.cat) ?? 0) + 1);
  return counts;
}

/** Deduplicates index items by id, keeping the first occurrence. */
export function dedupeItems(items: readonly IndexItem[]): IndexItem[] {
  const seen = new Set<string>();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}
