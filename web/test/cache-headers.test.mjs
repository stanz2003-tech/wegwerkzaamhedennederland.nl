/**
 * web/public/_headers (Cloudflare Pages): the hashed build output and the fonts are cached by the
 * browser for a year without asking again; everything else keeps Pages' default
 * "max-age=0, must-revalidate", so a deploy or a data update shows at once. Before this file
 * existed, every visit re-checked ~20 unchanged JS/CSS/font files, one round trip each.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const site = JSON.parse(read('../site.config.json'));
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The `_headers` format: an unindented URL pattern (one `*` splat) followed by indented `Name: value` lines. */
function parseHeaders(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim();
      const parts = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
      rules.push({ pattern, re: new RegExp(`^${parts.join('.*')}$`), headers: {} });
      continue;
    }
    const rule = rules.at(-1);
    assert.ok(rule, `header line before any URL pattern: ${line}`);
    const i = line.indexOf(':');
    rule.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return rules;
}

const rules = parseHeaders(read('../public/_headers'));
const cacheControl = (path) => rules.filter((r) => r.re.test(path)).map((r) => r.headers['cache-control']).filter(Boolean);

describe('browser caching (public/_headers)', () => {
  it('stays within the Cloudflare Pages limits: one splat per pattern, at most 100 rules', () => {
    assert.ok(rules.length >= 2 && rules.length <= 100);
    for (const r of rules) assert.ok(r.pattern.split('*').length <= 2, r.pattern);
    for (const line of read('../public/_headers').split(/\r?\n/)) assert.ok(line.length <= 2000);
  });

  it('caches the hashed build output and the fonts for a year', () => {
    for (const path of [
      '/assets/templates/road-5eLZKdzJ.js',
      '/assets/page-boot-D2hO7jHP.css',
      '/assets/maplibre-DDXIoNRR.js',
      '/assets/maplibre-gl-worker-CRiIRpYb.js',
      '/fonts/ibm-plex-sans-latin-868a235a.woff2',
    ]) {
      assert.deepEqual(cacheControl(path), [IMMUTABLE], path);
    }
  });

  it('leaves pages, data and every unhashed file on the Pages default (always revalidated)', () => {
    for (const path of [
      '/',
      '/index.html',
      '/weg/a2/',
      '/plaats/utrecht/',
      '/404.html',
      '/data/meta.json',
      '/data/index/all.json',
      '/sitemap.xml',
      '/robots.txt',
      '/ads.txt',
      '/entity-pages.json',
      '/wegen.json',
      '/favicon.svg',
      '/favicon.ico',
      '/site.webmanifest',
      '/logo.png',
      '/styles/pdok-standaard.json',
      `/${site.indexnow.key}.txt`,
    ]) {
      assert.deepEqual(cacheControl(path), [], path);
    }
  });

  it('nothing unhashed can end up under /assets/: no public/assets, Vite keeps its hashed names', () => {
    assert.equal(existsSync(new URL('../public/assets', import.meta.url)), false);
    const vite = read('../vite.config.ts');
    assert.doesNotMatch(vite, /assetsDir|entryFileNames|chunkFileNames|assetFileNames/, 'changing the output names? keep [hash] in them and check public/_headers');
  });
});

/**
 * /fonts/* is cached for a year too, but those names are versions we chose, not hashes Vite
 * computes. A font changed in place would reach returning visitors only a year later: give a new
 * or changed font a new file name (and update src/styles/fonts.css and this list).
 */
const FONT_FINGERPRINTS = {
  'ibm-plex-mono-latin-0bc96cd0.woff2': '01d285447409c8a5',
  'ibm-plex-mono-latin-e2661bcc.woff2': '08949f728dc52d52',
  'ibm-plex-mono-latin-ext-1969f6ff.woff2': '6bc0f226a5b7884a',
  'ibm-plex-mono-latin-ext-93cfae71.woff2': '6bb06407c97584b0',
  'ibm-plex-sans-latin-868a235a.woff2': 'e2291e842cf5af16',
  'ibm-plex-sans-latin-ext-632855d1.woff2': 'd160e20920ae4d65',
  'overpass-latin-d8f2e7a3.woff2': '29217ef8adef5f6c',
  'overpass-latin-ext-d15538c4.woff2': '0a1c9727f08b9125',
};

describe('fonts never change under the same name', () => {
  const dir = new URL('../public/fonts/', import.meta.url);
  const fonts = readdirSync(dir).filter((f) => f !== 'OFL.txt');

  it('every font file is listed with its fingerprint', () => {
    assert.deepEqual([...fonts].sort(), Object.keys(FONT_FINGERPRINTS).sort());
  });

  it('every font still has the content it had when it got its name', () => {
    for (const f of fonts) {
      const sha = createHash('sha256').update(readFileSync(new URL(f, dir))).digest('hex').slice(0, 16);
      assert.equal(sha, FONT_FINGERPRINTS[f], `${f} changed in place: browsers keep /fonts/* for a year, so save it under a new name`);
    }
  });
});
