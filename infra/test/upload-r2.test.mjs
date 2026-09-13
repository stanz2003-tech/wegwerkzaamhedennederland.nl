/**
 * End-to-end tests for the uploader's orchestration: which files are uploaded, in which
 * order, with which headers, what happens on failures, and the retry/concurrency
 * behaviour — all against a fake `fetch`, so no network and no credentials are involved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { run } from '../upload-r2.mjs';

const ENV = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  R2_BUCKET: 'wegwerk-data',
};

/** The file classes the pipeline produces, one small file each. */
const OUTPUT = {
  'meta.json': '{"generated":"2026-09-08T17:34:20Z"}',
  'live.geojson': '{"type":"FeatureCollection","features":[]}',
  'werk-actueel.geojson': '{"type":"FeatureCollection","features":[1]}',
  'bruggen.json': '{"bridges":[]}',
  'index/all.json': '[[1]]',
  'detail/00.json': '{"a":1}',
};

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

/** Writes an output directory plus its manifest.json and returns the paths. */
async function makeOut(files = OUTPUT) {
  const outDir = await mkdtemp(join(tmpdir(), 'wegwerk-out-'));
  const cacheDir = await mkdtemp(join(tmpdir(), 'wegwerk-cache-'));
  const manifest = {};
  for (const [path, body] of Object.entries(files)) {
    const full = join(outDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    manifest[path] = sha1(body);
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest));
  return { outDir, cacheDir, manifest };
}

/**
 * Fake fetch. `getBody` decides what GET <prefix>/manifest.json answers; `putStatus(key, n)`
 * decides the status of the n-th PUT of that key (default 200). Records every call and
 * tracks how many requests are in flight at the same time.
 */
function fakeFetch({ getBody = null, putStatus = () => 200, delayMs = 0 } = {}) {
  const calls = [];
  const putCounts = new Map();
  let inFlight = 0;
  let maxInFlight = 0;
  const impl = async (url, init) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const key = String(url).split('/wegwerk-data/')[1];
      calls.push({ method: init.method, key, headers: init.headers, body: init.body });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      if (init.method === 'GET') {
        return getBody === null ? new Response(null, { status: 404 }) : new Response(getBody, { status: 200 });
      }
      const n = (putCounts.get(key) ?? 0) + 1;
      putCounts.set(key, n);
      const status = putStatus(key, n);
      return new Response(status === 200 ? null : 'error body', { status });
    } finally {
      inFlight--;
    }
  };
  return { impl, calls, puts: () => calls.filter((c) => c.method === 'PUT').map((c) => c.key), maxInFlight: () => maxInFlight };
}

const silent = { out: () => {}, err: () => {} };

/** Collects the stdout summary line(s). */
function capture() {
  const lines = [];
  return { log: { out: (m) => lines.push(m), err: () => {} }, lines };
}

test('first publish uploads every file and manifest.json last, then caches the manifest', async () => {
  // Arrange
  const { outDir, cacheDir, manifest } = await makeOut();
  const f = fakeFetch();
  const { log, lines } = capture();

  // Act
  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });

  // Assert
  assert.equal(code, 0);
  const puts = f.puts();
  assert.equal(puts.length, Object.keys(OUTPUT).length + 1, 'every file plus the manifest');
  assert.equal(puts.at(-1), 'v1/manifest.json', 'manifest.json must be uploaded last');
  assert.equal(puts.filter((k) => k === 'v1/manifest.json').length, 1);
  assert.deepEqual([...puts.slice(0, -1)].sort(), Object.keys(manifest).map((p) => `v1/${p}`).sort());
  assert.match(lines.at(-1), /^upload ok uploaded=7 skipped=0 deferred=0 removed=0 bytes=\d+ prev=none ms=\d+$/);
  const cached = JSON.parse(await readFile(join(cacheDir, 'last', 'manifest.json'), 'utf8'));
  assert.deepEqual(cached, manifest);
});

test('every uploaded file carries the Content-Type and Cache-Control for its class', async () => {
  const { outDir, cacheDir } = await makeOut();
  const f = fakeFetch();
  await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log: silent });

  const headersOf = (key) => f.calls.find((c) => c.method === 'PUT' && c.key === `v1/${key}`).headers;
  const seen = (key) => [headersOf(key)['Content-Type'], headersOf(key)['Cache-Control']];
  assert.deepEqual(seen('meta.json'), ['application/json', 'public, max-age=60']);
  assert.deepEqual(seen('live.geojson'), ['application/geo+json', 'public, max-age=60']);
  assert.deepEqual(seen('werk-actueel.geojson'), ['application/geo+json', 'public, max-age=300']);
  assert.deepEqual(seen('bruggen.json'), ['application/json', 'public, max-age=120']);
  assert.deepEqual(seen('index/all.json'), ['application/json', 'public, max-age=300']);
  assert.deepEqual(seen('detail/00.json'), ['application/json', 'public, max-age=300']);
  assert.deepEqual(seen('manifest.json'), ['application/json', 'public, max-age=60']);
  // Every PUT is signed, and the payload hash is real (never UNSIGNED-PAYLOAD).
  for (const call of f.calls.filter((c) => c.method === 'PUT')) {
    assert.match(call.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    assert.equal(call.headers['x-amz-content-sha256'].length, 64);
  }
});

test('unchanged files are skipped: only the changed one and the manifest are uploaded', async () => {
  // Arrange: R2 already holds the previous manifest, with one differing hash.
  const { outDir, cacheDir, manifest } = await makeOut();
  const previous = { ...manifest, 'meta.json': sha1('something older'), 'gone.json': sha1('x') };
  const f = fakeFetch({ getBody: JSON.stringify(previous) });
  const { log, lines } = capture();

  // Act
  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });

  // Assert
  assert.equal(code, 0);
  assert.deepEqual(f.puts(), ['v1/meta.json', 'v1/manifest.json']);
  assert.match(lines.at(-1), /^upload ok uploaded=2 skipped=5 deferred=0 removed=1 bytes=\d+ prev=r2 /);
  assert.equal(f.calls[0].method, 'GET', 'the previous manifest is read from R2 first');
  assert.equal(f.calls[0].key, 'v1/manifest.json');
});

test('an identical previous manifest uploads nothing at all', async () => {
  const { outDir, cacheDir, manifest } = await makeOut();
  const f = fakeFetch({ getBody: JSON.stringify(manifest) });
  const { log, lines } = capture();

  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });

  assert.equal(code, 0);
  assert.deepEqual(f.puts(), []);
  assert.match(lines.at(-1), /^upload ok uploaded=0 skipped=6 deferred=0 removed=0 bytes=0 prev=r2 /);
});

test('a failed upload exits 1 and never updates manifest.json', async () => {
  const { outDir, cacheDir } = await makeOut();
  // 403 is not retryable, so this fails on the first attempt.
  const f = fakeFetch({ putStatus: (key) => (key === 'v1/detail/00.json' ? 403 : 200) });
  const { log, lines } = capture();

  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });

  assert.equal(code, 1);
  assert.ok(!f.puts().includes('v1/manifest.json'), 'manifest.json must not be uploaded after a failure');
  assert.match(lines.at(-1), /^upload failed uploaded=5 failed=1 skipped=0 deferred=0 removed=0 bytes=\d+ /);
  await assert.rejects(readFile(join(cacheDir, 'last', 'manifest.json')), { code: 'ENOENT' });
});

test('a 503 is retried and the upload still succeeds', async () => {
  const { outDir, cacheDir } = await makeOut({ 'meta.json': OUTPUT['meta.json'] });
  const f = fakeFetch({ putStatus: (key, n) => (key === 'v1/meta.json' && n === 1 ? 503 : 200) });
  const { log, lines } = capture();

  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });

  assert.equal(code, 0);
  assert.deepEqual(f.puts(), ['v1/meta.json', 'v1/meta.json', 'v1/manifest.json']);
  assert.match(lines.at(-1), /^upload ok uploaded=2 /);
});

test('--concurrency bounds the number of parallel uploads', async () => {
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`detail/${String(i).padStart(2, '0')}.json`, `{"i":${i}}`]));
  const { outDir, cacheDir } = await makeOut(many);
  const f = fakeFetch({ delayMs: 5 });

  const code = await run(['--out', outDir, '--cache', cacheDir, '--concurrency', '3'], ENV, { fetchImpl: f.impl, log: silent });

  assert.equal(code, 0);
  assert.equal(f.puts().length, 13);
  assert.ok(f.maxInFlight() <= 3, `max in flight was ${f.maxInFlight()}, expected <= 3`);
  assert.ok(f.maxInFlight() > 1, 'uploads should actually run in parallel');
});

test('when R2 cannot be reached the local cached manifest is used instead', async () => {
  const { outDir, cacheDir, manifest } = await makeOut();
  await mkdir(join(cacheDir, 'last'), { recursive: true });
  await writeFile(join(cacheDir, 'last', 'manifest.json'), JSON.stringify({ ...manifest, 'meta.json': sha1('older') }));
  let getCalls = 0;
  const inner = fakeFetch();
  const impl = async (url, init) => {
    if (init.method === 'GET') {
      getCalls++;
      throw new TypeError('fetch failed');
    }
    return inner.impl(url, init);
  };
  const { log, lines } = capture();

  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: impl, log });

  assert.equal(code, 0);
  assert.equal(getCalls, 3, 'the manifest read is retried three times before falling back');
  assert.deepEqual(inner.puts(), ['v1/meta.json', 'v1/manifest.json']);
  assert.match(lines.at(-1), /prev=local /);
});

test('--dry-run prints the plan, uploads nothing and touches no network', async () => {
  const { outDir, cacheDir } = await makeOut();
  const f = fakeFetch();
  const lines = [];
  const errs = [];

  const code = await run(['--out', outDir, '--cache', cacheDir, '--dry-run'], {}, {
    fetchImpl: f.impl,
    log: { out: (m) => lines.push(m), err: (m) => errs.push(m) },
  });

  assert.equal(code, 0);
  assert.equal(f.calls.length, 0, 'a dry run must not make any request');
  assert.equal(lines.at(-1), 'upload dry-run to-upload=6 unchanged=0 deferred=0 removed=0 prev=none');
  assert.ok(errs.some((l) => /PUT\s+v1\/manifest\.json\s+\(uploaded last\)/.test(l)));
  assert.ok(errs.some((l) => /public, max-age=60/.test(l)));
});

test('missing environment variables fail with a clear message and exit code 2', async () => {
  const { outDir, cacheDir } = await makeOut();
  await assert.rejects(
    run(['--out', outDir, '--cache', cacheDir], { R2_BUCKET: 'wegwerk-data' }, { log: silent }),
    (err) => {
      assert.equal(err.exitCode, 2);
      assert.match(err.message, /Missing environment variable\(s\): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY\./);
      assert.match(err.message, /GitHub Actions secrets/);
      return true;
    },
  );
});

test('usage and manifest problems exit 2 with an explanatory message', async () => {
  const { outDir, cacheDir } = await makeOut();
  const cases = [
    [['--cache', cacheDir], /--out <dir> is required/],
    [['--out', outDir, '--prev', 'sometimes'], /--prev must be one of auto, r2, local, none/],
    [['--out', outDir, '--concurrency', '0'], /--concurrency must be an integer between 1 and 32/],
    [['--out', outDir, '--nope'], /Unknown option/],
    [[`--out`, join(outDir, 'nowhere'), '--cache', cacheDir], /manifest\.json not found/],
  ];
  for (const [argv, expected] of cases) {
    await assert.rejects(run(argv, ENV, { log: silent }), (err) => {
      assert.equal(err.exitCode, 2, `${argv.join(' ')} should exit 2`);
      assert.match(err.message, expected);
      return true;
    });
  }
});

test('a manifest entry without its file exits 2 instead of publishing a partial set', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'wegwerk-out-'));
  await writeFile(join(outDir, 'meta.json'), '{}');
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify({ 'meta.json': sha1('{}'), 'live.geojson': sha1('x') }));

  await assert.rejects(run(['--out', outDir], ENV, { log: silent }), (err) => {
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /manifest lists 1 file\(s\) that do not exist/);
    return true;
  });
});

test('a sha1 that disagrees with the file content warns but still uploads', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'wegwerk-out-'));
  const cacheDir = await mkdtemp(join(tmpdir(), 'wegwerk-cache-'));
  await writeFile(join(outDir, 'meta.json'), '{"generated":"now"}');
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify({ 'meta.json': sha1('stale') }));
  const f = fakeFetch();
  const errs = [];

  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, {
    fetchImpl: f.impl,
    log: { out: () => {}, err: (m) => errs.push(m) },
  });

  assert.equal(code, 0);
  assert.ok(errs.some((l) => l.includes('meta.json content sha1 differs from manifest.json entry')));
  assert.deepEqual(f.puts(), ['v1/meta.json', 'v1/manifest.json']);
});

test('--prefix and R2_PREFIX change the key prefix; --prev none skips the R2 read', async () => {
  const { outDir, cacheDir } = await makeOut({ 'meta.json': '{}' });
  const f = fakeFetch();
  await run(['--out', outDir, '--cache', cacheDir, '--prefix', '/v2/', '--prev', 'none'], ENV, { fetchImpl: f.impl, log: silent });
  assert.deepEqual(f.puts(), ['v2/meta.json', 'v2/manifest.json']);
  assert.ok(!f.calls.some((c) => c.method === 'GET'), '--prev none must not read the previous manifest');

  const g = fakeFetch();
  await run(['--out', outDir, '--cache', cacheDir, '--prev', 'none'], { ...ENV, R2_PREFIX: 'data' }, { fetchImpl: g.impl, log: silent });
  assert.deepEqual(g.puts(), ['data/meta.json', 'data/manifest.json']);
});

test('an empty R2_PREFIX falls back to v1 and whitespace around secrets is trimmed', async () => {
  // `${{ secrets.R2_PREFIX }}` yields "" for an unset secret, and pasted keys often end in a newline;
  // run #2 in production uploaded to "<bucket>//" with an invalid Authorization header because of this.
  const { outDir, cacheDir } = await makeOut({ 'meta.json': '{}' });
  const f = fakeFetch();
  const messy = {
    ...ENV,
    R2_PREFIX: '',
    R2_ACCESS_KEY_ID: `${ENV.R2_ACCESS_KEY_ID}\n`,
    R2_SECRET_ACCESS_KEY: ` ${ENV.R2_SECRET_ACCESS_KEY} `,
    R2_BUCKET: `${ENV.R2_BUCKET}\r\n`,
  };
  const code = await run(['--out', outDir, '--cache', cacheDir, '--prev', 'none'], messy, { fetchImpl: f.impl, log: silent });
  assert.equal(code, 0);
  assert.deepEqual(f.puts(), ['v1/meta.json', 'v1/manifest.json']);
  for (const c of f.calls) {
    const auth = c.headers instanceof Headers ? c.headers.get('authorization') : (c.headers.authorization ?? c.headers.Authorization);
    assert.ok(auth && !/[\r\n]/.test(auth) && auth.includes(`Credential=${ENV.R2_ACCESS_KEY_ID}/`), 'access key must be trimmed');
  }
});

/** Output with entity files next to the core files, plus a meta.json with the planning flag. */
const ENTITY_OUTPUT = {
  ...OUTPUT,
  'roads/a2.json': '{"kind":"road","key":"A2","items":[1]}',
  'roads/n57.json': '{"kind":"road","key":"N57","items":[2]}',
  'gemeenten/utrecht.json': '{"kind":"gemeente","key":"Utrecht","items":[3]}',
};

/** A meta.json whose planning source was (or was not) replayed from cache. */
const metaWithPlanning = (reused) =>
  JSON.stringify({ generated: '2026-09-13T14:55:42Z', version: '3', sources: { planning: { ok: true, situations: 16750, ...(reused === undefined ? {} : { reused }) } } });

/**
 * Previous manifest in which every file differs from the new output — the situation on a
 * normal run, where the actueel feed moved on and every hash changed.
 */
const allOlder = (manifest) => Object.fromEntries(Object.keys(manifest).map((p) => [p, sha1(`older ${p}`)]));

test('planning feed unchanged (meta.json reused=true): entity files are deferred and keep their R2 hash in the manifest', async () => {
  // Arrange
  const { outDir, cacheDir, manifest } = await makeOut({ ...ENTITY_OUTPUT, 'meta.json': metaWithPlanning(true) });
  const previous = allOlder(manifest);
  const f = fakeFetch({ getBody: JSON.stringify(previous) });
  const { log, lines } = capture();

  // Act
  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });

  // Assert
  assert.equal(code, 0);
  const puts = f.puts();
  assert.ok(!puts.some((k) => k.startsWith('v1/roads/') || k.startsWith('v1/gemeenten/')), `no entity file may be uploaded, got ${puts}`);
  assert.equal(puts.length, Object.keys(OUTPUT).length + 1, 'the core files and the manifest');
  assert.equal(puts.at(-1), 'v1/manifest.json');
  assert.match(lines.at(-1), /^upload ok uploaded=7 skipped=0 deferred=3 removed=0 bytes=\d+ prev=r2 /);
  // The uploaded manifest describes R2: new hashes for what was uploaded, the previous hash for what was deferred.
  const uploaded = JSON.parse(f.calls.find((c) => c.method === 'PUT' && c.key === 'v1/manifest.json').body.toString());
  for (const path of Object.keys(OUTPUT)) assert.equal(uploaded[path], manifest[path], path);
  for (const path of ['roads/a2.json', 'roads/n57.json', 'gemeenten/utrecht.json']) assert.equal(uploaded[path], previous[path], `${path} keeps the R2 hash`);
  assert.deepEqual(JSON.parse(await readFile(join(cacheDir, 'last', 'manifest.json'), 'utf8')), uploaded, 'the local copy is the same merged manifest');
});

test('the next run in which the planning feed changed uploads exactly the deferred files', async () => {
  // Arrange: R2 holds the merged manifest of the previous (deferring) run.
  const { outDir, cacheDir, manifest } = await makeOut({ ...ENTITY_OUTPUT, 'meta.json': metaWithPlanning(false) });
  const previous = { ...manifest, 'roads/a2.json': sha1('older'), 'gemeenten/utrecht.json': sha1('older'), 'meta.json': sha1('older meta') };
  const f = fakeFetch({ getBody: JSON.stringify(previous) });
  const { log, lines } = capture();

  // Act
  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });

  // Assert
  assert.equal(code, 0);
  assert.deepEqual(f.puts().sort(), ['v1/gemeenten/utrecht.json', 'v1/manifest.json', 'v1/meta.json', 'v1/roads/a2.json']);
  assert.match(lines.at(-1), /^upload ok uploaded=4 skipped=6 deferred=0 removed=0 /);
});

test('no deferral when meta.json says reused=false, lacks the flag, or is missing', async () => {
  for (const meta of [metaWithPlanning(false), metaWithPlanning(undefined), '{"generated":"x"}']) {
    const { outDir, cacheDir, manifest } = await makeOut({ ...ENTITY_OUTPUT, 'meta.json': meta });
    const f = fakeFetch({ getBody: JSON.stringify(allOlder(manifest)) });
    const { log, lines } = capture();

    const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });

    assert.equal(code, 0);
    assert.equal(f.puts().filter((k) => k.startsWith('v1/roads/') || k.startsWith('v1/gemeenten/')).length, 3, meta);
    assert.match(lines.at(-1), /deferred=0 /);
  }
  // meta.json absent from the output altogether (it is always in the manifest, so drop it there too)
  const { outDir, cacheDir, manifest } = await makeOut(Object.fromEntries(Object.entries(ENTITY_OUTPUT).filter(([p]) => p !== 'meta.json')));
  const f = fakeFetch({ getBody: JSON.stringify(allOlder(manifest)) });
  const { log, lines } = capture();
  const code = await run(['--out', outDir, '--cache', cacheDir], ENV, { fetchImpl: f.impl, log });
  assert.equal(code, 0);
  assert.match(lines.at(-1), /deferred=0 /);
});

test('--no-entities-when-planning-changed uploads the entity files even on a reused planning feed', async () => {
  const { outDir, cacheDir, manifest } = await makeOut({ ...ENTITY_OUTPUT, 'meta.json': metaWithPlanning(true) });
  const f = fakeFetch({ getBody: JSON.stringify(allOlder(manifest)) });
  const { log, lines } = capture();

  const code = await run(['--out', outDir, '--cache', cacheDir, '--no-entities-when-planning-changed'], ENV, { fetchImpl: f.impl, log });

  assert.equal(code, 0);
  assert.equal(f.puts().length, Object.keys(ENTITY_OUTPUT).length + 1);
  assert.match(lines.at(-1), /deferred=0 /);
});

test('--skip-prefix defers changed files under the prefixes unconditionally, but never a file R2 does not have', async () => {
  // Arrange: detail/00.json is in R2 (older), roads/a2.json is not in R2 at all.
  const { outDir, cacheDir, manifest } = await makeOut({ ...ENTITY_OUTPUT, 'meta.json': metaWithPlanning(false) });
  const previous = allOlder(manifest);
  delete previous['roads/a2.json'];
  const f = fakeFetch({ getBody: JSON.stringify(previous) });
  const { log, lines } = capture();

  // Act
  const code = await run(['--out', outDir, '--cache', cacheDir, '--skip-prefix', 'detail/, roads/'], ENV, { fetchImpl: f.impl, log });

  // Assert
  assert.equal(code, 0);
  const puts = f.puts();
  assert.ok(!puts.includes('v1/detail/00.json'), 'detail/ is deferred');
  assert.ok(!puts.includes('v1/roads/n57.json'), 'roads/n57.json is in R2 and deferred');
  assert.ok(puts.includes('v1/roads/a2.json'), 'a file R2 does not have yet is uploaded regardless');
  assert.ok(puts.includes('v1/gemeenten/utrecht.json'), 'gemeenten/ was not named');
  assert.match(lines.at(-1), /^upload ok uploaded=8 skipped=0 deferred=2 removed=0 /, 'seven files plus the manifest');
});

test('--dry-run names the deferred count and lists deferred files in the plan', async () => {
  const { outDir, cacheDir, manifest } = await makeOut({ ...ENTITY_OUTPUT, 'meta.json': metaWithPlanning(true) });
  await mkdir(join(cacheDir, 'last'), { recursive: true });
  await writeFile(join(cacheDir, 'last', 'manifest.json'), JSON.stringify(allOlder(manifest)));
  const lines = [];
  const errs = [];

  const code = await run(['--out', outDir, '--cache', cacheDir, '--dry-run'], {}, { log: { out: (m) => lines.push(m), err: (m) => errs.push(m) } });

  assert.equal(code, 0);
  assert.equal(lines.at(-1), 'upload dry-run to-upload=6 unchanged=0 deferred=3 removed=0 prev=local');
  assert.ok(errs.some((l) => /planning feed unchanged this run/.test(l)), 'explains why');
  assert.equal(errs.filter((l) => /^\s+defer v1\/(roads|gemeenten)\//.test(l)).length, 3);
  assert.ok(errs.some((l) => /Summary: 6 to upload .* 0 unchanged, 3 deferred, 0 orphaned/.test(l)));
});

test('R2_JURISDICTION selects the jurisdiction-specific endpoint', async () => {
  const { outDir, cacheDir } = await makeOut({ 'meta.json': '{}' });
  const urls = [];
  const impl = async (url) => {
    urls.push(String(url));
    return new Response(null, { status: 200 });
  };
  await run(['--out', outDir, '--cache', cacheDir, '--prev', 'none'], { ...ENV, R2_JURISDICTION: 'eu' }, { fetchImpl: impl, log: silent });
  assert.ok(urls.every((u) => u.startsWith('https://acct123.eu.r2.cloudflarestorage.com/wegwerk-data/')), urls[0]);
});
