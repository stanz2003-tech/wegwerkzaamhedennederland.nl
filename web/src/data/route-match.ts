/**
 * Which items lie ON a route — not merely near it. Pure functions; unit-tested in
 * web/test/route-match.test.mjs.
 *
 * A route from the router is an OSM polyline; an item is an NDW line (or point). The two never
 * coincide exactly, and the dangerous mistakes are:
 *   - a road the route crosses (a closed street under a motorway bridge) — rejected by the
 *     bearing check: only stretches running alongside the route count;
 *   - a road the route only touches at a junction — rejected by the length check: a line item
 *     must run alongside for a real distance, not for one sample;
 *   - the other carriageway of a motorway — NDW lines lie on the carriageway they describe
 *     (measured: within ~1 m of the router's line for the same direction, 10–40 m to the LEFT
 *     for the opposite one), so a line that runs alongside but consistently off to one side is
 *     reported as `naast` (other direction or a parallel road), never silently dropped.
 * NDW line direction is not reliable (some lines run against the traffic they describe), so the
 * bearing check is undirected. Anything unclear counts as `op`: over-warning is tolerated,
 * a false "you can pass" is not.
 */
import type { ItemGeometry } from './types';

export type LonLat = [number, number];

/** Half-width of the corridor around the route in which a line item counts as alongside it. */
export const CORRIDOR_M = 25;
/**
 * A line counts as the other carriageway only when it keeps at least this far to the LEFT (the
 * opposite direction lies left in right-hand traffic; measured on the A2/A27/A12: the own
 * carriageway within ~1 m, the other one ≥ 6 m left over its whole length). Closer, or to the
 * right, it may be this road drawn a little off: then it stays `op`.
 */
export const BESIDE_MIN_M = 6;
/** Share of a line that must keep left beyond BESIDE_MIN_M to make it `naast` rather than `op`. */
export const SIDE_SHARE = 0.8;
/** Points (incidents, bridges, short works) may sit a little off the drawn road. */
export const POINT_CORRIDOR_M = 30;
/** Largest angle between item and route that still reads as "running alongside". */
export const MAX_ANGLE_DEG = 35;
/** A line item matches when this much of it runs along the route… */
export const MIN_ALONG_M = 150;
/** …or this share of it, or of the route, whichever is less (a 60 m closure needs 30 m alongside). */
export const MIN_ALONG_SHARE = 0.5;
const SAMPLE_M = 10;
const CELL_M = 200;

/** `op`: on the route itself. `naast`: alongside it — the other direction, or a parallel road. */
export type RouteSide = 'op' | 'naast';

export interface RouteMatch {
  id: string;
  side: RouteSide;
  /** Distance along the route (metres from the start) where the item begins and ends on it. */
  fromM: number;
  toM: number;
  /** Metres of the item that run along the route. */
  alongM: number;
}

interface Projection {
  x(lon: number): number;
  y(lat: number): number;
}

function projectionAt(lat0: number): Projection {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_574;
  return { x: (lon) => lon * kx, y: (lat) => lat * ky };
}

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Route distance at a. */
  at: number;
  len: number;
}

export interface RouteIndex {
  proj: Projection;
  segments: Segment[];
  cells: Map<string, number[]>;
  /** Total length in metres. */
  length: number;
  bbox: [number, number, number, number];
}

const cellKey = (ix: number, iy: number): string => `${ix},${iy}`;

/** Projects the route once and buckets its segments in a grid, so matching thousands of items stays fast. */
export function indexRoute(route: readonly LonLat[]): RouteIndex {
  const lat0 = route.length ? route.reduce((s, c) => s + c[1], 0) / route.length : 52;
  const proj = projectionAt(lat0);
  const segments: Segment[] = [];
  const cells = new Map<string, number[]>();
  let at = 0;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of route) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    if (!a || !b) continue;
    const seg: Segment = { ax: proj.x(a[0]), ay: proj.y(a[1]), bx: proj.x(b[0]), by: proj.y(b[1]), at, len: 0 };
    seg.len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
    at += seg.len;
    if (seg.len === 0) continue;
    const idx = segments.push(seg) - 1;
    const pad = POINT_CORRIDOR_M;
    const x0 = Math.floor((Math.min(seg.ax, seg.bx) - pad) / CELL_M);
    const x1 = Math.floor((Math.max(seg.ax, seg.bx) + pad) / CELL_M);
    const y0 = Math.floor((Math.min(seg.ay, seg.by) - pad) / CELL_M);
    const y1 = Math.floor((Math.max(seg.ay, seg.by) + pad) / CELL_M);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = cellKey(ix, iy);
        const list = cells.get(k);
        if (list) list.push(idx);
        else cells.set(k, [idx]);
      }
    }
  }
  return { proj, segments, cells, length: at, bbox: [w, s, e, n] };
}

interface Nearest {
  /** Signed distance: positive = left of the driving direction. */
  dist: number;
  /** Route distance of the foot point. */
  at: number;
  seg: Segment;
}

/** Nearest route segment to (x, y) within `maxDist`, optionally only those within MAX_ANGLE_DEG of (dx, dy). */
function nearest(index: RouteIndex, x: number, y: number, maxDist: number, dir?: [number, number]): Nearest | null {
  const list = index.cells.get(cellKey(Math.floor(x / CELL_M), Math.floor(y / CELL_M)));
  if (!list) return null;
  const cosMax = Math.cos((MAX_ANGLE_DEG * Math.PI) / 180);
  let best: Nearest | null = null;
  for (const i of list) {
    const seg = index.segments[i];
    if (!seg) continue;
    const sx = seg.bx - seg.ax;
    const sy = seg.by - seg.ay;
    if (dir) {
      const cos = Math.abs(sx * dir[0] + sy * dir[1]) / (seg.len * Math.hypot(dir[0], dir[1]));
      if (cos < cosMax) continue;
    }
    const t = Math.max(0, Math.min(1, ((x - seg.ax) * sx + (y - seg.ay) * sy) / (seg.len * seg.len)));
    const dist = Math.hypot(seg.ax + t * sx - x, seg.ay + t * sy - y);
    if (dist <= maxDist && (!best || dist < Math.abs(best.dist))) {
      const left = sx * (y - seg.ay) - sy * (x - seg.ax) > 0;
      best = { dist: left ? dist : -dist, at: seg.at + t * seg.len, seg };
    }
  }
  return best;
}

function linesOf(g: ItemGeometry): LonLat[][] {
  if (g.type === 'LineString') return [g.coordinates.map((c) => [c[0] ?? 0, c[1] ?? 0] as LonLat)];
  if (g.type === 'MultiLineString') return g.coordinates.map((line) => line.map((c) => [c[0] ?? 0, c[1] ?? 0] as LonLat));
  return [];
}

function bboxHits(index: RouteIndex, g: ItemGeometry): boolean {
  const pad = 0.001;
  const [w, s, e, n] = index.bbox;
  const coords = g.type === 'Point' ? [g.coordinates] : linesOf(g).flat();
  let iw = Infinity;
  let is = Infinity;
  let ie = -Infinity;
  let iN = -Infinity;
  for (const c of coords) {
    const lon = c[0] ?? 0;
    const lat = c[1] ?? 0;
    iw = Math.min(iw, lon);
    ie = Math.max(ie, lon);
    is = Math.min(is, lat);
    iN = Math.max(iN, lat);
  }
  // Box overlap, not "a vertex inside": a long line with sparse vertices can span a short route.
  return iw <= e + pad && ie >= w - pad && is <= n + pad && iN >= s - pad;
}

/** Where (and how far) one item lies on the route; null when it does not. */
export function matchGeometry(index: RouteIndex, id: string, g: ItemGeometry): RouteMatch | null {
  if (!bboxHits(index, g)) return null;
  const { proj } = index;
  if (g.type === 'Point') {
    const hit = nearest(index, proj.x(g.coordinates[0] ?? 0), proj.y(g.coordinates[1] ?? 0), POINT_CORRIDOR_M);
    return hit ? { id, side: 'op', fromM: hit.at, toM: hit.at, alongM: 0 } : null;
  }
  let total = 0;
  let along = 0;
  let left = 0;
  let fromM = Infinity;
  let toM = -Infinity;
  for (const line of linesOf(g)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (!a || !b) continue;
      const ax = proj.x(a[0]);
      const ay = proj.y(a[1]);
      const dx = proj.x(b[0]) - ax;
      const dy = proj.y(b[1]) - ay;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      total += len;
      const steps = Math.max(1, Math.ceil(len / SAMPLE_M));
      const step = len / steps;
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const hit = nearest(index, ax + t * dx, ay + t * dy, CORRIDOR_M, [dx, dy]);
        if (!hit) continue;
        along += step;
        if (hit.dist >= BESIDE_MIN_M) left += step;
        fromM = Math.min(fromM, hit.at);
        toM = Math.max(toM, hit.at);
      }
    }
  }
  if (along === 0) return null;
  // A short route (across a village) can only run along a long road for its own length.
  if (along < Math.min(MIN_ALONG_M, total * MIN_ALONG_SHARE, index.length * MIN_ALONG_SHARE)) return null;
  return { id, side: sideOf(along, left), fromM, toM, alongM: along };
}

/** `naast` only when the line keeps clearly to the left; anything mixed stays `op`. */
export function sideOf(along: number, left: number): RouteSide {
  return along > 0 && left >= along * SIDE_SHARE ? 'naast' : 'op';
}

/** Cheap fingerprint of a geometry: vertex count plus first and last vertex. */
function geometrySignature(g: ItemGeometry): string {
  const coords = g.type === 'Point' ? [g.coordinates] : linesOf(g).flat();
  const first = coords[0] ?? [];
  const last = coords[coords.length - 1] ?? [];
  return `${coords.length}:${first.join(',')}:${last.join(',')}`;
}

export interface MatchableFeature {
  properties: { id: string };
  geometry: ItemGeometry;
}

/** Every item on the route, in driving order. */
export function matchRoute(route: readonly LonLat[], features: readonly MatchableFeature[]): RouteMatch[] {
  return createRouteMatcher(route)(features);
}

/**
 * `matchRoute` for one route over and over: the route is indexed once and every item id is
 * matched once. The live data refreshes every 90 s with mostly the same items, so a refresh only
 * matches what is new or whose geometry changed.
 */
export function createRouteMatcher(route: readonly LonLat[]): (features: readonly MatchableFeature[]) => RouteMatch[] {
  const index = route.length >= 2 ? indexRoute(route) : null;
  const seen = new Map<string, RouteMatch | null>();
  return (features) => {
    if (!index) return [];
    const out: RouteMatch[] = [];
    for (const f of features) {
      const id = f.properties.id;
      // A live queue keeps its id while it grows: the geometry is part of the key.
      const key = `${id}|${geometrySignature(f.geometry)}`;
      let m = seen.get(key);
      if (m === undefined) {
        m = matchGeometry(index, id, f.geometry);
        seen.set(key, m);
      }
      if (m) out.push(m);
    }
    return out.sort((a, b) => a.fromM - b.fromM);
  };
}

/** The point at `atM` metres along the route. */
export function pointAlong(route: readonly LonLat[], atM: number): LonLat | null {
  const index = indexRoute(route);
  return pointAlongIndex(index, atM);
}

function pointAlongIndex(index: RouteIndex, atM: number): LonLat | null {
  const { proj } = index;
  for (const seg of index.segments) {
    if (atM <= seg.at + seg.len) {
      const t = Math.max(0, Math.min(1, (atM - seg.at) / seg.len));
      return [(seg.ax + t * (seg.bx - seg.ax)) / proj.x(1), (seg.ay + t * (seg.by - seg.ay)) / proj.y(1)];
    }
  }
  const last = index.segments[index.segments.length - 1];
  return last ? [last.bx / proj.x(1), last.by / proj.y(1)] : null;
}

/** Spacing of the points that keep the router off a long closure (it must not join it halfway). */
export const AVOID_SPACING_M = 1500;
/** Routers cap the number of points to avoid; keep well under it. */
export const MAX_AVOID_POINTS = 40;

/**
 * Points on the route inside each matched stretch, for the router's "avoid these locations".
 * Each point sits ON the route, so the router snaps it to the road that is closed, not to a
 * parallel one. A long stretch gets one point per AVOID_SPACING_M.
 */
export function avoidPoints(route: readonly LonLat[], matches: readonly RouteMatch[]): LonLat[] {
  const index = indexRoute(route);
  const out: LonLat[] = [];
  for (const m of matches) {
    const span = Math.max(0, m.toM - m.fromM);
    const n = Math.max(1, Math.floor(span / AVOID_SPACING_M) + 1);
    for (let i = 0; i < n; i++) {
      const at = n === 1 ? m.fromM + span / 2 : m.fromM + (span * (i + 0.5)) / n;
      const p = pointAlongIndex(index, at);
      if (p) out.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
    }
  }
  return out.slice(0, MAX_AVOID_POINTS);
}

/** How far a stretch of another route must leave this one to count as a different way. */
export const DEVIATE_M = 150;

/**
 * Up to `count` points of `route` where it runs away from `other` (more than DEVIATE_M from it),
 * evenly over the part that deviates. Used as Google Maps via points: three points spread over
 * the whole route let Google cut back through the closure between two of them; points on the
 * stretch that differs pin the detour itself.
 */
export function deviatingPoints(route: readonly LonLat[], other: readonly LonLat[], count = 3): LonLat[] {
  if (route.length < 2 || other.length < 2) return [];
  const index = indexRoute(other);
  const { proj } = index;
  const far = route.filter(([lon, lat]) => {
    const x = proj.x(lon);
    const y = proj.y(lat);
    let best = Infinity;
    for (const seg of index.segments) {
      const sx = seg.bx - seg.ax;
      const sy = seg.by - seg.ay;
      const t = Math.max(0, Math.min(1, ((x - seg.ax) * sx + (y - seg.ay) * sy) / (seg.len * seg.len)));
      best = Math.min(best, Math.hypot(seg.ax + t * sx - x, seg.ay + t * sy - y));
      if (best <= DEVIATE_M) return false;
    }
    return true;
  });
  if (far.length === 0) return [];
  const n = Math.min(count, far.length);
  return Array.from({ length: n }, (_, i) => far[Math.floor(((i + 0.5) * far.length) / n)] as LonLat);
}
