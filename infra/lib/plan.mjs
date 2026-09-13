/**
 * Pure helpers for the R2 uploader: manifest validation, per-file HTTP headers and
 * the changed/unchanged/removed diff between two manifests.
 *
 * Cache TTLs follow docs/build-contracts.md ("Data files"):
 *   meta.json, live.geojson  → 60 s   (files/incidents refresh every run)
 *   bruggen.json             → 120 s
 *   everything else          → 300 s  (werk-*.geojson, index/**, detail/**)
 * manifest.json is only read by this uploader (through the S3 API, never via the CDN),
 * so its TTL does not matter; it gets the short one.
 */

export const MANIFEST_FILE = 'manifest.json';

export const CACHE_CONTROL = Object.freeze({
  live: 'public, max-age=60',
  bridges: 'public, max-age=120',
  standard: 'public, max-age=300',
});

const LIVE_FILES = new Set(['meta.json', 'live.geojson', MANIFEST_FILE]);
const BRIDGE_FILES = new Set(['bruggen.json']);
const SHA1_HEX = /^[0-9a-f]{40}$/;

/** Content types. Cloudflare compresses both on the fly (verified 2026-09-08, see infra/README.md). */
const CONTENT_TYPES = Object.freeze({
  '.geojson': 'application/geo+json',
  '.json': 'application/json',
});

/** @param {string} relPath */
export function contentTypeFor(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** @param {string} relPath */
export function cacheControlFor(relPath) {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1);
  if (LIVE_FILES.has(base)) return CACHE_CONTROL.live;
  if (BRIDGE_FILES.has(base)) return CACHE_CONTROL.bridges;
  return CACHE_CONTROL.standard;
}

/**
 * Validates the shape `Record<relativePath, sha1hex>` and returns a shallow copy with
 * the keys sorted. Throws an Error with a human-readable message otherwise.
 * @param {unknown} value
 * @param {string} [label] used in error messages
 * @returns {Record<string, string>}
 */
export function validateManifest(value, label = MANIFEST_FILE) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected a JSON object mapping file paths to sha1 hashes`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) throw new Error(`${label}: manifest is empty`);
  for (const [path, sha] of entries) {
    assertSafeRelativePath(path, label);
    if (typeof sha !== 'string' || !SHA1_HEX.test(sha)) {
      throw new Error(`${label}: "${path}" has no valid sha1 hex value (got ${JSON.stringify(sha)})`);
    }
  }
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * @param {string} path
 * @param {string} label
 */
function assertSafeRelativePath(path, label) {
  const isBad =
    typeof path !== 'string' ||
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
  if (isBad) throw new Error(`${label}: unsafe or malformed path ${JSON.stringify(path)}`);
}

/**
 * The entity files (`roads/<slug>.json`, `gemeenten/<slug>.json`) are the planning-derived
 * pages; the uploader defers them to the runs in which the planning feed actually changed.
 */
export const ENTITY_PREFIXES = Object.freeze(['roads/', 'gemeenten/']);

/**
 * Diff two validated manifests.
 * `changed` never contains manifest.json — the caller uploads it last, and only when
 * `manifestChanged` is true.
 *
 * `skipPrefixes`: a changed file under one of these prefixes is **deferred** — not uploaded
 * this run — provided R2 already holds a version of it (it is in `prev`). A file R2 does not
 * have yet is uploaded regardless, so a page never points at a missing file. `manifest` is
 * the manifest to publish: `next`, with the previous hash kept for every deferred file, so it
 * always describes what is really in R2 and the next non-deferring run uploads exactly those.
 *
 * @param {Record<string, string>} next  the freshly generated manifest
 * @param {Record<string, string>} prev  what is currently in R2 (or {} on first deploy)
 * @param {readonly string[]} [skipPrefixes]
 */
export function planUploads(next, prev, skipPrefixes = []) {
  const changed = [];
  const unchanged = [];
  const deferred = [];
  /** @type {Record<string, string>} */
  const manifest = {};
  for (const [path, sha] of Object.entries(next)) {
    if (path === MANIFEST_FILE) continue;
    if (prev[path] === sha) {
      unchanged.push(path);
      manifest[path] = sha;
    } else if (path in prev && skipPrefixes.some((prefix) => path.startsWith(prefix))) {
      deferred.push(path);
      manifest[path] = prev[path]; // R2 keeps its current version until a later run
    } else {
      changed.push(path);
      manifest[path] = sha;
    }
  }
  const removed = Object.keys(prev).filter((p) => p !== MANIFEST_FILE && !(p in next));
  const manifestChanged = JSON.stringify(sortEntries(manifest)) !== JSON.stringify(sortEntries(withoutManifest(prev)));
  return { changed, unchanged, deferred, removed, manifest, manifestChanged };
}

/**
 * Comma-separated `--skip-prefix` value → trimmed, non-empty prefixes.
 * @param {string | undefined} value
 */
export function parsePrefixes(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** @param {Record<string, string>} obj */
function withoutManifest(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([path]) => path !== MANIFEST_FILE));
}

/** @param {Record<string, string>} obj */
function sortEntries(obj) {
  return Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Human-readable byte count for logs. @param {number} n */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
