/**
 * Tests for the wekker Worker (infra/worker/src/index.mjs).
 *
 * The Worker is the single point of failure for data freshness, and it runs where nobody looks:
 * on a cron, in someone else's cloud, with no output but a heartbeat. So the rules that decide
 * whether that heartbeat is sent are tested here rather than discovered in production.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataAgeMinutes, dispatchRequest, envValue, runCheck, verdict } from '../src/index.mjs';

const ENV = {
  GITHUB_TOKEN: 'ghp_example',
  GITHUB_REPO: 'stanz2003-tech/wegwerkzaamhedennederland.nl',
  DATA_META_URL: 'https://data.example.nl/v1/meta.json',
  SITE_URL: 'https://www.example.nl/',
  HEALTHCHECK_URL: 'https://hc-ping.com/abc',
  MAX_DATA_AGE_MINUTES: '45',
};

const NOW = Date.parse('2026-09-16T20:00:00Z');
const fresh = (minutesOld) => JSON.stringify({ generated: new Date(NOW - minutesOld * 60000).toISOString() });

/**
 * Records every call and answers by URL substring. Anything unmatched answers 204, which is the
 * success shape for the dispatch endpoint.
 */
function fakeFetch(routes = {}) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (typeof input === 'string' ? init.method : input.method) ?? 'GET';
    const headers = typeof input === 'string' ? new Headers(init.headers ?? {}) : input.headers;
    calls.push({ url, method, headers });
    for (const [needle, answer] of Object.entries(routes)) {
      if (url.includes(needle)) return typeof answer === 'function' ? answer() : answer;
    }
    return new Response(null, { status: 204 });
  };
  return { impl, calls, urls: () => calls.map((c) => c.url) };
}

test('envValue trims pasted whitespace and tolerates a missing env', () => {
  assert.equal(envValue({ A: '  x\n' }, 'A'), 'x');
  assert.equal(envValue({}, 'A'), '');
  assert.equal(envValue(undefined, 'A'), '');
});

test('dispatchRequest targets the workflow dispatch endpoint with the headers GitHub requires', () => {
  const req = dispatchRequest({ ...ENV, WORKFLOW_FILE: 'data.yml', GITHUB_REF: 'main' });
  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://api.github.com/repos/stanz2003-tech/wegwerkzaamhedennederland.nl/actions/workflows/data.yml/dispatches');
  assert.equal(req.headers.get('authorization'), 'Bearer ghp_example');
  assert.equal(req.headers.get('x-github-api-version'), '2022-11-28');
  // GitHub answers 403 to an API call without a User-Agent, which would be invisible here.
  assert.ok(req.headers.get('user-agent'));
});

test('dispatchRequest refuses to run half-configured rather than firing at the wrong repository', () => {
  assert.throws(() => dispatchRequest({ ...ENV, GITHUB_REPO: 'geen-schuine-streep' }), /owner\/name/);
  assert.throws(() => dispatchRequest({ ...ENV, GITHUB_TOKEN: '   ' }), /GITHUB_TOKEN/);
});

test('dataAgeMinutes reads meta.json, and an unreadable stamp is NaN rather than 0', () => {
  assert.equal(dataAgeMinutes({ generated: '2026-09-16T19:30:00Z' }, NOW), 30);
  assert.ok(Number.isNaN(dataAgeMinutes({ generated: 'gisteren' }, NOW)));
  assert.ok(Number.isNaN(dataAgeMinutes({}, NOW)));
});

test('verdict: every unknown counts against the heartbeat', () => {
  const base = { dispatched: true, siteOk: true, ageMinutes: 10, maxAgeMinutes: 45 };
  assert.deepEqual(verdict(base), { ok: true, problems: [] });
  assert.equal(verdict({ ...base, dispatched: false }).ok, false);
  assert.equal(verdict({ ...base, siteOk: false }).ok, false);
  assert.equal(verdict({ ...base, ageMinutes: 90 }).ok, false);
  assert.match(verdict({ ...base, ageMinutes: 90 }).problems[0], /90 min oud/);
  assert.equal(verdict({ ...base, ageMinutes: Number.NaN }).ok, false);
  // A check that is switched off (null) is not a problem; a check that failed is.
  assert.equal(verdict({ ...base, siteOk: null, ageMinutes: null }).ok, true);
});

test('a healthy cycle dispatches, checks both endpoints and pings the heartbeat', async () => {
  const f = fakeFetch({
    'meta.json': () => new Response(fresh(8), { status: 200 }),
    'www.example.nl': () => new Response('<!doctype html>', { status: 200 }),
  });
  const result = await runCheck(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(result.ok, true);
  assert.equal(result.dispatched, true);
  assert.ok(f.urls().some((u) => u.includes('/dispatches')));
  assert.ok(f.urls().some((u) => u.includes('hc-ping.com')), 'heartbeat moet gepingd worden');
});

test('stale data stops the heartbeat even though the workflow started and the site answers', async () => {
  const f = fakeFetch({
    'meta.json': () => new Response(fresh(240), { status: 200 }),
    'www.example.nl': () => new Response('ok', { status: 200 }),
  });
  const result = await runCheck(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /240 min oud/);
  assert.ok(!f.urls().some((u) => u.includes('hc-ping.com')), 'geen hartslag bij verouderde data');
});

test('an expired token stops the heartbeat and names the HTTP status', async () => {
  const f = fakeFetch({
    '/dispatches': () => new Response('Bad credentials', { status: 401 }),
    'meta.json': () => new Response(fresh(5), { status: 200 }),
    'www.example.nl': () => new Response('ok', { status: 200 }),
  });
  const result = await runCheck(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /workflow niet gestart \(HTTP 401\)/);
  assert.ok(!f.urls().some((u) => u.includes('hc-ping.com')));
});

test('a site that is down stops the heartbeat, and a throwing fetch is a failure, not a crash', async () => {
  const f = fakeFetch({
    'meta.json': () => new Response(fresh(5), { status: 200 }),
    'www.example.nl': () => { throw new Error('timeout'); },
  });
  const result = await runCheck(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /site antwoordt niet/);
});

test('the freshness check bypasses the CDN cache', async () => {
  const f = fakeFetch({
    'meta.json': () => new Response(fresh(5), { status: 200 }),
    'www.example.nl': () => new Response('ok', { status: 200 }),
  });
  await runCheck(ENV, { now: NOW, fetchImpl: f.impl });
  const metaCall = f.calls.find((c) => c.url.includes('meta.json'));
  assert.match(metaCall.url, /[?&]wekker=/, 'cache-buster ontbreekt: de check zou de CDN-kopie kunnen lezen');
});

test('without optional configuration only the dispatch happens', async () => {
  const f = fakeFetch();
  const result = await runCheck({ GITHUB_TOKEN: 't', GITHUB_REPO: 'a/b' }, { now: NOW, fetchImpl: f.impl });
  assert.equal(result.ok, true);
  assert.equal(f.calls.length, 1);
  assert.match(f.urls()[0], /\/dispatches$/);
});
