/**
 * Feed download: 60 s timeout (headers + idle), 2 retries with backoff,
 * conditional GET (`If-None-Match`) from `<cache>/etags.json`, gunzip straight
 * into the parser stream. Local files (`--from-file`) go through the same
 * path so tests and offline development need no network.
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_RETRIES = 2;
const BACKOFF_MS = [1000, 3000];
const USER_AGENT = 'wegwerk-pipeline (+https://github.com/wegwerk)';

/**
 * @typedef {object} EtagEntry
 * @property {string=} etag
 * @property {string=} lastModified
 * @property {string=} publicationTime
 * @property {string=} fetchedAt
 * @property {number=} parser           PARSER_VERSION that wrote the cached parse (pipeline.js)
 */

/**
 * @typedef {object} FetchResult
 * @property {'ok'|'unchanged'|'error'} status
 * @property {AsyncIterable<string>=} stream   decoded UTF-8 XML chunks
 * @property {string=} etag
 * @property {string=} lastModified
 * @property {string=} error
 * @property {number=} httpStatus
 */

/** @param {string} cacheDir */
export function etagsPath(cacheDir) {
  return join(cacheDir, 'etags.json');
}

/**
 * @param {string} cacheDir
 * @returns {Record<string, EtagEntry>}
 */
export function readEtags(cacheDir) {
  const path = etagsPath(cacheDir);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} cacheDir
 * @param {Record<string, EtagEntry>} etags
 */
export function writeEtags(cacheDir, etags) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(etagsPath(cacheDir), JSON.stringify(etags, null, 2) + '\n');
}

/**
 * Open a local feed file (gunzipped when the name ends in .gz).
 * @param {string} path
 * @returns {AsyncIterable<string>}
 */
export function openLocalFile(path) {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const raw = createReadStream(path, { highWaterMark: 1 << 20 });
  if (path.endsWith('.gz')) {
    const gunzip = createGunzip();
    gunzip.setEncoding('utf8');
    raw.on('error', (err) => gunzip.destroy(err));
    return raw.pipe(gunzip);
  }
  raw.setEncoding('utf8');
  return raw;
}

/**
 * Download a feed. Returns `unchanged` on HTTP 304 (only when `ifNoneMatch`
 * was sent), `error` after the retries are exhausted.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string=} options.ifNoneMatch
 * @param {number=} options.timeoutMs
 * @param {number=} options.retries
 * @param {typeof fetch=} options.fetchImpl
 * @param {{ warn(m: string, f?: object): void, debug(m: string, f?: object): void }=} options.log
 * @param {(ms: number) => Promise<void>=} options.sleep
 * @returns {Promise<FetchResult>}
 */
export async function fetchFeed(url, options = {}) {
  const { ifNoneMatch, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, fetchImpl = fetch, log, sleep = defaultSleep } = options;
  let lastError = 'unknown error';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
    const controller = new AbortController();
    const headerTimer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
    try {
      /** @type {Record<string, string>} */
      const headers = { 'user-agent': USER_AGENT, 'accept-encoding': 'identity' };
      if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
      const res = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'follow' });
      if (res.status === 304 && ifNoneMatch) {
        clearTimeout(headerTimer);
        return { status: 'unchanged', etag: res.headers.get('etag') ?? ifNoneMatch, lastModified: res.headers.get('last-modified') ?? undefined, httpStatus: 304 };
      }
      if (!res.ok || !res.body) {
        clearTimeout(headerTimer);
        lastError = `HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return { status: 'error', error: lastError, httpStatus: res.status };
        }
        log?.warn('fetch failed, retrying', { url, attempt, error: lastError });
        continue;
      }
      clearTimeout(headerTimer);
      const body = Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (res.body));
      const gz = isGzip(url, res.headers.get('content-type'));
      /** @type {import('node:stream').Readable} */
      let decoded;
      if (gz) {
        const gunzip = createGunzip();
        gunzip.setEncoding('utf8');
        body.on('error', (err) => gunzip.destroy(err));
        decoded = body.pipe(gunzip);
      } else {
        body.setEncoding('utf8');
        decoded = body;
      }
      return {
        status: 'ok',
        stream: idleGuard(decoded, timeoutMs, () => controller.abort(new Error(`no data for ${timeoutMs} ms`))),
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        httpStatus: res.status,
      };
    } catch (err) {
      clearTimeout(headerTimer);
      lastError = err instanceof Error ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message) : String(err);
      log?.warn('fetch failed, retrying', { url, attempt, error: lastError });
    }
  }
  return { status: 'error', error: lastError };
}

/** @param {string} url @param {string | null} contentType */
function isGzip(url, contentType) {
  if (/\.gz(\?|$)/i.test(url)) return true;
  return /gzip/i.test(contentType ?? '');
}

/**
 * Abort when no chunk arrives for `ms`.
 * @param {AsyncIterable<string>} iterable
 * @param {number} ms
 * @param {() => void} onTimeout
 * @returns {AsyncIterable<string>}
 */
export async function* idleGuard(iterable, ms, onTimeout) {
  const it = iterable[Symbol.asyncIterator]();
  while (true) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error(`no data for ${ms} ms`));
      }, ms);
    });
    try {
      const result = await Promise.race([it.next(), timeout]);
      if (result.done) return;
      yield result.value;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
