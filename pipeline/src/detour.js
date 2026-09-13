/**
 * Detour geometry: the `sit:alternativeRoute` of a `ReroutingManagement`
 * record, reduced to a polyline of at most `DETOUR_MAX_POINTS` WGS84
 * `[lon, lat]` points (5 decimals) inside the NL bbox — enough to draw the
 * route on the map and to open it as a Google Maps route with waypoints.
 *
 * The first rerouting record (in publication order) that carries a route with
 * at least two usable points wins; RWS marks its routes `signedRerouting`,
 * Melvin does not, so the flag is not a criterion.
 */

import { inNl, roundCoord } from './geometry.js';

export const DETOUR_MAX_POINTS = 12;

/**
 * @param {{ type: string, detourLine?: [number, number][] }[]} recs
 * @returns {[number, number][] | undefined}
 */
export function detourGeomOf(recs) {
  for (const r of recs) {
    if (r.type !== 'ReroutingManagement' || !r.detourLine) continue;
    const line = simplifyDetour(r.detourLine);
    if (line.length >= 2) return line;
  }
  return undefined;
}

/**
 * Clip to NL, round to 5 decimals, drop consecutive duplicates, then reduce to
 * at most `max` points: Douglas–Peucker with a growing tolerance first, uniform
 * thinning when a line is still too long. First and last point always survive.
 * @param {[number, number][]} line
 * @param {number} [max]
 * @returns {[number, number][]}
 */
export function simplifyDetour(line, max = DETOUR_MAX_POINTS) {
  /** @type {[number, number][]} */
  const clean = [];
  for (const c of line) {
    if (!inNl(c)) continue;
    const r = roundCoord(c);
    const prev = clean[clean.length - 1];
    if (prev && prev[0] === r[0] && prev[1] === r[1]) continue;
    clean.push(r);
  }
  if (clean.length <= max) return clean;
  let simplified = clean;
  // ~1 m in degrees; each pass doubles until the line fits or the tolerance is absurd (~10 km)
  for (let tolerance = 1e-5; simplified.length > max && tolerance < 0.1; tolerance *= 2) {
    simplified = douglasPeucker(clean, tolerance);
  }
  return simplified.length > max ? thinUniform(simplified, max) : simplified;
}

/**
 * Iterative Douglas–Peucker on [lon, lat] with a planar tolerance in degrees
 * (longitude scaled for NL latitude).
 * @param {[number, number][]} line
 * @param {number} tolerance
 * @returns {[number, number][]}
 */
export function douglasPeucker(line, tolerance) {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  /** @type {[number, number][]} */
  const stack = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [first, last] = /** @type {[number, number]} */ (stack.pop());
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(line[i], line[first], line[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index >= 0 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}

/**
 * Keep `max` evenly spaced vertices, always including the first and the last.
 * @param {[number, number][]} line
 * @param {number} max
 * @returns {[number, number][]}
 */
export function thinUniform(line, max) {
  if (line.length <= max) return line;
  if (max < 2) return [line[0], line[line.length - 1]];
  /** @type {[number, number][]} */
  const out = [];
  const step = (line.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(line[Math.round(i * step)]);
  return out;
}

/** @param {[number, number]} p @param {[number, number]} a @param {[number, number]} b */
function perpendicularDistance(p, a, b) {
  const scale = 0.62; // cos(52°): degrees of longitude are shorter than degrees of latitude
  const ax = a[0] * scale;
  const bx = b[0] * scale;
  const px = p[0] * scale;
  const dx = bx - ax;
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), p[1] - (a[1] + t * dy));
}
