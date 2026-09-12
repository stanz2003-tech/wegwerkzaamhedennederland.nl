/**
 * Minimal Cloudflare R2 client over the S3-compatible API (GetObject / PutObject only),
 * signed with AWS SigV4 (region `auto`, service `s3`), no dependencies.
 *
 * Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>/<key>  (path-style)
 * R2 docs: https://developers.cloudflare.com/r2/api/s3/api/ — PutObject accepts the
 * system metadata headers Content-Type and Cache-Control (verified 2026-09-08).
 */
import { canonicalUri, sha256Hex, signRequest } from './sigv4.mjs';

const REGION = 'auto';
const SERVICE = 's3';
const DEFAULT_TIMEOUT_MS = 60_000;

export class R2Error extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, key?: string, body?: string, cause?: unknown }} [details]
   */
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = 'R2Error';
    this.status = details.status;
    this.key = details.key;
    this.body = details.body;
  }
}

export class R2Client {
  /**
   * `jurisdiction` is only needed for buckets created with "Specify jurisdiction" (e.g. `eu`);
   * their S3 endpoint is https://<ACCOUNT_ID>.<JURISDICTION>.r2.cloudflarestorage.com
   * (https://developers.cloudflare.com/r2/reference/data-location/, checked 2026-09-08).
   *
   * @param {{ accountId: string, bucket: string, accessKeyId: string, secretAccessKey: string,
   *           jurisdiction?: string, fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => Date }} options
   */
  constructor({ accountId, bucket, accessKeyId, secretAccessKey, jurisdiction, fetchImpl, timeoutMs, now }) {
    this.accountId = accountId;
    this.bucket = bucket;
    this.jurisdiction = jurisdiction || undefined;
    this.credentials = { accessKeyId, secretAccessKey };
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = now ?? (() => new Date());
  }

  get host() {
    const jurisdiction = this.jurisdiction ? `.${this.jurisdiction}` : '';
    return `${this.accountId}${jurisdiction}.r2.cloudflarestorage.com`;
  }

  /** Public URL-ish description for logs (never includes credentials). */
  describe() {
    return `https://${this.host}/${this.bucket}`;
  }

  /**
   * @param {string} key
   * @returns {Promise<{ status: 200, body: Buffer } | { status: 404, body: null }>}
   */
  async getObject(key) {
    const response = await this.#send('GET', key, null, {});
    if (response.status === 404) return { status: 404, body: null };
    if (response.status !== 200) throw await toError('GetObject', key, response);
    return { status: 200, body: Buffer.from(await response.arrayBuffer()) };
  }

  /**
   * @param {string} key
   * @param {Uint8Array} body
   * @param {{ contentType: string, cacheControl: string }} meta
   * @returns {Promise<{ status: number, etag: string | null }>}
   */
  async putObject(key, body, { contentType, cacheControl }) {
    const response = await this.#send('PUT', key, body, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'Content-Length': String(body.byteLength),
    });
    if (response.status < 200 || response.status >= 300) {
      throw await toError('PutObject', key, response);
    }
    return { status: response.status, etag: response.headers.get('etag') };
  }

  /**
   * Signs and sends one request. Content-Length is sent but not signed (the runtime
   * owns framing); host, x-amz-*, Content-Type and Cache-Control are signed.
   * @param {'GET' | 'PUT'} method
   * @param {string} key
   * @param {Uint8Array | null} body
   * @param {Record<string, string>} extraHeaders
   */
  async #send(method, key, body, extraHeaders) {
    const payloadHash = sha256Hex(body ?? '');
    const path = `/${this.bucket}/${key}`;
    const { 'Content-Length': contentLength, ...signable } = extraHeaders;
    const signed = signRequest({
      method,
      path,
      headers: { ...signable, host: this.host, 'x-amz-content-sha256': payloadHash },
      payloadHash,
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      region: REGION,
      service: SERVICE,
      date: this.now(),
    });
    // The runtime sets Host itself; sending it explicitly is not allowed by fetch.
    const { host: _host, ...headers } = signed.headers;
    if (contentLength) headers['Content-Length'] = contentLength;
    return this.fetchImpl(`https://${this.host}${canonicalUri(path)}`, {
      method,
      headers,
      body: body ?? undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}

/**
 * @param {string} op
 * @param {string} key
 * @param {Response} response
 */
async function toError(op, key, response) {
  const text = await response.text().catch(() => '');
  const snippet = text.replace(/\s+/g, ' ').slice(0, 300);
  return new R2Error(`${op} ${key} failed with HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`, {
    status: response.status,
    key,
    body: text,
  });
}

/** Retry on network errors, timeouts, 429 and 5xx; never on other 4xx. @param {unknown} err */
export function isRetryable(err) {
  if (err instanceof R2Error) return err.status === 429 || (err.status ?? 0) >= 500;
  return true; // fetch TypeError, AbortError (timeout), DNS hiccups …
}

/**
 * Runs `fn` up to `attempts` times with exponential backoff (+ jitter).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseMs?: number, sleep?: (ms: number) => Promise<void>,
 *           onRetry?: (err: unknown, attempt: number) => void }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { attempts = 3, baseMs = 500, sleep = defaultSleep, onRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      onRetry?.(err, attempt);
      await sleep(baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
