/**
 * Reproduces vectors from the official AWS Signature V4 test suite
 * (https://github.com/awslabs/aws-c-auth/tree/main/tests/aws-signing-test-suite/v4,
 * fetched 2026-09-08). Every vector uses the same context:
 *   access key AKIDEXAMPLE, secret wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY,
 *   region us-east-1, service "service", timestamp 2015-08-30T12:36:00Z,
 *   host example.amazonaws.com, empty payload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_PAYLOAD_HASH,
  amzDate,
  canonicalQuery,
  canonicalUri,
  encodeRfc3986,
  sha256Hex,
  signRequest,
} from '../lib/sigv4.mjs';

const CONTEXT = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  date: new Date('2015-08-30T12:36:00Z'),
  payloadHash: EMPTY_PAYLOAD_HASH,
};
const HOST = 'example.amazonaws.com';

const VECTORS = [
  {
    name: 'get-vanilla',
    method: 'GET',
    path: '/',
    canonicalRequest:
      'GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n' +
      EMPTY_PAYLOAD_HASH,
    stringToSign:
      'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n' +
      'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63',
    signature: '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  },
  {
    name: 'post-vanilla',
    method: 'POST',
    path: '/',
    canonicalRequest:
      'POST\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n' +
      EMPTY_PAYLOAD_HASH,
    stringToSign:
      'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n' +
      '553f88c9e4d10fc9e109e2aeb65f030801b70c2f6468faca261d401ae622fc87',
    signature: '5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b',
  },
  {
    name: 'get-utf8',
    method: 'GET',
    path: '/ሴ',
    canonicalRequest:
      'GET\n/%E1%88%B4\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n' +
      EMPTY_PAYLOAD_HASH,
    stringToSign:
      'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n' +
      '2a0a97d02205e45ce2e994789806b19270cfbbb0921b278ccf58f5249ac42102',
    signature: '8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85',
  },
  {
    name: 'get-unreserved',
    method: 'GET',
    path: '/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    canonicalRequest:
      'GET\n/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\n\n' +
      'host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n' +
      EMPTY_PAYLOAD_HASH,
    stringToSign:
      'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n' +
      '6a968768eefaa713e2a6b16b589a8ea192661f098f37349f4e2c0082757446f9',
    signature: '07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f',
  },
  {
    name: 'get-vanilla-query-order-key-case',
    method: 'GET',
    path: '/',
    query: new URLSearchParams('Param2=value2&Param1=value1'),
    canonicalRequest:
      'GET\n/\nParam1=value1&Param2=value2\nhost:example.amazonaws.com\n' +
      'x-amz-date:20150830T123600Z\n\nhost;x-amz-date\n' +
      EMPTY_PAYLOAD_HASH,
    stringToSign:
      'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n' +
      '816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0',
    signature: 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
  },
];

for (const v of VECTORS) {
  test(`AWS test suite vector "${v.name}" reproduces canonical request, string to sign and signature`, () => {
    // Arrange
    const input = { ...CONTEXT, method: v.method, path: v.path, query: v.query, headers: { Host: HOST } };

    // Act
    const result = signRequest(input);

    // Assert
    assert.equal(result.canonicalRequest, v.canonicalRequest);
    assert.equal(result.stringToSign, v.stringToSign);
    assert.equal(result.signature, v.signature);
    assert.equal(
      result.headers.Authorization,
      `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ` +
        `SignedHeaders=host;x-amz-date, Signature=${v.signature}`,
    );
    assert.equal(result.headers['x-amz-date'], '20150830T123600Z');
  });
}

test('sha256 of the empty string equals the well-known empty payload hash', () => {
  assert.equal(sha256Hex(''), EMPTY_PAYLOAD_HASH);
});

test('amzDate formats without separators or milliseconds', () => {
  assert.equal(amzDate(new Date('2026-09-08T17:05:09.123Z')), '20260908T170509Z');
});

test('encodeRfc3986 encodes the characters encodeURIComponent leaves bare', () => {
  assert.equal(encodeRfc3986("a b!'()*~"), 'a%20b%21%27%28%29%2A~');
});

test('canonicalUri keeps slashes, encodes segments and prefixes a missing leading slash', () => {
  assert.equal(canonicalUri('bucket/v1/index/prov/PV20.json'), '/bucket/v1/index/prov/PV20.json');
  assert.equal(canonicalUri('/b/dir with space/f+g.json'), '/b/dir%20with%20space/f%2Bg.json');
});

test('canonicalQuery sorts by name then value and encodes both', () => {
  assert.equal(canonicalQuery({ b: '2', a: 'x y' }), 'a=x%20y&b=2');
  assert.equal(canonicalQuery(undefined), '');
});

test('signed headers include x-amz-content-sha256, content-type and cache-control when present', () => {
  const result = signRequest({
    ...CONTEXT,
    method: 'PUT',
    path: '/wegwerk-data/v1/live.geojson',
    headers: {
      Host: 'acct.r2.cloudflarestorage.com',
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public,   max-age=60',
      'x-amz-content-sha256': 'abc',
    },
    payloadHash: 'abc',
  });
  assert.match(
    result.headers.Authorization,
    /SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date,/,
  );
  // Header values are trimmed and inner whitespace collapsed in the canonical form only.
  assert.match(result.canonicalRequest, /\ncache-control:public, max-age=60\n/);
  assert.equal(result.headers['Cache-Control'], 'public,   max-age=60');
});
