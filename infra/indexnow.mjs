#!/usr/bin/env node
/**
 * Tells IndexNow (Bing, Yandex, Seznam, Naver, …) which pages are new or changed, so they are
 * recrawled without anyone pasting URLs into Bing Webmaster Tools. Google does not take part.
 *
 *   node infra/indexnow.mjs [--state infra/indexnow-state.json] [--data-base https://data…/v1/] [--dry-run]
 *
 * What counts as changed, compared with the state of the previous successful run:
 *   - a URL in the live sitemap that was not there before (first run: every URL), and
 *   - a road or gemeente page whose data file (roads/<slug>.json, gemeenten/<slug>.json in the
 *     published data manifest) has a different hash.
 * Only URLs that are in the sitemap are ever sent. The state is written only after every batch
 * was accepted, so a failed run is simply repeated in full by the next one.
 *
 * The key is public by design: it lives in web/site.config.json (`indexnow.key`) and is served
 * as /<key>.txt (web/public), which is how the search engines verify the site is ours.
 *
 * Exit codes: 0 ok (also when there was nothing to send) · 1 submission or fetch failed · 2 usage/config error.
 */
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENDPOINT = 'https://api.indexnow.org/indexnow';
export const MAX_URLS_PER_REQUEST = 10_000;
const ATTEMPTS = 4;
const RETRY_BASE_MS = 5_000;
const ENTITY_PAGES = Object.freeze({ roads: 'weg', gemeenten: 'gemeente' });
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const FETCH_TIMEOUT_MS = 30_000;
const XML_ENTITIES = Object.freeze({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" });

/** `<loc>` values of a sitemap: page URLs from a urlset, child sitemaps from a sitemap index. */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) =>
    m[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e]),
  );
  return /<sitemapindex[\s>]/.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

/** `roads/a2.json` → `<site>/weg/a2/`; any other data file → null. */
export function entityPage(path, siteUrl) {
  const m = /^(roads|gemeenten)\/([^/]+)\.json$/.exec(path);
  return m ? `${siteUrl.replace(/\/+$/, '')}/${ENTITY_PAGES[m[1]]}/${m[2]}/` : null;
}

/** Only the data files that have a page; the rest of the manifest changes every run and is noise. */
export function entityHashes(manifest) {
  return Object.fromEntries(Object.entries(manifest).filter(([path]) => entityPage(path, 'https://x') !== null));
}

/**
 * The URLs to report. Without a previous state everything in the sitemap is new.
 * @returns {{ urls: string[] }}
 */
export function selectUrls({ state, sitemapUrls, manifest, siteUrl }) {
  if (!state) return { urls: [...sitemapUrls] };
  const inSitemap = new Set(sitemapUrls);
  const known = new Set(state.urls ?? []);
  const prev = state.manifest ?? {};
  const picked = new Set(sitemapUrls.filter((u) => !known.has(u)));
  for (const [path, sha] of Object.entries(manifest)) {
    if (prev[path] === sha) continue;
    const page = entityPage(path, siteUrl);
    if (page && inSitemap.has(page)) picked.add(page);
  }
  return { urls: [...picked] };
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** POSTs the URLs in batches. Retries 429/5xx/network errors; any other non-2xx is fatal. */
export async function submit({ urls, siteUrl, key, fetchImpl = fetch, sleep = defaultSleep, log = () => {} }) {
  const site = new URL(siteUrl);
  for (const [n, urlList] of chunk(urls, MAX_URLS_PER_REQUEST).entries()) {
    const body = JSON.stringify({ host: site.host, key, keyLocation: `${site.origin}/${key}.txt`, urlList });
    for (let attempt = 1; ; attempt++) {
      let res;
      let detail;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (res.ok) break;
        detail = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      } catch (err) {
        detail = `network error: ${err.message}`;
      }
      const retryable = !res || res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= ATTEMPTS) throw new Error(`IndexNow rejected batch ${n + 1} (${urlList.length} URLs) — ${detail}`);
      log(`batch ${n + 1}: ${detail}; retry ${attempt}/${ATTEMPTS - 1}`);
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
    log(`batch ${n + 1}: ${urlList.length} URLs accepted`);
  }
}

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

/** All page URLs of the live sitemap, following a sitemap index one level deep. */
async function loadSitemapUrls(siteUrl, fetchImpl) {
  const root = parseSitemap(await fetchText(`${siteUrl.replace(/\/+$/, '')}/sitemap.xml`, fetchImpl));
  const urls = [...root.urls];
  for (const child of root.sitemaps) urls.push(...parseSitemap(await fetchText(child, fetchImpl)).urls);
  return urls;
}

export async function run({ siteUrl, dataBase, key, fetchImpl = fetch, sleep, loadState, saveState, log = console.log, dryRun = false }) {
  const sitemapUrls = await loadSitemapUrls(siteUrl, fetchImpl);
  if (sitemapUrls.length === 0) throw new Error('the sitemap has no URLs; refusing to record an empty state');
  const manifest = entityHashes(JSON.parse(await fetchText(new URL('manifest.json', dataBase).href, fetchImpl)));
  const state = await loadState();
  const { urls } = selectUrls({ state, sitemapUrls, manifest, siteUrl });
  log(`${sitemapUrls.length} URLs in the sitemap; ${urls.length} new or changed${state ? '' : ' (first run: all)'}`);
  if (dryRun) {
    for (const u of urls.slice(0, 20)) log(`  ${u}`);
    return { submitted: 0, selected: urls.length };
  }
  if (urls.length > 0) await submit({ urls, siteUrl, key, fetchImpl, sleep, log });
  await saveState({ urls: sitemapUrls, manifest });
  return { submitted: urls.length, selected: urls.length };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { values } = parseArgs({
    options: {
      state: { type: 'string', default: resolve(root, 'infra/indexnow-state.json') },
      'data-base': { type: 'string', default: process.env.DATA_BASE?.trim() || '' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const config = JSON.parse(await readFile(resolve(root, 'web/site.config.json'), 'utf8'));
  const key = config.indexnow?.key;
  const dataBase = values['data-base'];
  if (!/^[0-9a-f]{8,128}$/i.test(key ?? '')) return fail('web/site.config.json has no valid indexnow.key', EXIT_USAGE);
  if (!/^https:\/\/.+\/$/.test(dataBase)) return fail('pass --data-base or DATA_BASE, e.g. https://data.example.nl/v1/', EXIT_USAGE);

  try {
    const result = await run({
      siteUrl: config.url,
      dataBase,
      key,
      dryRun: values['dry-run'],
      loadState: async () => {
        try {
          return JSON.parse(await readFile(values.state, 'utf8'));
        } catch (err) {
          if (err.code === 'ENOENT') return null;
          throw err;
        }
      },
      saveState: (s) => writeFile(values.state, `${JSON.stringify({ urls: [...s.urls].sort(), manifest: s.manifest })}\n`),
    });
    console.log(`IndexNow: ${result.submitted} URLs reported.`);
  } catch (err) {
    fail(err.message, EXIT_FAILED);
  }
}

function fail(message, code) {
  console.error(`::error::IndexNow: ${message}`);
  process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
