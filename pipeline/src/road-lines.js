/**
 * The course of one road as a light line for the map's road mode: the main carriageway of the
 * road in the Nationaal Wegenbestand (NWB, PDOK, CC0), chained into long lines and simplified.
 * In road mode the map only drew the stretches with a measure, so "which road is the A2?" had no
 * answer on the map itself (review 2026-10-16). The BRT basemap cannot help: its road lines carry
 * a road class but no road number.
 *
 * Pure; the download lives in bin/build-road-lines.js.
 */

import { round5 } from './geometry.js';

/**
 * NWB `bstCode` values of the road itself: hoofdrijbaan, normale and gescheiden rijbaan, and the
 * roundabouts an N-road runs through (without them its line has a gap at every roundabout).
 * Ramps, connecting roads, parallel roads, parking areas, bus lanes and cycle paths are left out.
 */
export const MAIN_BST_CODES = Object.freeze(['HR', 'NRB', 'GRB', 'RB', 'MRB', 'TRB']);

/** Default simplification tolerance: about one pixel at zoom 13. */
export const TOLERANCE_M = 15;

const EARTH_R = 6_371_000;
/** Metres per degree of longitude at the latitude of the Netherlands. */
const LON_SCALE = Math.cos((52 * Math.PI) / 180);

/**
 * @param {[number, number]} c
 * @returns {[number, number]}
 */
function metric([lon, lat]) {
  return [((lon * Math.PI) / 180) * EARTH_R * LON_SCALE, ((lat * Math.PI) / 180) * EARTH_R];
}

/**
 * Douglas–Peucker in metres; the first and last point always stay.
 * @param {[number, number][]} line
 * @param {number} toleranceM
 * @returns {[number, number][]}
 */
export function simplifyLine(line, toleranceM = TOLERANCE_M) {
  if (line.length < 3) return [...line];
  const xy = line.map(metric);
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  /** @type {[number, number][]} */
  const stack = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [a, b] = /** @type {[number, number]} */ (stack.pop());
    const [ax, ay] = /** @type {[number, number]} */ (xy[a]);
    const [bx, by] = /** @type {[number, number]} */ (xy[b]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = /** @type {[number, number]} */ (xy[i]);
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d2 = ex * ex + ey * ey;
      if (d2 > worst) {
        worst = d2;
        at = i;
      }
    }
    if (at >= 0 && worst > tol2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}

/** @param {[number, number]} c */
const endKey = ([lon, lat]) => `${round5(lon)},${round5(lat)}`;

/**
 * Joins lines that meet end to end into longer ones. A join stops at a fork (three or more lines
 * meeting at one point), so the result never jumps between branches. Direction is not kept.
 * @param {[number, number][][]} lines
 * @returns {[number, number][][]}
 */
export function chainLines(lines) {
  const pool = lines.filter((l) => l.length >= 2);
  /** @type {Map<string, number[]>} */
  const ends = new Map();
  pool.forEach((l, i) => {
    for (const key of [endKey(/** @type {[number, number]} */ (l[0])), endKey(/** @type {[number, number]} */ (l[l.length - 1]))]) {
      const list = ends.get(key) ?? [];
      list.push(i);
      ends.set(key, list);
    }
  });
  const used = new Uint8Array(pool.length);
  /** @type {[number, number][][]} */
  const out = [];
  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let line = /** @type {[number, number][]} */ (pool[i]);
    for (const atEnd of [true, false]) {
      for (;;) {
        const tip = /** @type {[number, number]} */ (atEnd ? line[line.length - 1] : line[0]);
        const key = endKey(tip);
        const meeting = ends.get(key) ?? [];
        // One other line at this point: continue. None or a fork: stop.
        if (meeting.length !== 2) break;
        const next = meeting.find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        let piece = /** @type {[number, number][]} */ (pool[next]);
        if (atEnd) {
          if (endKey(/** @type {[number, number]} */ (piece[0])) !== key) piece = [...piece].reverse();
          line = [...line, ...piece.slice(1)];
        } else {
          if (endKey(/** @type {[number, number]} */ (piece[piece.length - 1])) !== key) piece = [...piece].reverse();
          line = [...piece.slice(0, -1), ...line];
        }
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * @typedef {object} NwbFeature
 * @property {{ bstCode?: string | null }} properties
 * @property {{ type: string, coordinates: unknown } | null} geometry
 */

/**
 * The main-carriageway lines of NWB wegvakken (GeoJSON features in WGS 84).
 * @param {readonly NwbFeature[]} features
 * @returns {[number, number][][]}
 */
export function mainLines(features) {
  /** @type {[number, number][][]} */
  const out = [];
  for (const f of features) {
    if (!MAIN_BST_CODES.includes(f.properties?.bstCode ?? '')) continue;
    const g = f.geometry;
    if (!g) continue;
    const parts = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
    for (const part of /** @type {unknown[]} */ (parts)) {
      if (!Array.isArray(part)) continue;
      const line = part.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => /** @type {[number, number]} */ ([c[0], c[1]]));
      if (line.length >= 2) out.push(line);
    }
  }
  return out;
}

/**
 * The file the map loads for one road: chained, simplified and rounded main-carriageway lines.
 * Null when the NWB has no main carriageway under this number.
 * @param {string} road "A2", "N210"
 * @param {readonly NwbFeature[]} features
 * @param {string} version
 * @param {number} [toleranceM]
 * @returns {{ road: string, source: string, lines: [number, number][][] } | null}
 */
export function roadLineFile(road, features, version, toleranceM = TOLERANCE_M) {
  const lines = chainLines(mainLines(features))
    .map((l) => simplifyLine(l, toleranceM).map(([lon, lat]) => /** @type {[number, number]} */ ([round5(lon), round5(lat)])))
    .filter((l) => l.length >= 2);
  if (lines.length === 0) return null;
  return { road, source: `NWB-Wegen (PDOK, CC0) ${version}`, lines };
}
