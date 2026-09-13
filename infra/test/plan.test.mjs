import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_CONTROL,
  ENTITY_PREFIXES,
  cacheControlFor,
  contentTypeFor,
  formatBytes,
  parsePrefixes,
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

test('planUploads defers changed files under a skip prefix and keeps the previous hash for them in the manifest', () => {
  // Arrange: everything changed; R2 has a2 and utrecht, not n57.
  const prev = { 'meta.json': SHA('1'), 'roads/a2.json': SHA('2'), 'gemeenten/utrecht.json': SHA('3'), 'detail/00.json': SHA('4') };
  const next = { 'meta.json': SHA('a'), 'roads/a2.json': SHA('b'), 'roads/n57.json': SHA('c'), 'gemeenten/utrecht.json': SHA('3'), 'detail/00.json': SHA('d') };

  // Act
  const plan = planUploads(next, prev, ENTITY_PREFIXES);

  // Assert
  assert.deepEqual(plan.changed, ['meta.json', 'roads/n57.json', 'detail/00.json'], 'a new entity file is not deferred');
  assert.deepEqual(plan.deferred, ['roads/a2.json']);
  assert.deepEqual(plan.unchanged, ['gemeenten/utrecht.json']);
  assert.deepEqual(plan.manifest, {
    'meta.json': SHA('a'),
    'roads/a2.json': SHA('2'), // what R2 still holds
    'roads/n57.json': SHA('c'),
    'gemeenten/utrecht.json': SHA('3'),
    'detail/00.json': SHA('d'),
  });
  assert.equal(plan.manifestChanged, true);
  assert.deepEqual(ENTITY_PREFIXES, ['roads/', 'gemeenten/']);
});

test('planUploads without prefixes publishes the local manifest unchanged, and manifestChanged ignores a manifest.json entry', () => {
  const prev = { 'meta.json': SHA('1'), 'roads/a2.json': SHA('2'), 'manifest.json': SHA('9') };
  const next = { 'meta.json': SHA('1'), 'roads/a2.json': SHA('2') };
  const plan = planUploads(next, prev);
  assert.deepEqual(plan.deferred, []);
  assert.deepEqual(plan.manifest, next);
  assert.equal(plan.manifestChanged, false);
  // only deferred files → nothing to upload but the manifest still differs from R2? No: it is identical to R2.
  const allDeferred = planUploads({ 'meta.json': SHA('1'), 'roads/a2.json': SHA('x') }, prev, ['roads/']);
  assert.deepEqual(allDeferred.changed, []);
  assert.deepEqual(allDeferred.deferred, ['roads/a2.json']);
  assert.equal(allDeferred.manifestChanged, false, 'R2 already holds exactly this manifest');
});

test('parsePrefixes splits on commas and drops blanks', () => {
  assert.deepEqual(parsePrefixes('roads/, gemeenten/,,'), ['roads/', 'gemeenten/']);
  assert.deepEqual(parsePrefixes(undefined), []);
  assert.deepEqual(parsePrefixes(''), []);
});

test('formatBytes picks a sensible unit', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.00 MB');
});
