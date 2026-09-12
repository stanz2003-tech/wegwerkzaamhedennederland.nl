#!/usr/bin/env node
/**
 * Build `static/wegen.json` from `static/vild.json`:
 * `{version, roads: RoadEntry[]}`, `RoadEntry = {road, slug, type, names, lon, lat, bbox, points}`.
 * Every VILD ROADNUMBER that is an A/N/E number or an Amsterdam s-route is
 * included; codes like `v100-CR1`, `R125`, `F001` are skipped.
 *
 *   node bin/build-wegen.js [--vild static/vild.json] [--out static/wegen.json]
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { round5 } from '../src/geometry.js';
import { normalizeVildRoad, roadTypeOf } from '../src/roads.js';
import { slugify } from '../src/slug.js';
import { loadVild } from '../src/vild.js';

const MAX_NAMES = 12;

/**
 * @typedef {object} RoadEntry
 * @property {string} road
 * @property {string} slug
 * @property {'A'|'N'|'S'|'E'|'overig'} type
 * @property {string[]} names
 * @property {number} lon
 * @property {number} lat
 * @property {[number, number, number, number]} bbox
 * @property {number} points
 */

/**
 * @param {import('../src/vild.js').Vild} vild
 * @returns {{ roads: RoadEntry[], skipped: string[] }}
 */
export function buildRoads(vild) {
  /** @type {Map<string, { pts: [number, number][], names: Set<string>, routes: Set<string> }>} */
  const groups = new Map();
  const skipped = new Set();
  for (const row of vild.rows()) {
    if (!row.road) continue;
    const road = normalizeVildRoad(row.road);
    if (!road) {
      if (/^[ANSsE]/.test(row.road)) skipped.add(row.road);
      continue;
    }
    const group = groups.get(road) ?? { pts: [], names: new Set(), routes: new Set() };
    if (row.lonlat) group.pts.push(row.lonlat);
    if (row.roadName) group.names.add(row.roadName);
    if (row.type.startsWith('L') && row.name1 && row.name2) group.routes.add(`${row.name1} → ${row.name2}`);
    groups.set(road, group);
  }

  /** @type {RoadEntry[]} */
  const roads = [];
  for (const [road, group] of groups) {
    if (group.pts.length === 0) continue;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    let sumLon = 0;
    let sumLat = 0;
    for (const [lon, lat] of group.pts) {
      sumLon += lon;
      sumLat += lat;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
    const names = [...group.routes, ...group.names].slice(0, MAX_NAMES);
    const type = roadTypeOf(road);
    roads.push({
      road,
      slug: slugify(road),
      type: type === 'lokaal' ? 'overig' : type,
      names,
      lon: round5(sumLon / group.pts.length),
      lat: round5(sumLat / group.pts.length),
      bbox: [round5(w), round5(s), round5(e), round5(n)],
      points: group.pts.length,
    });
  }
  roads.sort(compareRoads);
  return { roads, skipped: [...skipped].sort() };
}

/** A before N before s before E, then numerically. */
/** @param {RoadEntry} a @param {RoadEntry} b */
function compareRoads(a, b) {
  const order = { A: 0, N: 1, S: 2, E: 3, overig: 4 };
  if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
  const na = Number.parseInt(a.road.slice(1), 10);
  const nb = Number.parseInt(b.road.slice(1), 10);
  if (na !== nb) return na - nb;
  return a.road < b.road ? -1 : a.road > b.road ? 1 : 0;
}

async function main() {
  const { values } = parseArgs({
    options: {
      vild: { type: 'string' },
      out: { type: 'string', default: fileURLToPath(new URL('../static/wegen.json', import.meta.url)) },
    },
  });
  const vild = loadVild(values.vild);
  const { roads, skipped } = buildRoads(vild);
  const counts = roads.reduce((acc, r) => ((acc[r.type] = (acc[r.type] ?? 0) + 1), acc), /** @type {Record<string, number>} */ ({}));
  const out = { version: new Date().toISOString().slice(0, 10), source: 'VILD 6.13.A', roads };
  writeFileSync(values.out, JSON.stringify(out, null, 0).replace(/\},\{"road"/g, '},\n{"road"') + '\n');
  process.stdout.write(`wegen.json: ${roads.length} roads ${JSON.stringify(counts)} → ${values.out}\n`);
  if (skipped.length > 0) process.stderr.write(`skipped ${skipped.length} A/N/s/E-like codes that are not road numbers: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ' …' : ''}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`build-wegen failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
}
