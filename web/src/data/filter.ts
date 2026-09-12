/**
 * Filtering, sorting and geometry helpers for item features. Pure functions.
 */
import type { Category, ItemFeature, ItemGeometry, ItemProperties } from './types';
import {
  LONG_RUN_MS,
  MEDIUM_RUN_MS,
  MS,
  isLongRunning,
  matchesTimeWindow,
  measureLengthMs,
  msToNearestChange,
  timeWindowBounds,
  toMs,
  windowRelevance,
  type TimeSpan,
  type TimeWindowId,
  type WindowRelevance,
} from './time';

/** Sort priority for the "impact" order: most disruptive first. */
export const CATEGORY_PRIORITY: Record<Category, number> = {
  afsluiting: 0,
  file: 1,
  incident: 2,
  werk: 3,
  brug: 4,
  evenement: 5,
  overig: 6,
};

export type BBox = [west: number, south: number, east: number, north: number];
export type SortId = 'impact' | 'start' | 'afstand';

export const SORT_OPTIONS: readonly { id: SortId; label: string }[] = [
  { id: 'impact', label: 'Impact' },
  { id: 'start', label: 'Starttijd' },
  { id: 'afstand', label: 'Afstand tot kaartmidden' },
];

export function isSortId(v: string): v is SortId {
  return SORT_OPTIONS.some((s) => s.id === v);
}

export interface FilterOptions {
  /** `null` = all categories. */
  cats: ReadonlySet<Category> | null;
  time: TimeWindowId;
  /** Optional map bounds; items whose bbox does not intersect are dropped. */
  bounds?: BBox | null;
  /** Free-text query on road, title, place. */
  query?: string;
}

/* --------------------------------- geometry -------------------------------- */

export function coordsOf(geometry: ItemGeometry): [number, number][] {
  switch (geometry.type) {
    case 'Point':
      return [[geometry.coordinates[0] ?? 0, geometry.coordinates[1] ?? 0]];
    case 'LineString':
      return geometry.coordinates.map((c) => [c[0] ?? 0, c[1] ?? 0]);
    case 'MultiLineString':
      return geometry.coordinates.flat().map((c) => [c[0] ?? 0, c[1] ?? 0]);
    default:
      return [];
  }
}

export function bboxOf(geometry: ItemGeometry): BBox | null {
  const coords = coordsOf(geometry);
  if (coords.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Midpoint along the geometry (centre vertex for lines, the point itself for points). */
export function midpointOf(geometry: ItemGeometry): [number, number] | null {
  const coords = coordsOf(geometry);
  if (coords.length === 0) return null;
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    const c = coords[Math.floor(coords.length / 2)];
    return c ? [c[0], c[1]] : null;
  }
  return coords[0] ?? null;
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function unionBbox(boxes: readonly BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  return boxes.reduce<BBox>(
    (acc, b) => [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

/** Grows a bbox that is (nearly) a point so fitBounds has something to fit. */
export function padBbox(b: BBox, minSpanDeg = 0.01): BBox {
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  const dx = w < minSpanDeg ? (minSpanDeg - w) / 2 : 0;
  const dy = h < minSpanDeg ? (minSpanDeg - h) / 2 : 0;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* --------------------------------- filtering -------------------------------- */

/** Lower-case, accent-insensitive text used for matching. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Normalises road numbers for comparison: "a 2" / "A02" / "a2" → "A2"; other strings lower-cased. */
export function normalizeRoad(road: string): string {
  const m = /^([ansAnsSE])\s*0*(\d{1,3})\s*[a-z]?$/i.exec(road.trim());
  if (m) return `${(m[1] ?? '').toUpperCase()}${Number(m[2])}`;
  return road.trim().toLowerCase();
}

export function sameRoad(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeRoad(a) === normalizeRoad(b);
}

type QueryFields = Pick<ItemProperties, 'title' | 'road' | 'gemeente' | 'woonplaats' | 'prov'>;

export function matchesQuery(p: QueryFields, query: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  const hay = normalizeText([p.road, p.title, p.gemeente, p.woonplaats, p.prov].filter(Boolean).join(' '));
  // Every whitespace-separated term must occur; a road-number term also matches "A 2" ≈ "A2".
  return q.split(/\s+/).every((term) => hay.includes(term) || (p.road !== undefined && sameRoad(p.road, term)));
}

export function filterItems(items: readonly ItemFeature[], opts: FilterOptions, now: number): ItemFeature[] {
  const { cats, time, bounds, query } = opts;
  return items.filter((f) => {
    const p = f.properties;
    if (cats && !cats.has(p.cat)) return false;
    if (!matchesTimeWindow(p, time, now)) return false;
    if (query && !matchesQuery(p, query)) return false;
    if (bounds) {
      const bb = bboxOf(f.geometry);
      if (!bb || !bboxIntersects(bb, bounds)) return false;
    }
    return true;
  });
}

/* ---------------------------------- sorting --------------------------------- */

function startMs(p: TimeSpan): number {
  const s = toMs(p.start);
  return Number.isNaN(s) ? Number.POSITIVE_INFINITY : s;
}

/**
 * Weights of the impact score. Severity dominates (one severity step = `severity` points), so
 * the order still reads as "most disruptive first", but a semi-permanent measure loses more than
 * two severity steps and something that changes today gains a fraction of one. Without this a
 * width restriction that runs until 2031 outranks a closure that starts tonight.
 */
export const IMPACT_WEIGHTS = {
  severity: 100,
  /** Starts or ends within 24 hours. */
  imminent: 20,
  /** Starts or ends within a week. */
  soon: 10,
  /** Running longer than 30 days. */
  mediumRun: 120,
  /** Running longer than 90 days. */
  longRun: 250,
} as const;

/** Penalty for measures that have been standing for a long time (0 for normal work). */
export function longRunPenalty(p: TimeSpan, now: number): number {
  const length = measureLengthMs(p, now);
  if (length >= LONG_RUN_MS) return IMPACT_WEIGHTS.longRun;
  if (length >= MEDIUM_RUN_MS) return IMPACT_WEIGHTS.mediumRun;
  return 0;
}

/** Bonus for items whose start or end is near, in either direction. */
export function changeBonus(p: TimeSpan, now: number): number {
  const delta = msToNearestChange(p, now);
  if (delta <= MS.day) return IMPACT_WEIGHTS.imminent;
  if (delta <= 7 * MS.day) return IMPACT_WEIGHTS.soon;
  return 0;
}

/**
 * The fields the impact order reads. Both `ItemProperties` (map features, `end?: string`) and
 * `IndexItem` (index rows, `end: string | null`) satisfy it, so the map list and the generated
 * entity pages can share one comparator.
 */
export interface ImpactFields {
  id: string;
  cat: Category;
  sev: ItemProperties['sev'];
  start: string;
  end?: string | null;
}

/** Ranking score for the default "Impact" order; higher comes first. */
export function impactScore(p: Pick<ImpactFields, 'sev' | 'start' | 'end'>, now: number): number {
  return p.sev * IMPACT_WEIGHTS.severity + changeBonus(p, now) - longRunPenalty(p, now);
}

/** Comparator for the default order: score desc, then category, then start, then id. */
export function compareByImpact(a: ImpactFields, b: ImpactFields, now: number): number {
  return (
    impactScore(b, now) - impactScore(a, now) ||
    CATEGORY_PRIORITY[a.cat] - CATEGORY_PRIORITY[b.cat] ||
    startMs(a) - startMs(b) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Sorts a copy of the list. "impact": impact score desc (severity, demoted for long-running
 * measures, promoted for near-term changes), category priority, start asc.
 * "start": start asc. "afstand": distance from `center` asc (falls back to impact).
 */
export function sortItems(
  items: readonly ItemFeature[],
  sort: SortId,
  center: [number, number] | null,
  now: number = Date.now(),
): ItemFeature[] {
  const byImpact = (a: ItemFeature, b: ItemFeature): number => compareByImpact(a.properties, b.properties, now);

  const copy = [...items];
  if (sort === 'start') {
    return copy.sort((a, b) => startMs(a.properties) - startMs(b.properties) || byImpact(a, b));
  }
  if (sort === 'afstand' && center) {
    const dist = new Map<string, number>();
    for (const f of copy) {
      const m = midpointOf(f.geometry);
      dist.set(f.properties.id, m ? haversineKm(center, m) : Number.POSITIVE_INFINITY);
    }
    return copy.sort(
      (a, b) => (dist.get(a.properties.id) ?? Infinity) - (dist.get(b.properties.id) ?? Infinity) || byImpact(a, b),
    );
  }
  return copy.sort(byImpact);
}

/** Counts per category. */
export function countByCategory(items: readonly ItemFeature[]): Record<Category, number> {
  const counts: Record<Category, number> = { werk: 0, afsluiting: 0, file: 0, incident: 0, brug: 0, evenement: 0, overig: 0 };
  for (const f of items) counts[f.properties.cat] += 1;
  return counts;
}

/** Deduplicates features by id, keeping the first occurrence. */
export function dedupeById(features: readonly ItemFeature[]): ItemFeature[] {
  const seen = new Set<string>();
  return features.filter((f) => {
    if (seen.has(f.properties.id)) return false;
    seen.add(f.properties.id);
    return true;
  });
}

/* ------------------------------- time windows ------------------------------- */

/**
 * Split of a window view ("vandaag", "dit weekend") into what actually happens in that window
 * and the semi-permanent measures that merely overlap it.
 */
export interface WindowGroups<T> {
  /** Starts, ends or has a sub-period inside the window: the news of that window. */
  changes: T[];
  /** Already running before the window and still running after it. */
  background: T[];
  /** Calendar bounds the split was made against. */
  from: number;
  to: number;
}

export interface GroupByWindowOptions<T> {
  /** Reads the time span of an item; defaults to the item itself. */
  span?: (item: T) => TimeSpan;
  /** Recurring sub-periods of an item, when the caller has the detail shard. */
  periods?: (item: T) => readonly (readonly [string, string])[] | null | undefined;
  /**
   * How long a measure must run before it counts as background instead of news.
   * Defaults to `LONG_RUN_MS` (90 days); the "vandaag" and "dit weekend" pages pass
   * `MEDIUM_RUN_MS` (30 days) because a month-old standing measure is not weekend news.
   */
  longRunMs?: number;
}

/**
 * Groups items by what they mean for a window. Long-running background measures end up in
 * `background` so a page can show them in a separate, collapsed "loopt al langer" block instead
 * of counting 4.763 items as "nu actief".
 */
export function groupByWindow<T>(
  items: readonly T[],
  id: TimeWindowId,
  now: number,
  opts: GroupByWindowOptions<T> = {},
): WindowGroups<T> {
  const { from, to } = timeWindowBounds(id, now);
  const spanOf = opts.span ?? ((item: T) => item as unknown as TimeSpan);
  const groups: WindowGroups<T> = { changes: [], background: [], from, to };
  for (const item of items) {
    const span = spanOf(item);
    const rel: WindowRelevance = windowRelevance(span, from, to, { periods: opts.periods?.(item) ?? null });
    if (rel === 'outside') continue;
    if (rel === 'changes' || !isLongRunning(span, now, opts.longRunMs)) groups.changes.push(item);
    else groups.background.push(item);
  }
  return groups;
}

/** Long-running measures inside a list (used for the "langdurig" tag and for counting). */
export function countLongRunning(items: readonly TimeSpan[], now: number): number {
  return items.reduce((n, p) => n + (isLongRunning(p, now) ? 1 : 0), 0);
}
