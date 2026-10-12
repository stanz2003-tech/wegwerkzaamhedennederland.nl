import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_URLS_PER_REQUEST,
  chunk,
  entityHashes,
  entityPage,
  parseSitemap,
  run,
  selectUrls,
  submit,
} from '../indexnow.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = 'https://www.example.nl';

test('the key in site.config.json is published as /<key>.txt with exactly the key', () => {
  const config = JSON.parse(readFileSync(resolve(ROOT, 'web/site.config.json'), 'utf8'));
  const key = config.indexnow?.key;
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(readFileSync(resolve(ROOT, 'web/public', `${key}.txt`), 'utf8'), key);
});

test('parseSitemap reads <loc> values from a urlset and from a sitemap index', () => {
  const urlset = '<urlset><url><loc>https://a/x/</loc></url><url><loc>https://a/y/</loc></url></urlset>';
  assert.deepEqual(parseSitemap(urlset), { urls: ['https://a/x/', 'https://a/y/'], sitemaps: [] });
  const index = '<sitemapindex><sitemap><loc>https://a/sitemap-1.xml</loc></sitemap></sitemapindex>';
  assert.deepEqual(parseSitemap(index), { urls: [], sitemaps: ['https://a/sitemap-1.xml'] });
});

test('entityPage maps road and gemeente data files to their pages, and nothing else', () => {
  assert.equal(entityPage('roads/a2.json', SITE), `${SITE}/weg/a2/`);
  assert.equal(entityPage('gemeenten/s-gravenhage.json', SITE), `${SITE}/gemeente/s-gravenhage/`);
  assert.equal(entityPage('detail/00.json', SITE), null);
  assert.equal(entityPage('roads/sub/x.json', SITE), null);
});

test('first run (no state) submits every sitemap URL', () => {
  const sitemap = [`${SITE}/`, `${SITE}/weg/a2/`];
  const { urls } = selectUrls({ state: null, sitemapUrls: sitemap, manifest: { 'roads/a2.json': 'h1' }, siteUrl: SITE });
  assert.deepEqual(urls, sitemap);
});

test('later runs submit only new pages and pages whose data file changed', () => {
  const state = {
    urls: [`${SITE}/`, `${SITE}/weg/a2/`, `${SITE}/weg/a4/`, `${SITE}/gemeente/breda/`],
    manifest: { 'roads/a2.json': 'h1', 'roads/a4.json': 'h2', 'gemeenten/breda.json': 'h3', 'detail/00.json': 'd' },
  };
  const sitemapUrls = [...state.urls, `${SITE}/weg/a12/`];
  const manifest = {
    'roads/a2.json': 'CHANGED',
    'roads/a4.json': 'h2',
    'gemeenten/breda.json': 'h3',
    'roads/a12.json': 'new',
    'roads/n999.json': 'no page for this one',
    'detail/00.json': 'also changed, but not a page',
  };
  const { urls } = selectUrls({ state, sitemapUrls, manifest, siteUrl: SITE });
  assert.deepEqual(urls.sort(), [`${SITE}/weg/a12/`, `${SITE}/weg/a2/`]);
});

test('chunk splits into pieces of at most the IndexNow limit', () => {
  assert.equal(MAX_URLS_PER_REQUEST, 10_000);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
});

function fakeFetch(statuses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const status = statuses.shift() ?? 200;
    return { status, ok: status >= 200 && status < 300, text: async () => `status ${status}` };
  };
  return { fn, calls };
}

test('submit posts host, key, keyLocation and the URL list; 200 and 202 count as accepted', async () => {
  const { fn, calls } = fakeFetch([202]);
  await submit({ urls: [`${SITE}/weg/a2/`], siteUrl: SITE, key: 'k'.repeat(32), fetchImpl: fn, sleep: async () => {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.indexnow.org/indexnow');
  assert.deepEqual(calls[0].body, {
    host: 'www.example.nl',
    key: 'k'.repeat(32),
    keyLocation: `${SITE}/${'k'.repeat(32)}.txt`,
    urlList: [`${SITE}/weg/a2/`],
  });
});

test('submit retries 429 and 5xx, but fails fast on a rejected key (403) or bad URLs (422)', async () => {
  const retried = fakeFetch([429, 503, 200]);
  await submit({ urls: ['u'], siteUrl: SITE, key: 'k', fetchImpl: retried.fn, sleep: async () => {} });
  assert.equal(retried.calls.length, 3);

  for (const status of [403, 422]) {
    const rejected = fakeFetch([status]);
    await assert.rejects(
      submit({ urls: ['u'], siteUrl: SITE, key: 'k', fetchImpl: rejected.fn, sleep: async () => {} }),
      new RegExp(String(status)),
    );
    assert.equal(rejected.calls.length, 1);
  }
});

test('run saves the new state only after every batch was accepted', async () => {
  const pages = { '/sitemap.xml': `<urlset><url><loc>${SITE}/weg/a2/</loc></url></urlset>` };
  const manifest = { 'roads/a2.json': 'h1' };
  const make = (postStatus) => async (url, init) => {
    if (init?.method === 'POST') return { status: postStatus, ok: postStatus < 300, text: async () => '' };
    const body = url.endsWith('manifest.json') ? JSON.stringify(manifest) : pages[new URL(url).pathname];
    return { status: 200, ok: true, text: async () => body, json: async () => JSON.parse(body) };
  };
  let saved = null;
  const io = { loadState: async () => null, saveState: async (s) => { saved = s; }, log: () => {} };
  const args = { siteUrl: SITE, dataBase: 'https://data.example.nl/v1/', key: 'k', sleep: async () => {} };

  await assert.rejects(run({ ...args, fetchImpl: make(403), ...io }));
  assert.equal(saved, null);

  const result = await run({ ...args, fetchImpl: make(200), ...io });
  assert.equal(result.submitted, 1);
  assert.deepEqual(saved, { urls: [`${SITE}/weg/a2/`], manifest });
});

test('run with nothing to report makes no POST but still records the state', async () => {
  const sitemap = `<urlset><url><loc>${SITE}/</loc></url></urlset>`;
  let posts = 0;
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') posts++;
    const body = url.endsWith('manifest.json') ? '{}' : sitemap;
    return { status: 200, ok: true, text: async () => body, json: async () => JSON.parse(body) };
  };
  let saved = null;
  const result = await run({
    siteUrl: SITE, dataBase: 'https://data.example.nl/v1/', key: 'k', fetchImpl, sleep: async () => {},
    loadState: async () => ({ urls: [`${SITE}/`], manifest: {} }), saveState: async (s) => { saved = s; }, log: () => {},
  });
  assert.equal(result.submitted, 0);
  assert.equal(posts, 0);
  assert.deepEqual(saved, { urls: [`${SITE}/`], manifest: {} });
});

test('parseSitemap unescapes XML entities in URLs', () => {
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://a/?x=1&amp;y=2</loc></url></urlset>').urls, ['https://a/?x=1&y=2']);
});

test('entityHashes keeps only the data files that have a page', () => {
  assert.deepEqual(entityHashes({ 'roads/a2.json': 'a', 'gemeenten/ede.json': 'b', 'detail/00.json': 'c', 'meta.json': 'd' }), {
    'roads/a2.json': 'a',
    'gemeenten/ede.json': 'b',
  });
});
