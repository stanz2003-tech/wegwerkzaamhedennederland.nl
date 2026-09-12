/**
 * Geometry helpers: posList parsing, GeoJSON construction from parsed
 * locations, VILD fallback for AlertC-only records, NL bbox clipping,
 * rounding and representative midpoint.
 */

/** West, south, east, north. Parts outside are dropped and counted. */
export const NL_BBOX = Object.freeze([3.2, 50.5, 7.3, 53.7]);

const DECIMALS = 5;
const FACTOR = 10 ** DECIMALS;

/** @param {number} n */
export function round5(n) {
  return Math.round(n * FACTOR) / FACTOR;
}

/** @param {[number, number]} coordinate */
export function inNl([lon, lat]) {
  return lon >= NL_BBOX[0] && lon <= NL_BBOX[2] && lat >= NL_BBOX[1] && lat <= NL_BBOX[3];
}

/**
 * DATEX II `gml:posList` in WGS 84 is "lat lon lat lon …" (lat FIRST — 44,510 of
 * 44,511 posLists in the planning feed). Returns [lon, lat] pairs, unrounded.
 * @param {string} posList
 * @returns {[number, number][]}
 */
export function parsePosList(posList) {
  const nums = posList.trim().split(/\s+/).map(Number);
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const lat = nums[i];
    const lon = nums[i + 1];
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lon, lat]);
  }
  return out;
}

/**
 * @typedef {{ type: 'Point', coordinates: [number, number] }
 *   | { type: 'LineString', coordinates: [number, number][] }
 *   | { type: 'MultiLineString', coordinates: [number, number][][] }} Geometry
 */

/**
 * Build the item geometry from the locations of a situation's records.
 * Lines win over points (a line says more on a map than a point); several
 * distinct lines become a MultiLineString; only when no record carries
 * coordinates the VILD point of the AlertC primary location is used.
 *
 * @param {import('./parse.js').Location[]} locations   ordered: main record first
 * @param {(alertC: {p?: string, s?: string}) => [number, number] | undefined} [vildPoint]
 * @returns {{ geometry: Geometry | null, dropped: number, fallback: boolean }}
 */
export function buildGeometry(locations, vildPoint) {
  let dropped = 0;
  /** @type {[number, number][][]} */
  const lines = [];
  const seen = new Set();
  for (const loc of locations) {
    if (loc.kind !== 'line' || !loc.line) continue;
    const clipped = clipLine(loc.line);
    dropped += clipped.dropped;
    if (clipped.line.length < 2) continue;
    const key = lineKey(clipped.line);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(clipped.line);
  }
  if (lines.length === 1) return { geometry: { type: 'LineString', coordinates: lines[0] }, dropped, fallback: false };
  if (lines.length > 1) return { geometry: { type: 'MultiLineString', coordinates: lines }, dropped, fallback: false };

  for (const loc of locations) {
    if (loc.kind !== 'point' || !loc.point) continue;
    if (!inNl(loc.point)) {
      dropped++;
      continue;
    }
    return { geometry: { type: 'Point', coordinates: roundCoord(loc.point) }, dropped, fallback: false };
  }

  if (vildPoint) {
    for (const loc of locations) {
      if (!loc.alertC) continue;
      const point = vildPoint(loc.alertC);
      if (point && inNl(point)) {
        return { geometry: { type: 'Point', coordinates: roundCoord(point) }, dropped, fallback: true };
      }
    }
  }
  return { geometry: null, dropped, fallback: false };
}

/**
 * Keep only vertices inside NL, rounded, with consecutive duplicates removed.
 * @param {[number, number][]} line
 */
function clipLine(line) {
  /** @type {[number, number][]} */
  const out = [];
  let dropped = 0;
  for (const c of line) {
    if (!inNl(c)) {
      dropped++;
      continue;
    }
    const r = roundCoord(c);
    const prev = out[out.length - 1];
    if (prev && prev[0] === r[0] && prev[1] === r[1]) continue;
    out.push(r);
  }
  return { line: out, dropped: dropped > 0 ? 1 : 0 };
}

/** @param {[number, number]} c @returns {[number, number]} */
export function roundCoord(c) {
  return [round5(c[0]), round5(c[1])];
}

/** @param {[number, number][]} line */
function lineKey(line) {
  const a = line[0];
  const b = line[line.length - 1];
  return `${line.length}:${a[0]},${a[1]}:${b[0]},${b[1]}`;
}

/**
 * Representative point: the point itself, the half-length point of a line, or
 * the half-length point of the longest part of a MultiLineString.
 * @param {Geometry} geometry
 * @returns {[number, number]}
 */
export function midpoint(geometry) {
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type === 'LineString') return roundCoord(lineMidpoint(geometry.coordinates));
  let longest = geometry.coordinates[0];
  let longestLen = -1;
  for (const part of geometry.coordinates) {
    const len = lineLength(part);
    if (len > longestLen) {
      longestLen = len;
      longest = part;
    }
  }
  return roundCoord(lineMidpoint(longest));
}

/** @param {[number, number][]} line */
function lineLength(line) {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += dist(line[i - 1], line[i]);
  return total;
}

/** @param {[number, number][]} line @returns {[number, number]} */
function lineMidpoint(line) {
  if (line.length === 1) return line[0];
  const half = lineLength(line) / 2;
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = dist(line[i - 1], line[i]);
    if (acc + seg >= half) {
      const t = seg === 0 ? 0 : (half - acc) / seg;
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
    }
    acc += seg;
  }
  return line[line.length - 1];
}

/** Planar distance scaled for NL latitude (good enough to pick a midpoint). */
/** @param {[number, number]} a @param {[number, number]} b */
function dist(a, b) {
  const dx = (a[0] - b[0]) * 0.62; // cos(52°)
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * @param {Geometry} geometry
 * @returns {[number, number, number, number]} [w, s, e, n]
 */
export function bboxOf(geometry) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (/** @type {[number, number]} */ c) => {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  };
  if (geometry.type === 'Point') visit(geometry.coordinates);
  else if (geometry.type === 'LineString') geometry.coordinates.forEach(visit);
  else geometry.coordinates.forEach((part) => part.forEach(visit));
  return [w, s, e, n];
}
