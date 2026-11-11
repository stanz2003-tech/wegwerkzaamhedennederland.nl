/**
 * Tests for one watchdog tick (infra/watchdog/tick.mjs) against a fake `fetch`: which requests it
 * makes, that it only ever POSTs a dispatch when the decision says so, and that the token never
 * leaks into what it logs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAIN_ACTOR } from '../decide.mjs';
import { DEFAULTS, envValue, logRecord, tick } from '../tick.mjs';

const TOKEN = 'github_pat_TEST_never_logged';
const ENV = { GITHUB_TOKEN: `  ${TOKEN}\n`, HEALTHCHECK_URL: 'https://hc-ping.com/watchdog-uuid' };
const NOW = Date.parse('2026-11-09T18:45:00Z');
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const runs = (...list) => json({ total_count: list.length, workflow_runs: list });
const done = (created, updated) => ({ status: 'completed', created_at: ago(created), updated_at: ago(updated), event: 'workflow_dispatch', actor: { login: CHAIN_ACTOR } });

/** Records every call and answers by URL substring (first match wins); unmatched URLs answer 404. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : {}));
    const body = init.body ?? null;
    calls.push({ url, method, headers, body });
    for (const [needle, answer] of Object.entries(routes)) {
      if (url.includes(needle)) return typeof answer === 'function' ? answer({ url, method, body }) : answer.clone();
    }
    return new Response('not found', { status: 404 });
  };
  return { impl, calls, posts: () => calls.filter((c) => c.method === 'POST'), urls: () => calls.map((c) => c.url) };
}

/** A GitHub + data host where the chain died 26 minutes ago and the data is 28 minutes old. */
function deadChain(extra = {}) {
  return fakeFetch({
    'meta.json': () => json({ generated: ago(28) }),
    '/workflows/data.yml/dispatches': () => new Response(null, { status: 204 }),
    '/workflows/data.yml/runs': () => runs(done(29, 26)),
    '/workflows/wekker.yml/runs': () => runs(done(38, 29)),
    'hc-ping.com': () => new Response('OK'),
    ...extra,
  });
}

test('envValue trims pasted whitespace and tolerates a missing env', () => {
  assert.equal(envValue({ A: '  x\n' }, 'A'), 'x');
  assert.equal(envValue({}, 'A'), '');
  assert.equal(envValue(undefined, 'A'), '');
});

test('fresh data: reads meta.json past the CDN and both run lists, dispatches nothing', async () => {
  const f = fakeFetch({
    'meta.json': () => json({ generated: ago(3) }),
    '/workflows/data.yml/runs': () => runs(done(4, 2)),
    '/workflows/wekker.yml/runs': () => runs({ ...done(2, 1), status: 'waiting' }),
    'hc-ping.com': () => new Response('OK'),
  });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.action, 'ok');
  assert.equal(f.posts().length, 0);
  const meta = f.calls.find((c) => c.url.includes('meta.json'));
  assert.match(meta.url, new RegExp(`^${DEFAULTS.DATA_META_URL.replace(/\./g, '\\.')}\\?watchdog=${NOW}$`));
  assert.equal(meta.headers.get('cache-control'), 'no-cache');
  assert.equal(meta.headers.get('authorization'), null, 'the token never goes to the data host');
  const list = f.calls.find((c) => c.url.includes('/workflows/data.yml/runs'));
  assert.ok(list.url.startsWith(`https://api.github.com/repos/${DEFAULTS.GITHUB_REPO}/actions/workflows/data.yml/runs?`));
  assert.equal(list.headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.ok(list.headers.get('user-agent'));
  assert.equal(record.heartbeat, 'ok');
  assert.ok(f.urls().includes('https://hc-ping.com/watchdog-uuid'));
});

test('stale data and a dead chain: one POST to the Data dispatch endpoint with ref main', async () => {
  const f = deadChain();
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.action, 'dispatch');
  const posts = f.posts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `https://api.github.com/repos/${DEFAULTS.GITHUB_REPO}/actions/workflows/data.yml/dispatches`);
  assert.deepEqual(JSON.parse(posts[0].body), { ref: 'main' });
  assert.equal(posts[0].headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.deepEqual(record.dispatch, { ok: true, status: 204 });
  assert.deepEqual(record.errors, []);
  assert.equal(record.heartbeat, 'ok');
});

test('a stuck run is cancelled first, then Data is dispatched; "already finished" (409) is fine', async () => {
  const stuck = { ...done(95, 95), id: 4242, status: 'waiting' };
  const gone = { ...done(80, 80), id: 4343, status: 'queued' };
  const f = deadChain({
    '/actions/runs/4242/cancel': () => new Response(null, { status: 202 }),
    '/actions/runs/4343/cancel': () => new Response('{"message":"Cannot cancel a workflow run that is completed."}', { status: 409 }),
    '/workflows/wekker.yml/runs': () => runs(stuck, done(38, 29)),
    '/workflows/data.yml/runs': () => runs(gone, done(29, 26)),
  });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.action, 'dispatch');
  const posts = f.posts().map((p) => p.url.replace(`https://api.github.com/repos/${DEFAULTS.GITHUB_REPO}`, ''));
  assert.deepEqual(posts.slice(-1), ['/actions/workflows/data.yml/dispatches'], 'the dispatch comes last');
  assert.deepEqual(posts.slice(0, -1).sort(), ['/actions/runs/4242/cancel', '/actions/runs/4343/cancel']);
  assert.ok(f.posts().every((p) => p.headers.get('authorization') === `Bearer ${TOKEN}`));
  assert.deepEqual(record.cancelled.map((c) => [c.id, c.ok]).sort(), [[4242, true], [4343, true]]);
  assert.deepEqual(record.errors, []);
  assert.equal(record.heartbeat, 'ok');
});

test('a cancel that fails is reported, the restart still goes out, the heartbeat says fail', async () => {
  const f = deadChain({
    '/actions/runs/4242/cancel': () => new Response('nope', { status: 500 }),
    '/workflows/wekker.yml/runs': () => runs({ ...done(95, 95), id: 4242, status: 'waiting' }),
  });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.dispatch.ok, true);
  assert.match(record.errors.join(' '), /cancel 4242: HTTP 500/);
  assert.equal(record.heartbeat, 'fail');
});

test('a refused dispatch is an error with a hint, and the heartbeat reports a failure', async () => {
  const f = deadChain({ '/workflows/data.yml/dispatches': () => new Response('{"message":"Bad credentials"}', { status: 401 }) });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.action, 'dispatch');
  assert.equal(record.dispatch.ok, false);
  assert.equal(record.dispatch.status, 401);
  assert.match(record.errors.join(' '), /verlopen/);
  assert.equal(record.heartbeat, 'fail');
  assert.ok(f.urls().includes('https://hc-ping.com/watchdog-uuid/fail'));
});

test('run lists unreadable: no dispatch, an error, a failure heartbeat', async () => {
  const f = deadChain({ '/workflows/wekker.yml/runs': () => new Response('rate limited', { status: 403 }) });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.action, 'unknown');
  assert.equal(f.posts().length, 0);
  assert.match(record.errors.join(' '), /wekker\.yml.*403/);
  assert.equal(record.heartbeat, 'fail');
});

test('a network error is caught and reported, never thrown', async () => {
  const f = deadChain({ '/workflows/data.yml/runs': () => Promise.reject(new TypeError('fetch failed')) });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.action, 'unknown');
  assert.match(record.errors.join(' '), /fetch failed/);
});

test('meta.json unreadable: noted, and the chain\'s silence decides', async () => {
  const f = deadChain({ 'meta.json': () => new Response('<html>', { status: 200 }) });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.generated, null);
  assert.match(record.errors.join(' '), /meta\.json/);
  assert.equal(record.action, 'dispatch', 'silent for 26 minutes');
});

test('without a token the Worker touches nothing on GitHub and says why', async () => {
  const f = deadChain();
  const record = await tick({ HEALTHCHECK_URL: ENV.HEALTHCHECK_URL }, { now: NOW, fetchImpl: f.impl });
  assert.equal(record.action, 'unknown');
  assert.match(record.errors.join(' '), /GITHUB_TOKEN/);
  assert.equal(f.urls().filter((u) => u.includes('api.github.com')).length, 0);
  assert.equal(record.heartbeat, 'fail');
});

test('a dry run decides like the real thing but never cancels, dispatches or pings', async () => {
  const f = deadChain({ '/workflows/wekker.yml/runs': () => runs({ ...done(95, 95), id: 4242, status: 'waiting' }) });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl, dryRun: true });
  assert.equal(record.action, 'dispatch');
  assert.equal(record.dryRun, true);
  assert.deepEqual(record.dispatch, { skipped: 'dry-run' });
  assert.deepEqual(record.cancelled, [{ id: 4242, skipped: 'dry-run' }]);
  assert.equal(f.posts().length, 0);
  assert.equal(f.urls().some((u) => u.includes('hc-ping.com')), false);
  // ...and it works without a token: the repository is public, so the lists are readable.
  const anon = deadChain();
  const anonRecord = await tick({}, { now: NOW, fetchImpl: anon.impl, dryRun: true });
  assert.equal(anonRecord.action, 'dispatch');
  assert.equal(anon.calls.find((c) => c.url.includes('/runs')).headers.get('authorization'), null);
});

test('the token never appears in the record or the log line', async () => {
  const f = deadChain({ '/workflows/data.yml/dispatches': () => new Response('nope', { status: 403 }) });
  const record = await tick(ENV, { now: NOW, fetchImpl: f.impl });
  const lines = [];
  logRecord(record, { log: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l) });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(JSON.stringify(record), /github_pat/);
  assert.doesNotMatch(lines[0], /github_pat/);
});

test('logRecord writes one JSON line, at a level that matches what happened', () => {
  const seen = [];
  const logger = { log: (l) => seen.push(['log', l]), warn: (l) => seen.push(['warn', l]), error: (l) => seen.push(['error', l]) };
  logRecord({ action: 'ok', reason: 'x', errors: [] }, logger);
  logRecord({ action: 'dispatch', reason: 'x', errors: [] }, logger);
  logRecord({ action: 'unknown', reason: 'x', errors: ['boom'] }, logger);
  assert.deepEqual(seen.map(([level]) => level), ['log', 'warn', 'error']);
  for (const [, line] of seen) assert.doesNotThrow(() => JSON.parse(line));
});
