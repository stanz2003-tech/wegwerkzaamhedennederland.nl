/** Reads the generated fixture data set (web/fixtures/data) for the contract tests. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/data/', import.meta.url));

/** NL bounding box from the data contract: parts outside it are dropped by the pipeline. */
export const NL_BBOX = [3.2, 50.5, 7.3, 53.7];
/** ISO 8601 UTC with minute precision — the only timestamp format in the data files. */
export const ISO_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

export function sha1(data) {
  return createHash('sha1').update(data).digest('hex');
}

/** Every coordinate pair of a contract geometry, flattened. */
export function coordsOf(geometry) {
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString') return geometry.coordinates;
  return geometry.coordinates.flat();
}

/** Every file in the fixture directory as a directory-relative posix path, sorted. */
export function fixtureFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(FIXTURE_DIR, full).split(sep).join(posix.sep));
    }
  };
  walk(FIXTURE_DIR);
  return out;
}

export function readFixture(rel) {
  return readFileSync(join(FIXTURE_DIR, rel), 'utf8');
}

export function readJson(rel) {
  return JSON.parse(readFixture(rel));
}

/** The whole data set in one object, as the frontend would consume it. */
export function loadFixtureData() {
  const files = fixtureFiles();
  const meta = readJson('meta.json');
  const actueel = readJson('werk-actueel.geojson');
  const gepland = readJson('werk-gepland.geojson');
  const live = readJson('live.geojson');
  return {
    files,
    meta,
    /** Base timestamp the whole fixture set is built around. */
    now: Date.parse(meta.generated),
    actueel,
    gepland,
    live,
    allFeatures: [...actueel.features, ...gepland.features, ...live.features],
    /** Everything that must be active at `now`: werk-actueel + live. */
    activeFeatures: [...actueel.features, ...live.features],
    indexAll: readJson('index/all.json'),
    provFiles: files.filter((f) => f.startsWith('index/prov/')),
    detailFiles: files.filter((f) => f.startsWith('detail/')),
    bruggen: readJson('bruggen.json'),
    manifest: readJson('manifest.json'),
  };
}

/** id → ItemDetail plus the shard number the entry was found in. */
export function loadDetails(detailFiles) {
  const details = new Map();
  for (const file of detailFiles) {
    const shard = Number(file.slice('detail/'.length, -'.json'.length));
    for (const [id, detail] of Object.entries(readJson(file))) details.set(id, { shard, detail });
  }
  return details;
}
