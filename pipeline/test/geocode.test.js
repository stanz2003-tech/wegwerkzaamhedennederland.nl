import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGeocoder, DEFAULT_GEOCODE_MAX, entryFromDoc, geocodeKey, PDOK_REVERSE_URL, prune } from '../src/geocode.js';

const DOC = {
  straatnaam: 'Asterdkraag',
  woonplaatsnaam: 'Breda',
  gemeentenaam: 'Breda',
  gemeentecode: '0758',
  provincienaam: 'Noord-Brabant',
  provinciecode: 'PV30',
};

/** A fetch stand-in that records its calls and answers with `docs`. */
function mockFetch(docs = [DOC]) {
  /** @type {{ url: string, at: number }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const impl = async (url) => {
    calls.push({ url: String(url), at: Date.now() });
    return /** @type {Response} */ ({
      ok: true,
      status: 200,
      json: async () => ({ response: { docs } }),
    });
  };
  return { impl, calls };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'wegwerk-geo-'));

test('cache key rounds to three decimals and ignores the item id', () => {
  assert.equal(geocodeKey(4.7752341, 51.5891234), '4.775,51.589');
  assert.equal(geocodeKey(4.7752341, 51.5891234), geocodeKey(4.7754999, 51.5894999));
  assert.notEqual(geocodeKey(4.775, 51.589), geocodeKey(4.776, 51.589));
  assert.equal(geocodeKey(5, 52), '5.000,52.000');
});

test('entryFromDoc maps the Locatieserver fields and drops empties', () => {
  const entry = entryFromDoc(DOC, '2026-09-10T12:00:00Z');
  assert.deepEqual(entry, {
    at: '2026-09-10T12:00:00Z',
    straat: 'Asterdkraag',
    woonplaats: 'Breda',
    gemeente: 'Breda',
    gemeenteCode: '0758',
    prov: 'Noord-Brabant',
    provCode: 'PV30',
  });
  assert.deepEqual(entryFromDoc(undefined, 'X'), { at: 'X' });
  assert.deepEqual(entryFromDoc({ straatnaam: '', woonplaatsnaam: 42 }, 'X'), { at: 'X' });
});

test('miss → one request, hit → no request', async () => {
  const { impl, calls } = mockFetch();
  const geo = createGeocoder({ fetchImpl: impl, nowMs: Date.parse('2026-09-10T12:00:00Z') });
  const first = await geo.lookup(4.7752, 51.5891);
  assert.equal(first?.woonplaats, 'Breda');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(PDOK_REVERSE_URL + '?'));
  assert.ok(calls[0].url.includes('lat=51.589100'));
  assert.ok(calls[0].url.includes('lon=4.775200'));
  assert.ok(calls[0].url.includes('type=weg'));
  assert.ok(calls[0].url.includes('rows=1'));

  // same cell (within the rounding) → cache hit, no second request
  const second = await geo.lookup(4.77549, 51.58949);
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);
  assert.equal(geo.stats.hits, 1);
  assert.equal(geo.stats.fetched, 1);
  assert.equal(geo.size(), 1);
  // cached() never fetches
  assert.equal(geo.cached(4.7752, 51.5891)?.gemeente, 'Breda');
  assert.equal(geo.cached(9.9, 49.9), undefined);
  assert.equal(calls.length, 1);
});

test('requests are paced and run sequentially', async () => {
  const { impl, calls } = mockFetch();
  const geo = createGeocoder({ fetchImpl: impl, spacingMs: 40 });
  await Promise.all([geo.lookup(4.1, 52.1), geo.lookup(4.2, 52.2), geo.lookup(4.3, 52.3)]);
  await geo.flush();
  assert.equal(calls.length, 3);
  assert.ok(calls[1].at - calls[0].at >= 35, `gap ${calls[1].at - calls[0].at} ms`);
  assert.ok(calls[2].at - calls[1].at >= 35, `gap ${calls[2].at - calls[1].at} ms`);
});

test('the per-run cap stops new lookups and counts them as pending', async () => {
  const { impl, calls } = mockFetch();
  const geo = createGeocoder({ fetchImpl: impl, spacingMs: 0, maxNew: 2 });
  const results = [];
  for (const lon of [4.1, 4.2, 4.3, 4.4]) results.push(await geo.lookup(lon, 52));
  await geo.flush();
  assert.equal(calls.length, 2);
  assert.equal(geo.stats.fetched, 2);
  assert.equal(geo.stats.pending, 2);
  assert.deepEqual(results.map((r) => r !== undefined), [true, true, false, false]);
});

test('--no-geocode serves the cache only', async () => {
  const dir = tmp();
  const path = join(dir, 'geocode.json');
  writeFileSync(path, JSON.stringify({ '4.775,51.589': { at: '2026-09-10T12:00:00Z', woonplaats: 'Breda' } }));
  const { impl, calls } = mockFetch();
  const geo = createGeocoder({ cachePath: path, fetchImpl: impl, enabled: false });
  assert.equal((await geo.lookup(4.7752, 51.5891))?.woonplaats, 'Breda');
  assert.equal(await geo.lookup(5.9, 52.9), undefined);
  assert.equal(calls.length, 0);
  assert.equal(geo.stats.pending, 1);
});

test('errors never throw: HTTP failure, network failure, invalid JSON', async () => {
  /** @type {string[]} */
  const warnings = [];
  const log = { warn: (/** @type {string} */ m) => warnings.push(m), debug: () => {} };
  /** @type {typeof fetch} */
  const failing = async (url) => {
    if (String(url).includes('lat=52.100000')) return /** @type {Response} */ ({ ok: false, status: 503, json: async () => ({}) });
    if (String(url).includes('lat=52.200000')) throw new Error('ECONNRESET');
    return /** @type {Response} */ ({ ok: true, status: 200, json: async () => {
      throw new Error('invalid json');
    } });
  };
  const geo = createGeocoder({ fetchImpl: failing, spacingMs: 0, log });
  assert.equal(await geo.lookup(4.1, 52.1), undefined);
  assert.equal(await geo.lookup(4.2, 52.2), undefined);
  assert.equal(await geo.lookup(4.3, 52.3), undefined);
  assert.equal(geo.stats.failed, 3);
  assert.equal(geo.stats.fetched, 0);
  assert.equal(warnings.length, 3);
});

test('five consecutive failures stop the geocoder for the rest of the run', async () => {
  let calls = 0;
  /** @type {typeof fetch} */
  const failing = async () => {
    calls++;
    throw new Error('down');
  };
  const geo = createGeocoder({ fetchImpl: failing, spacingMs: 0, maxNew: 50 });
  for (let i = 0; i < 10; i++) await geo.lookup(4 + i / 100, 52);
  assert.equal(calls, 5);
  assert.equal(geo.stats.failed, 5);
  assert.equal(geo.stats.pending, 5);
});

test('an unreadable cache file starts empty instead of throwing', () => {
  const dir = tmp();
  const path = join(dir, 'geocode.json');
  writeFileSync(path, '{ this is not json');
  /** @type {string[]} */
  const warnings = [];
  const geo = createGeocoder({ cachePath: path, log: { warn: (m) => warnings.push(m), debug: () => {} } });
  assert.equal(geo.size(), 0);
  assert.equal(warnings.length, 1);
});

test('save() writes one line per entry, sorted, and prunes unused stale entries', async () => {
  const dir = tmp();
  const path = join(dir, 'sub', 'geocode.json');
  const nowMs = Date.parse('2026-09-10T12:00:00Z');
  const old = new Date(nowMs - 100 * 24 * 3600 * 1000).toISOString();
  const recent = new Date(nowMs - 24 * 3600 * 1000).toISOString();
  const geo = createGeocoder({ cachePath: path, fetchImpl: mockFetch().impl, nowMs, spacingMs: 0 });
  await geo.lookup(4.775, 51.589);
  await geo.flush();
  geo.save();
  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(written), ['4.775,51.589']);
  assert.equal(readFileSync(path, 'utf8').split('\n').length, 4); // {, entry, }, trailing newline

  const cache = {
    'a': { at: old },
    'b': { at: recent },
    'c': { at: old, live: 1 },
    'd': { at: recent, live: 1 },
    'e': { at: 'rommel' },
  };
  const kept = prune(cache, new Set(['e']), nowMs);
  assert.deepEqual(Object.keys(kept).sort(), ['b', 'd', 'e']);
});

test('a cell first fetched for a live item becomes long-lived when a planning item reuses it', async () => {
  const geo = createGeocoder({ fetchImpl: mockFetch().impl, spacingMs: 0, nowMs: Date.parse('2026-09-10T12:00:00Z') });
  const live = await geo.lookup(4.775, 51.589, { live: true });
  assert.equal(live?.live, 1);
  const planning = await geo.lookup(4.775, 51.589);
  assert.equal(planning?.live, undefined);
});

test('the default cap is documented and non-zero', () => {
  assert.equal(DEFAULT_GEOCODE_MAX, 400);
});
