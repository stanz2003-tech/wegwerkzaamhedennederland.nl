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

// Google shows a grey globe next to search results until it can fetch a square raster favicon;
// /favicon.ico is also what its favicon crawler tries first. The Organization logo must exist too.
test('favicons, manifest and logo are linked and shipped', () => {
  const head = readFileSync(resolve(WEB_ROOT, 'templates/_head.html'), 'utf8');
  for (const doc of [html, head]) {
    for (const href of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/site.webmanifest']) {
      assert.ok(doc.includes(`href="${href}"`), `missing <link> to ${href}`);
    }
  }
  const logo = html.match(/"logo":\s*"([^"]+)"/)?.[1];
  assert.equal(logo, `${origin}/logo.png`);
  const manifest = JSON.parse(readFileSync(resolve(WEB_ROOT, 'public/site.webmanifest'), 'utf8'));
  const files = ['favicon.ico', 'apple-touch-icon.png', 'logo.png', ...manifest.icons.map((i) => i.src.slice(1))];
  for (const f of files) assert.ok(readFileSync(resolve(WEB_ROOT, 'public', f)).length > 0, `public/${f} is empty`);
});

// Loading fonts from fonts.googleapis.com sends every visitor's IP address to Google, which a
// German court held to breach the GDPR. The fonts are self-hosted from /fonts/ instead.
test('fonts are self-hosted: no Google Fonts requests from any page head', () => {
  const head = readFileSync(resolve(WEB_ROOT, 'templates/_head.html'), 'utf8');
  for (const doc of [html, head]) assert.doesNotMatch(doc, /fonts\.(googleapis|gstatic)\.com/);
  const fontsCss = readFileSync(resolve(WEB_ROOT, 'src/styles/fonts.css'), 'utf8');
  const files = [...fontsCss.matchAll(/url\(\/fonts\/([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 6, 'fonts.css declares too few font files');
  for (const f of files) assert.ok(readFileSync(resolve(WEB_ROOT, 'public/fonts', f)).length > 1000, `public/fonts/${f} missing`);
  const preload = html.match(/<link rel="preload" href="\/fonts\/([^"]+)"/)?.[1];
  assert.ok(preload && files.includes(preload), 'the preloaded font must be one fonts.css uses');
});
