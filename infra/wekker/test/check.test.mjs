/**
 * Tests for the wekker's end-to-end check (infra/wekker/check.mjs).
 *
 * The check decides whether healthchecks.io hears a heartbeat, and it runs where nobody looks: in
 * a scheduled chain of workflow runs. So the rules for sending or withholding that heartbeat are
 * tested here instead of being discovered in production.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataAgeMinutes, envValue, report, runCheck, verdict } from '../check.mjs';

const ENV = {
  DATA_META_URL: 'https://data.example.nl/v1/meta.json',
  SITE_URL: 'https://www.example.nl/',
  HEALTHCHECK_URL: 'https://hc-ping.com/abc',
  MAX_DATA_AGE_MINUTES: '30',
};

const NOW = Date.parse('2026-09-23T20:00:00Z');
const fresh = (minutesOld) => JSON.stringify({ generated: new Date(NOW - minutesOld * 60000).toISOString() });

/** Records every call and answers by URL substring; unmatched URLs answer 200. */
function fakeFetch(routes = {}) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers ?? {}) });
    for (const [needle, answer] of Object.entries(routes)) {
      if (url.includes(needle)) return typeof answer === 'function' ? answer() : answer;
    }
    return new Response('ok', { status: 200 });
  };
  return { impl, calls, urls: () => calls.map((c) => c.url) };
}

const pinged = (f) => f.urls().some((u) => u.includes('hc-ping.com'));

test('envValue trims pasted whitespace and tolerates a missing env', () => {
  assert.equal(envValue({ A: '  x\n' }, 'A'), 'x');
  assert.equal(envValue({}, 'A'), '');
  assert.equal(envValue(undefined, 'A'), '');
});

test('dataAgeMinutes reads meta.json, and an unreadable stamp is NaN rather than 0', () => {
  assert.equal(dataAgeMinutes({ generated: '2026-09-23T19:30:00Z' }, NOW), 30);
  assert.ok(Number.isNaN(dataAgeMinutes({ generated: 'gisteren' }, NOW)));
  assert.ok(Number.isNaN(dataAgeMinutes({}, NOW)));
});

test('verdict: every unknown counts against the heartbeat, a switched-off check does not', () => {
  const base = { siteOk: true, ageMinutes: 10, maxAgeMinutes: 30 };
  assert.deepEqual(verdict(base), { ok: true, problems: [] });
  assert.equal(verdict({ ...base, siteOk: false }).ok, false);
  assert.equal(verdict({ ...base, ageMinutes: 45 }).ok, false);
  assert.match(verdict({ ...base, ageMinutes: 45 }).problems[0], /45 min oud/);
  assert.equal(verdict({ ...base, ageMinutes: Number.NaN }).ok, false);
  assert.equal(verdict({ ...base, siteOk: null, ageMinutes: null }).ok, true);
});

test('a healthy chain checks both endpoints and sends the heartbeat', async () => {
  const f = fakeFetch({ 'meta.json': () => new Response(fresh(9), { status: 200 }) });
  const result = await runCheck(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(result.ok, true);
  assert.equal(result.pinged, true);
  assert.ok(f.urls().some((u) => u.startsWith('https://www.example.nl/')));
});

test('stale data withholds the heartbeat even though the site answers', async () => {
  // This is the failure the old ping at the end of the Data job could not see: the job went green,
  // but for 2 to 5 hours at a time nothing new reached the site.
  const f = fakeFetch({ 'meta.json': () => new Response(fresh(240), { status: 200 }) });
  const result = await runCheck(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /240 min oud/);
  assert.equal(pinged(f), false);
});

test('a site that is down or throws withholds the heartbeat instead of crashing', async () => {
  const down = fakeFetch({
    'meta.json': () => new Response(fresh(5), { status: 200 }),
    'www.example.nl': () => new Response('bad gateway', { status: 502 }),
  });
  assert.equal((await runCheck(ENV, { now: NOW, fetchImpl: down.impl })).ok, false);
  assert.equal(pinged(down), false);

  const throws = fakeFetch({
    'meta.json': () => new Response(fresh(5), { status: 200 }),
    'www.example.nl': () => {
      throw new Error('timeout');
    },
  });
  const result = await runCheck(ENV, { now: NOW, fetchImpl: throws.impl });
  assert.match(result.problems.join(' '), /site antwoordt niet/);
});

test('a missing or broken meta.json withholds the heartbeat', async () => {
  const missing = fakeFetch({ 'meta.json': () => new Response('Not Found', { status: 404 }) });
  assert.equal((await runCheck(ENV, { now: NOW, fetchImpl: missing.impl })).ok, false);
  const garbage = fakeFetch({ 'meta.json': () => new Response('{"generated":"ooit"}', { status: 200 }) });
  assert.equal((await runCheck(ENV, { now: NOW, fetchImpl: garbage.impl })).ok, false);
});

test('the freshness check bypasses the CDN cache', async () => {
  // Cloudflare once served a cached 404 for minutes after the data was already there.
  const f = fakeFetch({ 'meta.json': () => new Response(fresh(5), { status: 200 }) });
  await runCheck(ENV, { now: NOW, fetchImpl: f.impl });
  const metaCall = f.calls.find((c) => c.url.includes('meta.json'));
  assert.match(metaCall.url, /[?&]wekker=/);
  assert.equal(metaCall.headers.get('cache-control'), 'no-cache');
});

test('without a heartbeat URL the check still reports but pings nothing', async () => {
  const f = fakeFetch({ 'meta.json': () => new Response(fresh(5), { status: 200 }) });
  const result = await runCheck({ ...ENV, HEALTHCHECK_URL: '' }, { now: NOW, fetchImpl: f.impl });
  assert.equal(result.ok, true);
  assert.equal(result.pinged, false);
  assert.equal(pinged(f), false);
});

test('the report names what failed in words the owner can act on', () => {
  const text = report({ ok: false, problems: ['data 240 min oud (max 30)'], age: 240, siteOk: true, pinged: false });
  assert.match(text, /240 min/);
  assert.match(text, /niet verstuurd/);
});
