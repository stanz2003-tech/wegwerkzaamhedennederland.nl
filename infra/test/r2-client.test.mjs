import { test } from 'node:test';
import assert from 'node:assert/strict';
import { R2Client, R2Error, isRetryable, withRetry } from '../lib/r2-client.mjs';

const CREDS = {
  accountId: 'acct123',
  bucket: 'wegwerk-data',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  now: () => new Date('2026-09-08T17:00:00Z'),
};

/** Records calls and replies with the queued responses. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

test('putObject sends a signed path-style PUT with Content-Type and Cache-Control', async () => {
  // Arrange
  const { impl, calls } = fakeFetch([new Response(null, { status: 200, headers: { etag: '"abc"' } })]);
  const client = new R2Client({ ...CREDS, fetchImpl: impl });
  const body = Buffer.from('{"a":1}');

  // Act
  const result = await client.putObject('v1/meta.json', body, {
    contentType: 'application/json',
    cacheControl: 'public, max-age=60',
  });

  // Assert
  assert.equal(result.status, 200);
  assert.equal(result.etag, '"abc"');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://acct123.r2.cloudflarestorage.com/wegwerk-data/v1/meta.json');
  const { method, headers } = calls[0].init;
  assert.equal(method, 'PUT');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Cache-Control'], 'public, max-age=60');
  assert.equal(headers['Content-Length'], '7');
  assert.equal(headers['x-amz-date'], '20260908T170000Z');
  assert.equal(headers['x-amz-content-sha256'].length, 64);
  assert.notEqual(headers['x-amz-content-sha256'], 'UNSIGNED-PAYLOAD');
  assert.equal(headers.host, undefined, 'host must not be sent explicitly');
  assert.match(
    headers.Authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260908\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
});

test('host uses the plain endpoint by default and the jurisdiction endpoint when set', () => {
  assert.equal(new R2Client(CREDS).host, 'acct123.r2.cloudflarestorage.com');
  assert.equal(new R2Client({ ...CREDS, jurisdiction: 'eu' }).host, 'acct123.eu.r2.cloudflarestorage.com');
  assert.equal(new R2Client({ ...CREDS, jurisdiction: '' }).host, 'acct123.r2.cloudflarestorage.com');
});

test('getObject returns the body on 200 and null on 404, and throws R2Error otherwise', async () => {
  const { impl } = fakeFetch([
    new Response('{"x":1}', { status: 200 }),
    new Response(null, { status: 404 }),
    new Response('<Error>AccessDenied</Error>', { status: 403 }),
  ]);
  const client = new R2Client({ ...CREDS, fetchImpl: impl });

  const ok = await client.getObject('v1/manifest.json');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), '{"x":1}');

  const missing = await client.getObject('v1/manifest.json');
  assert.deepEqual(missing, { status: 404, body: null });

  await assert.rejects(client.getObject('v1/manifest.json'), (err) => {
    assert.ok(err instanceof R2Error);
    assert.equal(err.status, 403);
    assert.match(err.message, /HTTP 403: <Error>AccessDenied/);
    return true;
  });
});

test('putObject throws R2Error with status on 5xx', async () => {
  const { impl } = fakeFetch([new Response('boom', { status: 503 })]);
  const client = new R2Client({ ...CREDS, fetchImpl: impl });
  await assert.rejects(
    client.putObject('v1/x.json', Buffer.from('{}'), { contentType: 'application/json', cacheControl: 'public, max-age=60' }),
    (err) => err instanceof R2Error && err.status === 503,
  );
});

test('isRetryable: network errors, 429 and 5xx retry; 403/404 do not', () => {
  assert.equal(isRetryable(new TypeError('fetch failed')), true);
  assert.equal(isRetryable(new R2Error('x', { status: 429 })), true);
  assert.equal(isRetryable(new R2Error('x', { status: 500 })), true);
  assert.equal(isRetryable(new R2Error('x', { status: 403 })), false);
  assert.equal(isRetryable(new R2Error('x', { status: 400 })), false);
});

test('withRetry retries retryable failures with backoff and gives up after the attempt limit', async () => {
  const sleeps = [];
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new R2Error('down', { status: 502 });
  };
  await assert.rejects(withRetry(fn, { attempts: 3, baseMs: 100, sleep: async (ms) => void sleeps.push(ms) }), /down/);
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 100 && sleeps[0] < 350, `first backoff ${sleeps[0]}`);
  assert.ok(sleeps[1] >= 200 && sleeps[1] < 450, `second backoff ${sleeps[1]}`);
});

test('withRetry succeeds on a later attempt and does not retry non-retryable errors', async () => {
  let n = 0;
  const flaky = async () => (++n < 2 ? Promise.reject(new TypeError('fetch failed')) : 'ok');
  assert.equal(await withRetry(flaky, { attempts: 3, sleep: async () => {} }), 'ok');
  assert.equal(n, 2);

  let m = 0;
  const forbidden = async () => {
    m++;
    throw new R2Error('nope', { status: 403 });
  };
  await assert.rejects(withRetry(forbidden, { attempts: 3, sleep: async () => {} }), /nope/);
  assert.equal(m, 1);
});
