#!/usr/bin/env node
/**
 * Copies the fixture data set (web/fixtures/data/**) to web/public/data/ when no real
 * pipeline output is present (public/data/meta.json missing). Used by `npm run dev` and
 * `npm run build` so the app always has data to render.
 *
 * The copied meta.json / index files get `generated` = now, because the fixture is a stand-in
 * for a live feed: the live pill would otherwise report stale data in development.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const fixtures = join(webRoot, 'fixtures', 'data');
const target = join(webRoot, 'public', 'data');

function stampGenerated(file, iso) {
  if (!existsSync(file)) return;
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    if (json && typeof json === 'object' && typeof json.generated === 'string') {
      json.generated = iso;
      writeFileSync(file, JSON.stringify(json));
    }
  } catch (err) {
    console.warn(`[ensure-data] kon ${file} niet bijwerken: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function main() {
  if (existsSync(join(target, 'meta.json'))) {
    console.log('[ensure-data] public/data/meta.json aanwezig — fixtures niet gekopieerd');
    return;
  }
  if (!existsSync(join(fixtures, 'meta.json'))) {
    console.error('[ensure-data] geen fixtures gevonden in web/fixtures/data — draai `node scripts/make-fixtures.mjs`');
    process.exitCode = 1;
    return;
  }
  mkdirSync(target, { recursive: true });
  cpSync(fixtures, target, { recursive: true });
  const now = new Date();
  now.setUTCSeconds(0, 0);
  const iso = now.toISOString().replace(/\.000Z$/, 'Z');
  for (const file of walk(target)) {
    if (/meta\.json$|index[\\/].*\.json$|bruggen\.json$|(roads|gemeenten)[\\/].*\.json$/.test(file)) stampGenerated(file, iso);
  }
  console.log(`[ensure-data] fixtures gekopieerd naar public/data (generated = ${iso})`);
}

main();
