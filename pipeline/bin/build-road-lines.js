#!/usr/bin/env node
/**
 * Build `web/public/road-lines/<slug>.json`: the course of every A- and N-road of
 * `static/wegen.json` as light lines for the map's road mode (src/road-lines.js), from the NWB
 * wegvakken of PDOK (WFS, CC0). One request per road, a few at a time; roads the NWB does not know
 * under that number (S-routes, E-numbers, renumbered roads) get no file and the map simply draws
 * no line for them. Roads rarely change course: run it by hand now and then, not in the pipeline.
 *
 *   node bin/build-road-lines.js [--wegen static/wegen.json] [--out ../web/public/road-lines] [--only A2,N210]
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MAIN_BST_CODES, roadLineFile } from '../src/road-lines.js';

const WFS = 'https://service.pdok.nl/rws/nwbwegen/wfs/v1_0';
const PAGE = 1000;
const PARALLEL = 3;
const RETRIES = 2;
const TIMEOUT_MS = 60_000;

/**
 * FES filter: the road number as the hectometre signs show it ("A2", "N9", "N210") and the main
 * carriageway only. `wegnummer` would mix the A9 and the N9 (both rijksweg 009).
 * @param {string} road
 */
export function nwbFilter(road) {
  const codes = MAIN_BST_CODES.map((c) => `<PropertyIsEqualTo><ValueReference>bstCode</ValueReference><Literal>${c}</Literal></PropertyIsEqualTo>`).join('');
  return `<Filter xmlns="http://www.opengis.net/fes/2.0"><And><PropertyIsEqualTo><ValueReference>wegnrHmp</ValueReference><Literal>${road}</Literal></PropertyIsEqualTo><Or>${codes}</Or></And></Filter>`;
}

/** @param {string} road @param {number} start */
export function nwbUrl(road, start) {
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'nwbwegen:wegvakken',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    propertyName: 'geom,bstCode',
    count: String(PAGE),
    startIndex: String(start),
    filter: nwbFilter(road),
  });
  return `${WFS}?${q}`;
}

/** @param {string} url */
async function getJson(url) {
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

/** Every main-carriageway wegvak of one road, page by page. @param {string} road */
async function fetchRoad(road) {
  const features = [];
  for (let start = 0; ; start += PAGE) {
    const page = await getJson(nwbUrl(road, start));
    const got = Array.isArray(page.features) ? page.features : [];
    features.push(...got);
    if (got.length < PAGE) return features;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      wegen: { type: 'string', default: fileURLToPath(new URL('../static/wegen.json', import.meta.url)) },
      out: { type: 'string', default: fileURLToPath(new URL('../../web/public/road-lines', import.meta.url)) },
      only: { type: 'string' },
    },
  });
  const only = values.only ? new Set(values.only.split(',').map((s) => s.trim().toUpperCase())) : null;
  /** @type {{ road: string, slug: string, type: string }[]} */
  const all = JSON.parse(readFileSync(values.wegen, 'utf8')).roads;
  const roads = all.filter((r) => (r.type === 'A' || r.type === 'N') && (!only || only.has(r.road)));
  mkdirSync(values.out, { recursive: true });
  const version = new Date().toISOString().slice(0, 10);
  const written = new Set();
  const missing = [];
  const failed = [];
  let bytes = 0;
  let next = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      const r = roads[i];
      if (!r) return;
      try {
        const file = roadLineFile(r.road, await fetchRoad(r.road), version);
        if (!file) {
          missing.push(r.road);
          continue;
        }
        const json = JSON.stringify(file);
        writeFileSync(join(values.out, `${r.slug}.json`), `${json}\n`);
        written.add(`${r.slug}.json`);
        bytes += json.length + 1;
      } catch (err) {
        failed.push(`${r.road} (${err instanceof Error ? err.message : String(err)})`);
      }
      if ((i + 1) % 50 === 0) process.stdout.write(`${i + 1}/${roads.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  // A full run also removes the files of roads that are gone or lost their NWB number.
  if (!only && failed.length === 0) {
    for (const name of readdirSync(values.out)) if (name.endsWith('.json') && !written.has(name)) rmSync(join(values.out, name));
  }
  process.stdout.write(`road-lines: ${written.size} of ${roads.length} roads, ${(bytes / 1024).toFixed(0)} KB → ${values.out}\n`);
  if (missing.length > 0) process.stdout.write(`no NWB main carriageway for ${missing.length}: ${missing.slice(0, 40).join(', ')}${missing.length > 40 ? ' …' : ''}\n`);
  if (failed.length > 0) {
    process.stderr.write(`failed ${failed.length}: ${failed.join('; ')}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`build-road-lines failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
}
