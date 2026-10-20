#!/usr/bin/env node
/**
 * Page generator for Wegwerk (owner C). See docs/build-contracts.md → "Generator".
 *
 *   node scripts/gen-pages.mjs --dist              after `vite build`: stamp all pages into web/dist
 *   node scripts/gen-pages.mjs --out <dir>         render from the source templates into <dir>
 *   node scripts/gen-pages.mjs --out <dir> --sample   ≈ 30 representative pages for inspection
 *   node scripts/gen-pages.mjs --lists <dir>       use the static lists from <dir> (testing)
 *   node scripts/gen-pages.mjs                     dry run: copy the static lists to public/lists and report
 *
 * With `DATA_BASE` set (the Deploy workflow does):
 *   - road and place pages get the morning's answer, count and first roadworks in their HTML
 *     (lib/snapshot.mjs), which the page script replaces with the live data;
 *   - place and bridge pages without anything to show for 60 days get noindex and leave the
 *     sitemap (lib/activity.mjs, lib/index-state.mjs; the memory is /index-state.json on the site).
 *
 * Never throws on missing data: it warns and keeps going.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { buildActivity, loadLiveFiles } from './lib/activity.mjs';
import { INDEX_STATE_FILE, loadIndexState, serializeIndexState } from './lib/index-state.mjs';
import { loadLists } from './lib/lists.mjs';
import { createSnapshotter, loadEntityFiles, loadSnapshotModules } from './lib/snapshot.mjs';
import { loadPartials, loadTemplates } from './lib/render.mjs';
import { ENTITY_MANIFEST_FILE, PAGE_TYPES, buildEntityManifest, buildModel, loadSite, outFileFor, renderPage, samplePages } from './lib/pages.mjs';
import { copyLists } from './lib/lists.mjs';
import { buildAdsTxt, buildRobots, buildSitemaps } from './lib/sitemap.mjs';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(webRoot);

function parseArgs(argv) {
  const opts = { dist: false, out: null, sample: false, lists: null, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dist') opts.dist = true;
    else if (a === '--sample') opts.sample = true;
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a.startsWith('--out=')) opts.out = a.slice(6);
    else if (a === '--lists') opts.lists = argv[++i];
    else if (a.startsWith('--lists=')) opts.lists = a.slice(8);
    else console.warn(`[gen-pages] onbekende optie ${a} genegeerd`);
  }
  return opts;
}

function usage() {
  console.log(`Gebruik: node scripts/gen-pages.mjs [--dist] [--out <map>] [--sample] [--lists <map>] [--quiet]`);
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function generate(opts) {
  const t0 = performance.now();
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    if (!opts.quiet) console.warn(msg);
  };

  const outDir = opts.out ? resolve(opts.out) : opts.dist ? join(webRoot, 'dist') : null;
  const sourceTemplates = join(webRoot, 'templates');
  let shellDir = sourceTemplates;
  if (opts.dist) {
    const built = join(webRoot, 'dist', 'templates');
    if (existsSync(built)) shellDir = built;
    else warn(`[gen-pages] ${built} ontbreekt (is 'vite build' gedraaid?) – brontemplates gebruikt, zonder gebundelde assets`);
  }

  const model = buildModel({
    webRoot, repoRoot, listsDir: opts.lists, warn,
    activity: opts.activity ?? null,
    indexState: opts.indexState ?? null,
    indexStateFailed: opts.indexStateFailed === true,
    snapshotFor: opts.snapshotFor ?? null,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const publicLists = join(webRoot, 'public', 'lists');

  if (!outDir) {
    const copied = copyLists({ repoRoot, webRoot, listsDir: opts.lists, destDir: publicLists, warn });
    console.log(
      `[gen-pages] dry run: ${model.pages.length} routes (wegen ${model.counts.roads}, plaatsen ${model.counts.woonplaatsen}, gemeenten ${model.counts.gemeenten}, bruggen ${model.counts.bridges}); ` +
        `lijsten: ${Object.entries(model.lists.sources).map(([f, s]) => `${f}=${s === 'sample' ? 'sample' : 'bestand'}`).join(', ')}; ` +
        `gekopieerd naar public/lists: ${copied.length ? copied.join(', ') : 'niets'}`,
    );
    return { pages: 0, model, warnings };
  }

  const partials = loadPartials(sourceTemplates, { warn });
  let templates = {};
  let missing = [];
  try {
    ({ templates, missing } = loadTemplates(shellDir, partials, PAGE_TYPES));
  } catch (err) {
    warn(`[gen-pages] ${err.message}`);
    return { pages: 0, model, warnings, error: err };
  }
  for (const type of missing) warn(`[gen-pages] shell ${shellDir}/${type}.html ontbreekt – pagina's van type '${type}' overgeslagen`);

  const pages = opts.sample ? samplePages(model) : model.pages;
  const written = { road: 0, place: 0, bridge: 0, list: 0, static: 0 };
  const placeKinds = { woonplaats: 0, gemeente: 0 };
  let failures = 0;
  const sitemapEntries = [{ path: '/', priority: 1.0, changefreq: 'hourly' }];

  for (const page of pages) {
    if (!templates[page.type]) continue;
    try {
      const html = renderPage(page, model, templates);
      writeFile(join(outDir, outFileFor(page)), html);
      written[page.type]++;
      if (page.kind) placeKinds[page.kind]++;
      if (page.sitemap) sitemapEntries.push({ path: page.path, priority: page.priority, changefreq: page.changefreq });
    } catch (err) {
      failures++;
      if (failures <= 10) warn(`[gen-pages] ${page.path}: ${err.message}`);
    }
  }
  if (failures > 10) warn(`[gen-pages] … en nog ${failures - 10} mislukte pagina's`);

  // sitemap, robots, entity manifest, ads.txt
  const lastmod = model.buildIso.slice(0, 10);
  const sitemaps = buildSitemaps(sitemapEntries, { siteUrl: model.site.url, lastmod });
  for (const f of sitemaps) writeFile(join(outDir, f.name), f.xml);
  // `/?id=…` deep links (one per roadwork, from every list) only reopen the map on one item and
  // canonicalise to `/`; Google crawled them as redirects and spent its budget there instead of on
  // the 3.900 content pages. Items also expire, so these URLs go stale by design.
  const disallow = [...(existsSync(join(outDir, 'data')) ? ['/data/'] : []), '/*?id='];
  writeFile(join(outDir, 'robots.txt'), buildRobots({ siteUrl: model.site.url, disallow }));
  // Which entity pages exist, for the map's place mode and its links (web/src/data/entity-pages.ts).
  writeFile(join(outDir, ENTITY_MANIFEST_FILE), JSON.stringify(buildEntityManifest(model)));
  // The memory of the noindex decision, read back by the next build (lib/index-state.mjs).
  writeFile(join(outDir, INDEX_STATE_FILE), serializeIndexState(model.lastActive, model.buildIso));
  // Cloudflare Pages redirects: woonplaatsen whose page is the gemeente page (pages.mjs).
  writeFile(join(outDir, '_redirects'), buildRedirects(model.redirects));
  let adsTxt = false;
  if (model.site.ads?.enabled) {
    const txt = buildAdsTxt(model.site.ads.adsenseClient);
    if (txt) {
      writeFile(join(outDir, 'ads.txt'), txt);
      adsTxt = true;
    } else warn('[gen-pages] ads.enabled staat aan maar adsenseClient is geen geldig pub-id – ads.txt niet geschreven');
  }

  // static lists → dist/lists (and public/lists for dev when building for real)
  const copiedDist = copyLists({ repoRoot, webRoot, listsDir: opts.lists, destDir: join(outDir, 'lists'), warn });
  if (opts.dist) copyLists({ repoRoot, webRoot, listsDir: opts.lists, destDir: publicLists, warn });

  if (opts.dist) {
    try {
      rmSync(join(webRoot, 'dist', 'templates'), { recursive: true, force: true });
    } catch (err) {
      warn(`[gen-pages] dist/templates kon niet worden verwijderd: ${err.message}`);
    }
  }

  const total = Object.values(written).reduce((a, b) => a + b, 0);
  const ms = Math.round(performance.now() - t0);
  console.log(`${total} pagina's gegenereerd (wegen ${written.road}, plaatsen ${placeKinds.woonplaats}, gemeenten ${placeKinds.gemeente}, bruggen ${written.bridge})`);
  console.log(activitySummary(model, opts.activity));
  if (!opts.quiet) {
    console.log(
      `[gen-pages] + lijsten ${written.list}, statisch ${written.static}; sitemap ${sitemaps.length > 1 ? `${sitemaps.length - 1} delen + index` : '1 bestand'} (${sitemapEntries.length} URL's); ` +
        `robots.txt, ${ENTITY_MANIFEST_FILE}${adsTxt ? ', ads.txt' : ''}; lijsten gekopieerd: ${copiedDist.length ? copiedDist.join(', ') : 'geen (sample)'}; ` +
        `shells: ${shellDir === sourceTemplates ? 'bron' : 'dist'}; ${failures} fouten; ${ms} ms → ${outDir}`,
    );
  }
  return { pages: total, written, placeKinds, failures, ms, outDir, model, warnings, sitemaps: sitemaps.length };
}

/**
 * `_redirects` for Cloudflare Pages: both spellings of each path, 301. Pages allows 2.000 static
 * redirects; there are about 150 lines.
 */
export function buildRedirects(redirects) {
  const lines = ['# Generated by web/scripts/gen-pages.mjs – do not edit.'];
  for (const { from, to } of redirects) {
    lines.push(`${from} ${to} 301`);
    lines.push(`${from.replace(/\/$/, '')} ${to} 301`);
  }
  return `${lines.join('\n')}\n`;
}

/** One line for the build log: how many pages left Google because they have nothing to show. */
function activitySummary(model, activity) {
  if (!activity) return "[gen-pages] geen live data (DATA_BASE niet gezet of niet bereikbaar): alle pagina's indexeerbaar";
  const thin = model.pages.filter((p) => p.thin);
  const of = (pred) => thin.filter(pred).length;
  return (
    `[gen-pages] live data ${activity.generated ?? '?'} (${activity.rows} meldingen): ${thin.length} pagina's al lang zonder meldingen krijgen noindex ` +
    `(plaatsen ${of((p) => p.kind === 'woonplaats')}, gemeenten ${of((p) => p.kind === 'gemeente')}, bruggen ${of((p) => p.type === 'bridge')})`
  );
}

/**
 * Everything the build reads from outside the repository: the live data (activity + snapshots)
 * and the noindex memory of the previous deploy. Without DATA_BASE: nothing, as before.
 */
async function loadLive(opts) {
  const dataBase = process.env.DATA_BASE ?? '';
  if (!dataBase) return { activity: null };
  const now = new Date();
  // The memory is read even when the data is down, so that this build carries it over intact.
  const site = loadSite(webRoot);
  const [files, memory] = await Promise.all([
    loadLiveFiles({ dataBase, warn: console.warn }),
    loadIndexState({ siteUrl: site.url, warn: console.warn }),
  ]);
  const state = { indexState: memory.state, indexStateFailed: memory.status === 'failed', now };
  const activity = files ? buildActivity(files, { warn: console.warn }) : null;
  // Data the build does not believe gives no snapshot either: "Niets gemeld" from a broken index
  // would be the very false fact the snapshot exists to avoid.
  if (!activity) return { activity: null, ...state };
  let snapshotFor = null;
  try {
    const t0 = performance.now();
    const mods = await loadSnapshotModules();
    const lists = loadLists({ repoRoot, webRoot, listsDir: opts.lists, warn: console.warn });
    const entityFiles = await loadEntityFiles({
      dataBase,
      roads: lists.roads.map((r) => r.slug),
      gemeenten: lists.gemeenten.map((g) => g.slug),
      isEntityFile: mods.load.isEntityFile,
      warn: console.warn,
    });
    snapshotFor = createSnapshotter({ mods, live: files, files: entityFiles, now: now.getTime() });
    console.log(`[gen-pages] momentopname: ${lists.roads.length + lists.gemeenten.length} entiteitsbestanden in ${Math.round(performance.now() - t0)} ms (${entityFiles.failed} niet geladen)`);
  } catch (err) {
    console.warn(`[gen-pages] momentopname niet gemaakt (${err?.message ?? err}) – pagina's zonder meldingen in de HTML`);
  }
  return { activity, snapshotFor, ...state };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
  } else {
    try {
      const writes = Boolean(opts.out || opts.dist) && !opts.sample;
      const live = writes ? await loadLive(opts) : {};
      const result = generate({ ...opts, ...live });
      if (result.error) process.exitCode = 1;
    } catch (err) {
      console.error(`[gen-pages] onverwachte fout: ${err.stack ?? err.message}`);
      process.exitCode = 1;
    }
  }
}
