/**
 * AWS Signature Version 4 (header-based) with nothing but node:crypto.
 *
 * Used by infra/upload-r2.mjs to talk to Cloudflare R2's S3-compatible API
 * (region `auto`, service `s3`). Verified against the official AWS signing test
 * suite vectors in infra/test/sigv4.test.mjs (get-vanilla, get-utf8, get-unreserved,
 * post-vanilla, get-vanilla-query-order-key-case).
 *
 * Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */
import { createHash, createHmac } from 'node:crypto';

export const ALGORITHM = 'AWS4-HMAC-SHA256';
export const EMPTY_PAYLOAD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** @param {string | Uint8Array} data */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** @param {string | Uint8Array} key @param {string} data */
export function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * RFC 3986 percent-encoding as AWS wants it: only A-Z a-z 0-9 - _ . ~ stay bare.
 * (encodeURIComponent leaves ! ' ( ) * unencoded, AWS does not.)
 * @param {string} value
 */
export function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Canonical URI for S3: each path segment single-encoded, slashes kept, no
 * dot-segment normalisation (S3 rule). Input is the *decoded* path.
 * @param {string} path e.g. "/bucket/v1/meta.json"
 */
export function canonicalUri(path) {
  const withSlash = path.startsWith('/') ? path : '/' + path;
  return withSlash.split('/').map(encodeRfc3986).join('/');
}

/**
 * Canonical query string: pairs encoded and sorted by name, then value.
 * @param {URLSearchParams | Record<string, string> | undefined} query
 */
export function canonicalQuery(query) {
  if (!query) return '';
  const entries = query instanceof URLSearchParams ? [...query.entries()] : Object.entries(query);
  return entries
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort((a, b) => (a[0] === b[0] ? cmp(a[1], b[1]) : cmp(a[0], b[0])))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/**
 * Lower-cases names, trims values and collapses inner whitespace, sorts by name.
 * @param {Record<string, string>} headers
 * @returns {{ canonical: string, signed: string, normalized: Array<[string, string]> }}
 */
export function canonicalHeaders(headers) {
  const normalized = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort((a, b) => cmp(a[0], b[0]));
  return {
    canonical: normalized.map(([n, v]) => `${n}:${v}\n`).join(''),
    signed: normalized.map(([n]) => n).join(';'),
    normalized,
  };
}

/**
 * @param {{ method: string, path: string, query?: URLSearchParams | Record<string, string>,
 *           headers: Record<string, string>, payloadHash: string }} req
 */
export function buildCanonicalRequest({ method, path, query, headers, payloadHash }) {
  const { canonical, signed } = canonicalHeaders(headers);
  return [
    method.toUpperCase(),
    canonicalUri(path),
    canonicalQuery(query),
    canonical,
    signed,
    payloadHash,
  ].join('\n');
}

/** @param {Date} date → "20150830T123600Z" */
export function amzDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** @param {{ amzDate: string, scope: string, canonicalRequest: string }} parts */
export function stringToSign({ amzDate: dateTime, scope, canonicalRequest }) {
  return [ALGORITHM, dateTime, scope, sha256Hex(canonicalRequest)].join('\n');
}

/** @param {{ secretAccessKey: string, date: string, region: string, service: string }} parts */
export function signingKey({ secretAccessKey, date, region, service }) {
  const kDate = hmac('AWS4' + secretAccessKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Signs a request and returns the headers to send (input headers + x-amz-date +
 * Authorization) plus the intermediate strings for debugging/tests.
 *
 * `headers` must already contain `host` (and, for S3, `x-amz-content-sha256`).
 *
 * @param {{ method: string, path: string, query?: URLSearchParams | Record<string, string>,
 *           headers: Record<string, string>, payloadHash: string, accessKeyId: string,
 *           secretAccessKey: string, region: string, service: string, date?: Date }} input
 */
export function signRequest(input) {
  const date = input.date ?? new Date();
  const dateTime = amzDate(date);
  const dateStamp = dateTime.slice(0, 8);
  const headers = { ...input.headers, 'x-amz-date': dateTime };
  const canonicalRequest = buildCanonicalRequest({
    method: input.method,
    path: input.path,
    query: input.query,
    headers,
    payloadHash: input.payloadHash,
  });
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const toSign = stringToSign({ amzDate: dateTime, scope, canonicalRequest });
  const key = signingKey({
    secretAccessKey: input.secretAccessKey,
    date: dateStamp,
    region: input.region,
    service: input.service,
  });
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
  const { signed } = canonicalHeaders(headers);
  const authorization =
    `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signed}, Signature=${signature}`;
  return {
    headers: { ...headers, Authorization: authorization },
    canonicalRequest,
    stringToSign: toSign,
    signature,
  };
}

/** Byte-wise (code point) comparison, as AWS sorts. */
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
