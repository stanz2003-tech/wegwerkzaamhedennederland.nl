/**
 * VILD (Dutch TMC/AlertC location table 6.13.A) lookup.
 *
 * `static/vild.json`: `{version, date, source, fields, loc: {"<LOC_NR>": row}}`
 * with `row = [type, road, roadName, name1, name2, [lon, lat] | null, linRef, areaRef, hectoPos]`.
 * Point rows (P*) reference their road segment via `linRef` → an L row whose
 * name1/name2 are the route ends ("Amsterdam" → "Osnabrück"). P3.2 rows are
 * bridges (name1 = bridge name, name2 = water).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_VILD_PATH = fileURLToPath(new URL('../static/vild.json', import.meta.url));

/**
 * @typedef {object} VildRow
 * @property {string} nr
 * @property {string} type
 * @property {string} road
 * @property {string} roadName
 * @property {string} name1
 * @property {string} name2
 * @property {[number, number] | null} lonlat
 * @property {number} linRef
 * @property {number} areaRef
 * @property {number} hectoPos
 */

/**
 * @typedef {object} AlertCInfo
 * @property {string=} road
 * @property {string=} roadName
 * @property {string=} from
 * @property {string=} to
 * @property {string=} dir
 * @property {string=} route      "Amsterdam → Osnabrück"
 * @property {[number, number]=} point
 */

const MAX_HOPS = 6;

/**
 * @param {Record<string, unknown[]>} loc  raw `loc` object from vild.json
 */
export function createVild(loc) {
  /** @type {Map<string, VildRow>} */
  const cache = new Map();

  /** @param {string | number | undefined} nr @returns {VildRow | undefined} */
  function lookup(nr) {
    if (nr === undefined || nr === null) return undefined;
    const key = String(nr);
    const cached = cache.get(key);
    if (cached) return cached;
    const raw = loc[key];
    if (!Array.isArray(raw)) return undefined;
    /** @type {VildRow} */
    const row = {
      nr: key,
      type: String(raw[0] ?? ''),
      road: String(raw[1] ?? ''),
      roadName: String(raw[2] ?? ''),
      name1: String(raw[3] ?? ''),
      name2: String(raw[4] ?? ''),
      lonlat: Array.isArray(raw[5]) && raw[5].length === 2 ? [Number(raw[5][0]), Number(raw[5][1])] : null,
      linRef: Number(raw[6] ?? 0),
      areaRef: Number(raw[7] ?? 0),
      hectoPos: Number(raw[8] ?? -1),
    };
    cache.set(key, row);
    return row;
  }

  /**
   * Follow `linRef` to the first L row that carries route names.
   * @param {string | number | undefined} nr
   * @returns {VildRow | undefined}
   */
  function routeRow(nr) {
    let row = lookup(nr);
    for (let hop = 0; row && hop < MAX_HOPS; hop++) {
      if (row.type.startsWith('L') && (row.name1 || row.name2)) return row;
      if (!row.linRef) return undefined;
      row = lookup(row.linRef);
    }
    return undefined;
  }

  /** @param {string | number | undefined} nr */
  function routeName(nr) {
    const row = routeRow(nr);
    if (!row) return undefined;
    if (row.name1 && row.name2) return `${row.name1} → ${row.name2}`;
    return row.name1 || row.name2 || undefined;
  }

  /** @param {string | number | undefined} nr @returns {[number, number] | undefined} */
  function point(nr) {
    const row = lookup(nr);
    return row?.lonlat ?? undefined;
  }

  /**
   * Describe an AlertC reference: road number, road name, from/to and point.
   * `from` = name of the primary location, `to` = name of the secondary one.
   * @param {{ p?: string, s?: string, dir?: string } | undefined} alertC
   * @returns {AlertCInfo | undefined}
   */
  function describe(alertC) {
    if (!alertC) return undefined;
    const primary = lookup(alertC.p);
    const secondary = lookup(alertC.s);
    if (!primary && !secondary) return undefined;
    const base = primary ?? secondary;
    const route = routeRow(base?.nr);
    /** @type {AlertCInfo} */
    const info = {};
    const road = base?.road || route?.road;
    if (road) info.road = road;
    const roadName = base?.roadName || route?.roadName;
    if (roadName) info.roadName = roadName;
    if (primary?.name1) info.from = primary.name1;
    if (secondary?.name1 && secondary.name1 !== primary?.name1) info.to = secondary.name1;
    if (alertC.dir === 'positive' || alertC.dir === 'negative' || alertC.dir === 'both') info.dir = alertC.dir;
    const name = routeName(base?.nr);
    if (name) info.route = name;
    const pt = primary?.lonlat ?? secondary?.lonlat;
    if (pt) info.point = pt;
    return info;
  }

  /** Iterate all rows (used by the static list builders). */
  function* rows() {
    for (const key of Object.keys(loc)) {
      const row = lookup(key);
      if (row) yield row;
    }
  }

  return { lookup, routeRow, routeName, point, describe, rows, size: Object.keys(loc).length };
}

/** @typedef {ReturnType<typeof createVild>} Vild */

/**
 * @param {string} [path]
 * @returns {Vild}
 */
export function loadVild(path = DEFAULT_VILD_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw || typeof raw.loc !== 'object') throw new Error(`Invalid VILD table: ${path}`);
  return createVild(raw.loc);
}
