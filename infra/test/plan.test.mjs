import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_CONTROL,
  cacheControlFor,
  contentTypeFor,
  formatBytes,
  planUploads,
  validateManifest,
} from '../lib/plan.mjs';

const SHA = (c) => c.repeat(40);

test('contentTypeFor maps .geojson and .json, falls back to octet-stream', () => {
  assert.equal(contentTypeFor('werk-actueel.geojson'), 'application/geo+json');
  assert.equal(contentTypeFor('index/prov/PV20.json'), 'application/json');
  assert.equal(contentTypeFor('detail/00.JSON'), 'application/json');
  assert.equal(contentTypeFor('readme.txt'), 'application/octet-stream');
});

test('cacheControlFor follows the contract TTLs per file class', () => {
  assert.equal(cacheControlFor('meta.json'), CACHE_CONTROL.live);
  assert.equal(cacheControlFor('live.geojson'), CACHE_CONTROL.live);
  assert.equal(cacheControlFor('manifest.json'), CACHE_CONTROL.live);
  assert.equal(cacheControlFor('bruggen.json'), CACHE_CONTROL.bridges);
  assert.equal(cacheControlFor('werk-actueel.geojson'), CACHE_CONTROL.standard);
  assert.equal(cacheControlFor('werk-gepland.geojson'), CACHE_CONTROL.standard);
  assert.equal(cacheControlFor('index/all.json'), CACHE_CONTROL.standard);
  assert.equal(cacheControlFor('index/prov/PV20.json'), CACHE_CONTROL.standard);
  assert.equal(cacheControlFor('detail/31.json'), CACHE_CONTROL.standard);
  assert.equal(CACHE_CONTROL.live, 'public, max-age=60');
  assert.equal(CACHE_CONTROL.bridges, 'public, max-age=120');
  assert.equal(CACHE_CONTROL.standard, 'public, max-age=300');
});

test('validateManifest accepts a path→sha1 map and returns sorted keys', () => {
  const result = validateManifest({ 'meta.json': SHA('b'), 'detail/00.json': SHA('a') });
  assert.deepEqual(Object.keys(result), ['detail/00.json', 'meta.json']);
});

test('validateManifest rejects non-objects, empty maps, bad hashes and unsafe paths', () => {
  assert.throws(() => validateManifest([]), /expected a JSON object/);
  assert.throws(() => validateManifest(null), /expected a JSON object/);
  assert.throws(() => validateManifest({}), /manifest is empty/);
  assert.throws(() => validateManifest({ 'meta.json': 'nothex' }), /no valid sha1/);
  assert.throws(() => validateManifest({ 'meta.json': SHA('A') }), /no valid sha1/);
  assert.throws(() => validateManifest({ '/abs.json': SHA('a') }), /unsafe or malformed path/);
  assert.throws(() => validateManifest({ '../up.json': SHA('a') }), /unsafe or malformed path/);
  assert.throws(() => validateManifest({ 'a//b.json': SHA('a') }), /unsafe or malformed path/);
  assert.throws(() => validateManifest({ 'a\\b.json': SHA('a') }), /unsafe or malformed path/);
});

test('planUploads separates changed, unchanged and removed and excludes manifest.json from changed', () => {
  // Arrange
  const prev = { 'meta.json': SHA('1'), 'live.geojson': SHA('2'), 'old.json': SHA('3'), 'manifest.json': SHA('9') };
  const next = { 'meta.json': SHA('a'), 'live.geojson': SHA('2'), 'new.json': SHA('4'), 'manifest.json': SHA('8') };

  // Act
  const plan = planUploads(next, prev);

  // Assert
  assert.deepEqual(plan.changed, ['meta.json', 'new.json']);
  assert.deepEqual(plan.unchanged, ['live.geojson']);
  assert.deepEqual(plan.removed, ['old.json']);
  assert.equal(plan.manifestChanged, true);
});

test('planUploads with an empty previous manifest uploads everything', () => {
  const next = { 'meta.json': SHA('a'), 'manifest.json': SHA('b') };
  const plan = planUploads(next, {});
  assert.deepEqual(plan.changed, ['meta.json']);
  assert.equal(plan.manifestChanged, true);
});

test('planUploads reports nothing to do when manifests are identical', () => {
  const m = { 'meta.json': SHA('a'), 'manifest.json': SHA('b') };
  const plan = planUploads(m, { ...m });
  assert.deepEqual(plan.changed, []);
  assert.deepEqual(plan.removed, []);
  assert.equal(plan.manifestChanged, false);
});

test('formatBytes picks a sensible unit', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.00 MB');
});
