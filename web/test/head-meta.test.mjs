/**
 * The 3.906 generated pages get their canonical URL from site.config.json through gen-pages.mjs,
 * but web/index.html is a hand-written Vite entry and was shipped with the template placeholder
 * `https://www.wegwerk.example/` in its canonical, og:url and WebSite JSON-LD. Live, that told
 * Google the homepage — the root of the whole internal link graph — canonicalises to a domain that
 * does not exist. Nothing in the build caught it, so it is asserted here.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(WEB_ROOT, 'index.html'), 'utf8');
const config = JSON.parse(readFileSync(resolve(WEB_ROOT, 'site.config.json'), 'utf8'));
const origin = config.url.replace(/\/$/, '');

test('index.html carries no template placeholder domain', () => {
  assert.ok(!/\.example\b/.test(html), 'index.html still contains an .example placeholder URL');
});

test('canonical and og:url of the homepage point at the configured site URL', () => {
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  const ogUrl = html.match(/<meta property="og:url" content="([^"]+)"/)?.[1];
  assert.equal(canonical, `${origin}/`);
  assert.equal(ogUrl, `${origin}/`);
});

test('every absolute URL in index.html uses the configured origin', () => {
  const urls = [...html.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((m) => m[0]);
  const ownHost = new URL(origin).host;
  // Third-party origins (fonts, tiles, NDW) are fine; anything on our own name must match exactly.
  const wrong = urls.filter((u) => {
    const host = new URL(u).host;
    return /wegwerk/i.test(host) && host !== ownHost;
  });
  assert.deepEqual(wrong, [], `index.html links to a wrong host of our own: ${wrong.join(', ')}`);
});
