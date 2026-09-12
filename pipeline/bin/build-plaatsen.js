#!/usr/bin/env node
/**
 * Build `static/plaatsen.json` from the PDOK Locatieserver (key-less):
 * all 2,503 woonplaatsen and 342 gemeenten with centroid, province and slug.
 *
 *   node bin/build-plaatsen.js [--out static/plaatsen.json]
 *
 * Slug = slugify(naam); when two woonplaatsen share a slug, ALL of them get
 * `slugify(naam)-slugify(gemeente)`. Gemeente names are unique.
 * Requests are paced 100 ms apart, 10 s timeout, 2 retries.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { round5 } from '../src/geometry.js';
import { slugify } from '../src/slug.js';
import { normalizeProvince } from '../src/sources-friendly.js';

export const PDOK_FREE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const ROWS = 100;
const SPACING_MS = 100;
const TIMEOUT_MS = 10_000;
const RETRIES = 2;
const WOONPLAATS_FIELDS = 'woonplaatsnaam,woonplaatscode,gemeentenaam,gemeentecode,provincienaam,provinciecode,centroide_ll';
const GEMEENTE_FIELDS = 'gemeentenaam,gemeentecode,provincienaam,provinciecode,centroide_ll';

/**
 * Parse WKT `POINT(lon lat)`.
 * @param {unknown} wkt
 * @returns {[number, number] | undefined}
 */
export function parsePointWkt(wkt) {
  if (typeof wkt !== 'string') return undefined;
  const m = wkt.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  if (!m) return undefined;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [round5(lon), round5(lat)] : undefined;
}

/**
 * Fetch every document of a type, page by page.
 * @param {'woonplaats'|'gemeente'} type
 * @param {string} fields
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, log?: (m: string) => void }} [opts]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function fetchAll(type, fields, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  /** @type {Record<string, unknown>[]} */
  const docs = [];
  let start = 0;
  let numFound = Infinity;
  while (start < numFound) {
    const url = `${PDOK_FREE_URL}?q=*&fq=type:${type}&rows=${ROWS}&start=${start}&fl=${fields}`;
    const body = await fetchJson(url, fetchImpl);
    const response = body.response ?? {};
    numFound = Number(response.numFound ?? 0);
    const page = Array.isArray(response.docs) ? response.docs : [];
    if (page.length === 0) break;
    docs.push(...page);
    start += page.length;
    opts.log?.(`${type}: ${docs.length}/${numFound}`);
    if (start < numFound) await sleep(SPACING_MS);
  }
  return docs;
}

/**
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<any>}
 */
async function fetchJson(url, fetchImpl) {
  let lastError = 'unknown';
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`PDOK request failed (${lastError}): ${url}`);
}

/**
 * @param {Record<string, unknown>[]} gemeenteDocs
 * @param {Record<string, unknown>[]} woonplaatsDocs
 */
export function buildPlaatsen(gemeenteDocs, woonplaatsDocs) {
  const gemeenten = gemeenteDocs
    .map((d) => {
      const c = parsePointWkt(d.centroide_ll);
      const prov = normalizeProvince(str(d.provincienaam));
      if (!c || !d.gemeentenaam) return undefined;
      return {
        code: str(d.gemeentecode) ?? '',
        naam: str(d.gemeentenaam) ?? '',
        slug: slugify(str(d.gemeentenaam) ?? ''),
        prov: prov?.name ?? str(d.provincienaam) ?? '',
        provCode: prov?.code ?? str(d.provinciecode) ?? '',
        lon: c[0],
        lat: c[1],
      };
    })
    .filter((g) => g !== undefined)
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));

  const woonplaatsen = woonplaatsDocs
    .map((d) => {
      const c = parsePointWkt(d.centroide_ll);
      const prov = normalizeProvince(str(d.provincienaam));
      if (!c || !d.woonplaatsnaam) return undefined;
      return {
        code: str(d.woonplaatscode) ?? '',
        naam: str(d.woonplaatsnaam) ?? '',
        slug: slugify(str(d.woonplaatsnaam) ?? ''),
        gemeente: str(d.gemeentenaam) ?? '',
        gemeenteCode: str(d.gemeentecode) ?? '',
        prov: prov?.name ?? str(d.provincienaam) ?? '',
        provCode: prov?.code ?? str(d.provinciecode) ?? '',
        lon: c[0],
        lat: c[1],
      };
    })
    .filter((w) => w !== undefined)
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl') || a.gemeente.localeCompare(b.gemeente, 'nl'));

  const slugCount = new Map();
  for (const w of woonplaatsen) slugCount.set(w.slug, (slugCount.get(w.slug) ?? 0) + 1);
  for (const w of woonplaatsen) {
    if ((slugCount.get(w.slug) ?? 0) > 1) w.slug = `${w.slug}-${slugify(w.gemeente)}`;
  }
  return { gemeenten, woonplaatsen };
}

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

async function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string', default: fileURLToPath(new URL('../static/plaatsen.json', import.meta.url)) } },
  });
  const log = (/** @type {string} */ m) => process.stderr.write(m + '\n');
  const gemeenteDocs = await fetchAll('gemeente', GEMEENTE_FIELDS, { log });
  const woonplaatsDocs = await fetchAll('woonplaats', WOONPLAATS_FIELDS, { log });
  const { gemeenten, woonplaatsen } = buildPlaatsen(gemeenteDocs, woonplaatsDocs);
  if (gemeenten.length < 300 || woonplaatsen.length < 2000) {
    throw new Error(`Suspiciously few results (gemeenten ${gemeenten.length}, woonplaatsen ${woonplaatsen.length}); not writing`);
  }
  const out = { version: new Date().toISOString().slice(0, 10), source: 'PDOK Locatieserver v3_1', gemeenten, woonplaatsen };
  writeFileSync(values.out, JSON.stringify(out, null, 0).replace(/\},\{"code"/g, '},\n{"code"') + '\n');
  const dupes = woonplaatsen.filter((w) => w.slug.includes('-') && woonplaatsen.some((o) => o !== w && o.naam === w.naam)).length;
  process.stdout.write(`plaatsen.json: ${gemeenten.length} gemeenten, ${woonplaatsen.length} woonplaatsen (${dupes} disambiguated slugs) → ${values.out}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`build-plaatsen failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
}
