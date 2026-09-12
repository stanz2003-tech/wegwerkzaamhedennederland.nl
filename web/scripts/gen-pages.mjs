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
 * Never throws on missing data: it warns and keeps going.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { loadPartials, loadTemplates } from './lib/render.mjs';
import { PAGE_TYPES, buildModel, outFileFor, renderPage, samplePages } from './lib/pages.mjs';
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

  const model = buildModel({ webRoot, repoRoot, listsDir: opts.lists, warn });
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

  // sitemap, robots, ads.txt
  const lastmod = model.buildIso.slice(0, 10);
  const sitemaps = buildSitemaps(sitemapEntries, { siteUrl: model.site.url, lastmod });
  for (const f of sitemaps) writeFile(join(outDir, f.name), f.xml);
  const disallow = existsSync(join(outDir, 'data')) ? ['/data/'] : [];
  writeFile(join(outDir, 'robots.txt'), buildRobots({ siteUrl: model.site.url, disallow }));
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
  if (!opts.quiet) {
    console.log(
      `[gen-pages] + lijsten ${written.list}, statisch ${written.static}; sitemap ${sitemaps.length > 1 ? `${sitemaps.length - 1} delen + index` : '1 bestand'} (${sitemapEntries.length} URL's); ` +
        `robots.txt${adsTxt ? ', ads.txt' : ''}; lijsten gekopieerd: ${copiedDist.length ? copiedDist.join(', ') : 'geen (sample)'}; ` +
        `shells: ${shellDir === sourceTemplates ? 'bron' : 'dist'}; ${failures} fouten; ${ms} ms → ${outDir}`,
    );
  }
  return { pages: total, written, placeKinds, failures, ms, outDir, model, warnings, sitemaps: sitemaps.length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
  } else {
    try {
      const result = generate(opts);
      if (result.error) process.exitCode = 1;
    } catch (err) {
      console.error(`[gen-pages] onverwachte fout: ${err.stack ?? err.message}`);
      process.exitCode = 1;
    }
  }
}
