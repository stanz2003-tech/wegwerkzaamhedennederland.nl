/**
 * Page model: every generated route with its type, template variables, metadata and JSON-LD.
 * Used by `gen-pages.mjs` (build) and `dev-pages-plugin.mjs` (on-request rendering).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { markdownToHtml, parseFrontMatter, splitSections, stripMarkdown } from './markdown.mjs';
import { escapeHtml, protectEmails } from './render.mjs';
import { isThinPage, normalizeName } from './activity.mjs';
import { decideThin } from './index-state.mjs';
import { loadLists, nearestByCentroid, nearestRoads } from './lists.mjs';
import { renderBruggenList, renderPlaatsenList, renderWegenList } from './fragments.mjs';
import { placesAlongRoad, roadPlacesFor, roadsThroughPlace } from './road-places.mjs';
import {
  alwaysIndexedBridge, bridgesInPlace, bridgesOnRoad, isRoadBridge, loadBridgeExtras, roadBridgeDescription, roadBridgeFaq, roadBridgeTitle, roadBridgeVars,
} from './bridge-pages.mjs';
import {
  PLANNING_REFRESH_MINUTES,
  bridgeDescription, bridgeFaq, bridgeIntro, bridgeTitle, bridgeVariants,
  clampText, fmtDate, fmtDateTime, hasSameNameKern, mapHref,
  placeDescription, placeFaq, placeHeading, placeIntro, placeTitle, publisherVars,
  roadDescription, roadFaq, roadIntro, roadKind, roadTitle, todayLabel, weekendLabel,
} from './text.mjs';

export const PAGE_TYPES = ['road', 'place', 'bridge', 'list', 'static'];

/** Content slug → URL and `data-list` value. Order = navigation order. */
export const LIST_ROUTES = [
  { slug: 'afsluitingen', path: '/afsluitingen/', list: 'afsluitingen', priority: 0.9, changefreq: 'hourly' },
  { slug: 'files', path: '/files/', list: 'files', priority: 0.9, changefreq: 'hourly' },
  { slug: 'vandaag', path: '/vandaag/', list: 'vandaag', priority: 0.9, changefreq: 'hourly' },
  { slug: 'dit-weekend', path: '/dit-weekend/', list: 'weekend', priority: 0.9, changefreq: 'daily' },
  { slug: 'wegen', path: '/wegen/', list: 'wegen', priority: 0.8, changefreq: 'weekly' },
  { slug: 'plaatsen', path: '/plaatsen/', list: 'plaatsen', priority: 0.7, changefreq: 'weekly' },
  { slug: 'bruggen', path: '/bruggen/', list: 'bruggen', priority: 0.7, changefreq: 'weekly' },
];

const MAIN_STATIC = new Set(['over', 'veelgestelde-vragen', 'uitleg']);

export const STATIC_ROUTES = ['over', 'veelgestelde-vragen', 'uitleg', 'wijzigingen', 'privacy', 'cookies', 'disclaimer', 'colofon', 'contact'].map((slug) => ({
  slug,
  path: `/${slug}/`,
  priority: MAIN_STATIC.has(slug) ? 0.5 : 0.3,
  changefreq: 'monthly',
}));

/**
 * The guides under /uitleg/: written by hand, one `content/uitleg-<name>.md` each, so the site has
 * more to read than the generated pages. Order = order on the /uitleg/ page and in the sitemap.
 */
export const GUIDE_ROUTES = ['meldingen-lezen', 'omrijden', 'weekend-en-nachtafsluitingen', 'waar-komt-de-data-vandaan'].map((name) => ({
  slug: `uitleg-${name}`,
  path: `/uitleg/${name}/`,
  parent: { name: 'Uitleg', href: '/uitleg/' },
  priority: 0.5,
  changefreq: 'monthly',
}));

export const NOT_FOUND_SLUG = 'niet-gevonden';

/* ------------------------------------------------------------------------------------------ */
/* Loading                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export function loadSite(webRoot) {
  return JSON.parse(readFileSync(join(webRoot, 'site.config.json'), 'utf8'));
}

/** `web/content/*.md` → Map<slug, {data, body}> (slug = front matter `slug` or file name). */
export function loadContent(webRoot, warn = console.warn) {
  const dir = join(webRoot, 'content');
  const map = new Map();
  if (!existsSync(dir)) {
    warn(`[gen-pages] map ${dir} ontbreekt – geen contentpagina's`);
    return map;
  }
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    try {
      const { data, body } = parseFrontMatter(readFileSync(join(dir, file), 'utf8'));
      const slug = data.slug || file.replace(/\.md$/, '');
      map.set(slug, { data, body, file });
    } catch (err) {
      warn(`[gen-pages] content/${file}: ${err.message}`);
    }
  }
  return map;
}

/* ------------------------------------------------------------------------------------------ */
/* Model                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/**
 * Woonplaatsen whose page would repeat the gemeente page: the only woonplaats of a gemeente with
 * the same name (Alblasserdam, 's-Gravenhage: 74 of them). Both pages showed exactly the same
 * roadworks and competed for the same searches, so the gemeente page owns the name and the
 * woonplaats URL redirects to it (301, `_redirects`).
 * @returns {Map<object, object>} woonplaats → its gemeente
 */
export function mergedWoonplaatsen(gemeenten, woonplaatsenByGemeente) {
  const merged = new Map();
  for (const g of gemeenten) {
    const own = woonplaatsenByGemeente.get(g.code) ?? [];
    if (own.length === 1 && normalizeName(own[0].naam) === normalizeName(g.naam)) merged.set(own[0], g);
  }
  return merged;
}

/**
 * `activity` (activity.mjs, from the live data) says which place and bridge pages have nothing to
 * show today (since 2026-11-12 also N- and S-road pages; A-roads always stay indexed); with
 * `indexState` (index-state.mjs: last day with activity per path, from the
 * previous deploy) a page only becomes `thin` (noindex, follow, out of the sitemap, no ads) after
 * 60 days without anything. Until then it is `quiet`: still indexed, but without ads, because an
 * ad next to "Niets gemeld" is what an AdSense reviewer calls a page without content.
 * Without activity every page is indexable and may carry ads.
 * `snapshotFor` (snapshot.mjs) gives road and place pages their server-visible content.
 */
export function buildModel({ webRoot, repoRoot, listsDir, activity = null, indexState = null, indexStateFailed = false, snapshotFor = null, now = new Date(), warn = console.warn }) {
  const site = loadSite(webRoot);
  const lists = loadLists({ repoRoot, webRoot, listsDir, warn });
  const content = loadContent(webRoot, warn);

  const woonplaatsenByGemeente = new Map();
  for (const w of lists.woonplaatsen) {
    const key = w.gemeenteCode ?? w.gemeente;
    if (!woonplaatsenByGemeente.has(key)) woonplaatsenByGemeente.set(key, []);
    woonplaatsenByGemeente.get(key).push(w);
  }
  const gemeenteByCode = new Map(lists.gemeenten.map((g) => [g.code, g]));
  const gemeenteByName = new Map(lists.gemeenten.map((g) => [g.naam.toLowerCase(), g]));
  const merged = mergedWoonplaatsen(lists.gemeenten, woonplaatsenByGemeente);
  const roadBySlug = new Map(lists.roads.map((r) => [r.slug, r]));
  const roadByNumber = new Map(lists.roads.map((r) => [r.road.toUpperCase(), r]));
  const bridgesByGemeente = new Map();
  const bridgesByProv = new Map();
  for (const b of lists.bridges) {
    if (b.gemeente) {
      if (!bridgesByGemeente.has(b.gemeente)) bridgesByGemeente.set(b.gemeente, []);
      bridgesByGemeente.get(b.gemeente).push(b);
    }
    const prov = b.prov ?? '_';
    if (!bridgesByProv.has(prov)) bridgesByProv.set(prov, []);
    bridgesByProv.get(prov).push(b);
  }

  const routes = [];
  for (const r of lists.roads) {
    routes.push({
      type: 'road', path: `/weg/${r.slug}/`, entity: r, sitemap: true,
      priority: r.type === 'A' ? 0.8 : r.type === 'N' ? 0.6 : 0.5, changefreq: 'daily',
    });
  }
  for (const g of lists.gemeenten) {
    routes.push({ type: 'place', kind: 'gemeente', path: `/gemeente/${g.slug}/`, entity: g, sitemap: true, priority: 0.6, changefreq: 'daily' });
  }
  const redirects = [];
  for (const w of lists.woonplaatsen) {
    const owner = merged.get(w);
    if (owner) {
      redirects.push({ from: `/plaats/${w.slug}/`, to: `/gemeente/${owner.slug}/` });
      continue;
    }
    routes.push({ type: 'place', kind: 'woonplaats', path: `/plaats/${w.slug}/`, entity: w, sitemap: true, priority: 0.5, changefreq: 'daily' });
  }
  const bridgeExtras = loadBridgeExtras(webRoot, warn);
  for (const b of lists.bridges) {
    // A bridge in a road reads its road's file and the file of its gemeente (snapshot.mjs, bridge-road.ts).
    const road = isRoadBridge(b) ? roadByNumber.get(b.road.toUpperCase()) ?? null : null;
    const gemeente = b.gemeente ? gemeenteByName.get(b.gemeente.toLowerCase()) ?? null : null;
    routes.push({
      type: 'bridge', path: `/brug/${b.slug}/`, entity: b, sitemap: true, priority: isRoadBridge(b) ? 0.6 : 0.5, changefreq: 'daily',
      ...(isRoadBridge(b) ? { roadSlug: road?.slug ?? null, roadType: road?.type ?? null, gemeenteSlug: gemeente?.slug ?? null } : {}),
    });
  }
  for (const l of LIST_ROUTES) {
    if (!content.has(l.slug)) warn(`[gen-pages] content/${l.slug}.md ontbreekt – lijstpagina ${l.path} krijgt standaardtekst`);
    routes.push({ type: 'list', path: l.path, slug: l.slug, list: l.list, sitemap: true, priority: l.priority, changefreq: l.changefreq });
  }
  for (const s of [...STATIC_ROUTES, ...GUIDE_ROUTES]) {
    if (!content.has(s.slug)) {
      warn(`[gen-pages] content/${s.slug}.md ontbreekt – pagina ${s.path} overgeslagen`);
      continue;
    }
    routes.push({ type: 'static', path: s.path, slug: s.slug, parent: s.parent, sitemap: true, priority: s.priority, changefreq: s.changefreq });
  }
  routes.push({ type: 'static', path: '/404.html', slug: NOT_FOUND_SLUG, sitemap: false, outFile: '404.html', noindex: true });

  // Bridges in an A-road and the curated ones carry the road's status: indexable on a quiet day too.
  const bridgesAlways = lists.bridges.filter((b) => alwaysIndexedBridge(b, bridgeExtras)).map((b) => `/brug/${b.slug}/`);
  // A motorway page answers "is er iets op de A28?" also when the answer is no: never out of Google.
  const motorwaysAlways = lists.roads.filter((r) => r.type === 'A').map((r) => `/weg/${r.slug}/`);
  const { thin, quiet, lastActive } = thinPaths({ routes, activity, indexState, indexStateFailed, site, alsoAlways: [...bridgesAlways, ...motorwaysAlways], today: now.toISOString().slice(0, 10), gemeenteCount: lists.gemeenten.length, warn });
  const pages = routes.map((p) => (thin.has(p.path) ? { ...p, thin: true, sitemap: false } : quiet.has(p.path) ? { ...p, quiet: true } : p));

  const counts = {
    roads: lists.roads.length,
    gemeenten: lists.gemeenten.length,
    woonplaatsen: lists.woonplaatsen.length,
    bridges: lists.bridges.length,
    lists: pages.filter((p) => p.type === 'list').length,
    statics: pages.filter((p) => p.type === 'static').length,
    thin: pages.filter((p) => p.thin).length,
    quiet: pages.filter((p) => p.quiet).length,
  };

  // Which roads run through which places (road-places.mjs): worked out on first use, once per process.
  const roadPlaces = () => roadPlacesFor({ dir: join(webRoot, 'public', 'road-lines'), roads: lists.roads, woonplaatsen: lists.woonplaatsen, warn });

  return {
    site, now, buildIso: now.toISOString(), lists, content, pages, counts, redirects, lastActive, snapshotFor,
    byPath: new Map(pages.map((p) => [p.path, p])),
    index: {
      woonplaatsenByGemeente, woonplaatsBySlug: new Map(lists.woonplaatsen.map((w) => [w.slug, w])), gemeenteByCode, gemeenteByName, roadBySlug, roadByNumber,
      bridgesByGemeente, bridgesByProv, bridgeVariants: bridgeVariants(lists.bridges), bridgeExtras, merged, roadPlaces,
    },
    warn,
  };
}

/**
 * More than half of the gemeenten without a single roadwork is a broken index (a shifted column, a
 * source that died), not a quiet day: on 2026-10-16 it was 9 of 342. Then no page is marked thin.
 */
const MAX_THIN_GEMEENTE_SHARE = 0.5;

function believable(thin, gemeenteCount, warn) {
  if (gemeenteCount === 0 || thin / gemeenteCount <= MAX_THIN_GEMEENTE_SHARE) return true;
  warn(`[gen-pages] ${thin} van ${gemeenteCount} gemeenten zouden zonder meldingen zijn; dat is geen rustige dag maar kapotte data – alle pagina's blijven indexeerbaar`);
  return false;
}

/**
 * Which pages are thin, which are quiet (nothing today, so no ads), and the memory for the next
 * build. Without believable data nothing is thin or quiet and the memory is carried over
 * unchanged, so an outage never shortens a page's 60 days. When the previous memory exists but
 * could not be read, nothing is thin either; the memory then holds only today's active pages.
 */
function thinPaths({ routes, activity, indexState, indexStateFailed, site, alsoAlways = [], today, gemeenteCount, warn }) {
  const carried = { thin: new Set(), quiet: new Set(), lastActive: indexState ?? new Map() };
  if (!activity) return carried;
  // Road pages since 2026-11-12 (activity.mjs). A road without a day in the memory counts as long
  // quiet, like a place on the first run: the memory only started recording roads that day.
  const candidates = routes.filter((p) => p.type === 'place' || p.type === 'bridge' || p.type === 'road');
  const emptyGemeenten = candidates.filter((p) => p.kind === 'gemeente' && isThinPage(p, activity)).length;
  if (!believable(emptyGemeenten, gemeenteCount, warn)) return carried;
  const alwaysIndex = new Set([...(Array.isArray(site.seo?.alwaysIndex) ? site.seo.alwaysIndex : []), ...alsoAlways]);
  const inactiveToday = (p) => isThinPage(p, activity);
  const quiet = new Set(candidates.filter(inactiveToday).map((p) => p.path));
  const decided = decideThin({ candidates, inactiveToday, previous: indexState, today, alwaysIndex });
  return indexStateFailed ? { thin: new Set(), quiet, lastActive: decided.lastActive } : { ...decided, quiet };
}

/** File name of the entity-page manifest at the site root (web/src/data/entity-pages.ts reads it). */
export const ENTITY_MANIFEST_FILE = 'entity-pages.json';

/**
 * Which road, woonplaats and gemeente pages this build generates, from the same lists the pages
 * come from: the map links to /plaats/<slug>/ only when the page exists, and resolves `?plaats=`
 * back to a name. The gemeente of a woonplaats disambiguates the 70 names that occur twice.
 * A merged woonplaats (mergedWoonplaatsen) stays listed: its URL redirects to the gemeente page,
 * and shared `?plaats=` links keep resolving.
 */
export function buildEntityManifest(model) {
  return {
    v: 1,
    roads: model.lists.roads.map((r) => r.slug),
    woonplaatsen: model.lists.woonplaatsen.map((w) => ({ slug: w.slug, name: w.naam, gemeente: w.gemeente ?? null })),
    gemeenten: model.lists.gemeenten.map((g) => ({ slug: g.slug, name: g.naam })),
    // Every bridge page, for the search box ("Gorkumse brug") and the map's detail view, which
    // links a melding to the page of the road bridge it touches (web/src/data/entity-pages.ts).
    bridges: model.lists.bridges.map((b) => ({ slug: b.slug, name: b.name, ...(isRoadBridge(b) ? { road: b.road } : {}), gemeente: b.gemeente ?? null, lon: b.lon, lat: b.lat })),
  };
}

/** ≈ 30 representative pages for `--sample`. */
export function samplePages(model) {
  const pick = [];
  const roads = model.pages.filter((p) => p.type === 'road');
  const want = ['a2', 'a12', 'n57'];
  for (const slug of want) {
    const p = roads.find((r) => r.entity.slug === slug);
    if (p) pick.push(p);
  }
  for (const type of ['A', 'N', 'S', 'E', 'overig']) {
    const p = roads.find((r) => r.entity.type === type && !pick.includes(r));
    if (p) pick.push(p);
  }
  pick.push(...model.pages.filter((p) => p.type === 'place' && p.kind === 'woonplaats').slice(0, 3));
  pick.push(...model.pages.filter((p) => p.type === 'place' && p.kind === 'gemeente').slice(0, 3));
  pick.push(...model.pages.filter((p) => p.type === 'bridge').slice(0, 3));
  pick.push(...model.pages.filter((p) => p.type === 'list' || p.type === 'static'));
  return pick;
}

/* ------------------------------------------------------------------------------------------ */
/* Contexts                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function lookupPath(obj, path) {
  return path.split('.').reduce((cur, key) => (cur === null || cur === undefined ? undefined : cur[key]), obj);
}

/** `{{site.contactEmail}}` etc. inside Markdown, inserted unescaped (the converter escapes text). */
export function substituteVars(md, vars, warn) {
  return md.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, path) => {
    const v = lookupPath(vars, path);
    if (v === undefined || v === null) {
      warn?.(`[gen-pages] onbekende variabele ${whole} in content`);
      return '';
    }
    return String(v);
  });
}

function jsonLd(graph) {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

function breadcrumbLd(siteUrl, crumbs, current, path) {
  const items = [...crumbs.map((c) => ({ name: c.name, item: siteUrl + c.href })), { name: current, item: siteUrl + path }];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.item })),
  };
}

function faqLd(items) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/** `ca-pub-…` for the `google-adsense-account` meta when ads are on; '' otherwise. */
function adsenseAccount(site) {
  const client = site.ads?.enabled ? String(site.ads.adsenseClient ?? '') : '';
  return /^ca-pub-\d{10,20}$/.test(client) ? client : '';
}

function baseContext(model, page, { title, description, crumbs, current, ogType = 'website', extraLd = [] }) {
  const { site } = model;
  const siteUrl = String(site.url ?? '').replace(/\/+$/, '');
  const canonical = siteUrl + (page.path === '/404.html' ? '/404.html' : page.path);
  const ogImage = site.ogImage ? (site.ogImage.startsWith('http') ? site.ogImage : siteUrl + site.ogImage) : '';
  const graph = [breadcrumbLd(siteUrl, crumbs, current, page.path), ...extraLd];
  return {
    site,
    pageType: page.type,
    path: page.path,
    title,
    ogTitle: title.replace(/\s*\|\s*[^|]+$/, ''),
    description,
    canonical,
    ogType,
    ogImage,
    robots: page.noindex ? 'noindex, nofollow' : page.thin ? 'noindex, follow' : 'index, follow, max-image-preview:large',
    adsenseAccount: adsenseAccount(site),
    adsOff: page.quiet === true,
    jsonld: jsonLd(graph),
    crumbs,
    crumbCurrent: current,
    buildIso: model.buildIso,
    buildLabel: fmtDateTime(model.buildIso),
    buildDate: fmtDate(model.buildIso),
    year: new Date(model.buildIso).getFullYear(),
    refreshMinutes: site.refreshMinutes ?? 5,
    planningMinutes: site.planningRefreshMinutes ?? PLANNING_REFRESH_MINUTES,
  };
}

/** Server-visible content of a road or place page (snapshot.mjs); empty fields without one. */
function snapshotVars(model, page, mapHrefValue) {
  const snap = model.snapshotFor ? model.snapshotFor(page, { mapHref: mapHrefValue }) : null;
  return {
    hasSnapshot: Boolean(snap),
    /** Meldingen now and in the next 30 days; null without data (then nothing is decided from it). */
    snapshotCount: snap && Number.isFinite(snap.count) ? snap.count : null,
    /** Works, closures and events among them: what lasts longer than a queue or a breakdown. */
    snapshotLasting: snap && Number.isFinite(snap.lasting) ? snap.lasting : null,
    snapshotAnswer: snap?.answerHtml ?? '',
    snapshotList: snap?.listHtml ?? '',
    hasQuestions: Boolean(snap?.questionsHtml),
    questionsHtml: snap?.questionsHtml ?? '',
    /** Who reported this page's meldingen, with the moment of the data (roadFaq / placeFaq); null without data. */
    faqData: snap ? { authorities: snap.authorities ?? [], asOf: snap.asOf ?? '', count: Number.isFinite(snap.count) ? snap.count : null } : null,
  };
}

/**
 * The "nothing here" text, as HTML for a `data-empty` attribute: the page script shows it only
 * when the live data has nothing. As visible text in the HTML it read, to crawlers that run no
 * script, as a fact about pages that did have roadworks.
 */
function emptyHtml(strong, text, mapHrefValue, tail = '') {
  return `<p><strong>${escapeHtml(strong)}</strong> ${escapeHtml(text)} Kijk op <a href="${escapeHtml(mapHrefValue)}">de kaart</a> voor de omgeving${tail}.</p>`;
}

function roadContext(model, page) {
  const r = page.entity;
  const kind = roadKind(r.type);
  // Only roads whose page is in Google: a quiet N-road page is noindex since 2026-11-12, and a row
  // of links to pages that say 'niets gemeld' helps nobody. The overview /wegen/ still lists them all.
  const inGoogle = model.lists.roads.filter((o) => model.byPath.get(`/weg/${o.slug}/`)?.thin !== true);
  const related = nearestRoads(r, inGoogle, 12).map((o) => ({ road: o.road, href: `/weg/${o.slug}/`, badgeClass: roadKind(o.type).badge }));
  const { alongGemeenten, alongPlaces } = placesAlongRoad(model, r);
  const roadBridges = bridgesOnRoad(model, r);
  const bbox = Array.isArray(r.bbox) && r.bbox.length === 4 ? r.bbox.map((n) => Number(n).toFixed(5)).join(',') : '';
  const crumbs = [{ name: 'Kaart', href: '/' }, { name: 'Wegen', href: '/wegen/' }];
  // Road mode on the map (the map never read the old `?b=`); after `#` like every page link to it.
  const href = `/#weg=${encodeURIComponent(r.slug)}`;
  const snapVars = snapshotVars(model, page, href);
  return {
    ...snapVars,
    emptyHtml: emptyHtml(`Geen meldingen voor de ${r.road}.`, 'Op dit moment zijn er bij NDW geen actuele of geplande werkzaamheden, afsluitingen of files op deze weg bekend.', href),
    ...baseContext(model, page, {
      title: roadTitle(r),
      description: roadDescription(r),
      crumbs,
      current: `Wegwerkzaamheden ${r.road}`,
      ogType: 'article',
    }),
    // No works or closures on the road now or in the next 30 days: no ads, as on a quiet place page
    // (AdSense: no ads on screens without publisher content). A queue or a broken-down vehicle alone
    // does not count: it is gone within the hour, and on 2026-11-12 one stale incident switched ads
    // on for three N-road pages that had nothing else. Without a snapshot the index decides (quiet).
    adsOff: snapVars.snapshotLasting === null ? page.quiet === true : snapVars.snapshotLasting === 0,
    road: r.road,
    slug: r.slug,
    roadType: r.type,
    badgeClass: kind.badge,
    kindLabel: kind.label,
    lon: r.lon,
    lat: r.lat,
    bbox,
    heading: `Wegwerkzaamheden ${r.road}`,
    intro: roadIntro(r),
    faq: roadFaq(r, snapVars.faqData),
    related,
    hasRelated: related.length > 0,
    alongGemeenten,
    hasAlongGemeenten: alongGemeenten.length > 0,
    alongPlaces,
    hasAlongPlaces: alongPlaces.length > 0,
    hasAlong: alongGemeenten.length + alongPlaces.length > 0,
    roadBridges,
    hasRoadBridges: roadBridges.length > 0,
    mapHref: href,
  };
}

function placeContext(model, page) {
  const p = page.entity;
  const kind = page.kind;
  const isGemeente = kind === 'gemeente';
  const gemeente = isGemeente ? p : model.index.gemeenteByCode.get(p.gemeenteCode) ?? model.index.gemeenteByName.get((p.gemeente ?? '').toLowerCase());
  const siblings = (model.index.woonplaatsenByGemeente.get(isGemeente ? p.code : p.gemeenteCode) ?? []).filter((w) => w !== p && !model.index.merged.has(w));
  const crumbs = [{ name: 'Kaart', href: '/' }, { name: 'Plaatsen', href: '/plaatsen/' }];
  if (!isGemeente && gemeente) crumbs.push({ name: `Gemeente ${gemeente.naam}`, href: `/gemeente/${gemeente.slug}/` });

  const relatedPlaces = siblings
    .slice()
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
    .slice(0, isGemeente ? 40 : 40)
    .map((w) => ({ name: w.naam, href: `/plaats/${w.slug}/` }));
  const relatedGemeenten = isGemeente
    ? nearestByCentroid(p, model.lists.gemeenten, 6).map((g) => ({ name: g.naam, href: `/gemeente/${g.slug}/` }))
    : gemeente
      ? [{ name: `Gemeente ${gemeente.naam}`, href: `/gemeente/${gemeente.slug}/` }]
      : [];
  const nearbyRoads = roadsThroughPlace(model, page);
  const placeBridges = bridgesInPlace(model, page);
  const provName = p.prov ?? gemeente?.prov ?? '';
  const zoom = isGemeente ? 11 : 12;
  const href = mapHref(p.lon, p.lat, zoom);
  const gemeenteName = isGemeente ? p.naam : p.gemeente ?? gemeente?.naam ?? '';
  const gemeenteLink = !isGemeente && gemeente ? ` of op de pagina van de <a href="/gemeente/${escapeHtml(gemeente.slug)}/">gemeente ${escapeHtml(gemeenteName)}</a>` : '';
  // All woonplaatsen, the merged one included: a gemeente that took over its only kern's page
  // (Alblasserdam) is all the more the page for that name.
  const ownPlaces = isGemeente ? (model.index.woonplaatsenByGemeente.get(p.code) ?? []) : [];
  const naming = { sameNameKern: isGemeente && hasSameNameKern(p, ownPlaces) };
  const placeSnap = snapshotVars(model, page, href);
  return {
    ...placeSnap,
    emptyHtml: emptyHtml(
      `Geen meldingen voor ${p.naam}.`,
      `Op dit moment zijn er bij NDW geen actuele of geplande werkzaamheden of afsluitingen ${isGemeente ? 'in de gemeente' : 'in'} ${p.naam} bekend.`,
      href,
      gemeenteLink,
    ),
    ...baseContext(model, page, {
      title: placeTitle(p, kind, naming),
      description: placeDescription(p, kind, naming),
      crumbs,
      current: placeHeading(p, kind),
      ogType: 'article',
    }),
    kind,
    isGemeente,
    isWoonplaats: !isGemeente,
    name: p.naam,
    heading: placeHeading(p, kind),
    kicker: isGemeente ? `Gemeente · ${provName}` : `Woonplaats · gemeente ${p.gemeente ?? gemeente?.naam ?? ''} · ${provName}`,
    gemeente: isGemeente ? p.naam : p.gemeente ?? gemeente?.naam ?? '',
    gemeenteHref: !isGemeente && gemeente ? `/gemeente/${gemeente.slug}/` : '',
    prov: provName,
    provCode: p.provCode ?? gemeente?.provCode ?? '',
    lon: p.lon,
    lat: p.lat,
    zoom,
    intro: placeIntro(p, kind, siblings),
    faq: placeFaq(p, kind, placeSnap.faqData),
    relatedPlaces,
    hasRelatedPlaces: relatedPlaces.length > 0,
    relatedPlacesTitle: isGemeente ? `Plaatsen in de gemeente ${p.naam}` : `Andere plaatsen in de gemeente ${p.gemeente ?? ''}`,
    relatedGemeenten,
    hasRelatedGemeenten: relatedGemeenten.length > 0,
    relatedGemeentenTitle: isGemeente ? 'Buurgemeenten' : 'Gemeente',
    nearbyRoads,
    hasNearbyRoads: nearbyRoads.length > 0,
    nearbyRoadsTitle: isGemeente ? `Wegen in en rond ${p.naam}` : `Wegen bij ${p.naam}`,
    placeBridges,
    hasPlaceBridges: placeBridges.length > 0,
    placeBridgesTitle: isGemeente ? `Bruggen in de gemeente ${p.naam}` : `Bruggen bij ${p.naam}`,
    mapHref: href,
  };
}

function bridgeContext(model, page) {
  const b = page.entity;
  const variant = model.index.bridgeVariants.get(b.id) ?? '';
  const pool = [...(b.gemeente ? model.index.bridgesByGemeente.get(b.gemeente) ?? [] : [])];
  if (pool.length < 7 && b.prov) for (const o of model.index.bridgesByProv.get(b.prov) ?? []) if (!pool.includes(o)) pool.push(o);
  const relatedBridges = nearestByCentroid(b, pool, 8).map((o) => ({
    name: o.name,
    href: `/brug/${o.slug}/`,
    sub: [o.road, o.woonplaats || o.gemeente].filter(Boolean).join(' · '),
  }));
  const road = b.road ? model.index.roadByNumber.get(b.road.toUpperCase()) : null;
  const place = b.woonplaats ? model.lists.woonplaatsen.find((w) => w.naam === b.woonplaats && (!b.gemeente || w.gemeente === b.gemeente)) : null;
  const gem = b.gemeente ? model.index.gemeenteByName.get(b.gemeente.toLowerCase()) : null;
  const crumbs = [{ name: 'Kaart', href: '/' }, { name: 'Bruggen', href: '/bruggen/' }];
  const href = mapHref(b.lon, b.lat, 14);
  const snap = model.snapshotFor ? model.snapshotFor(page, { mapHref: href }) : null;
  // Its own openings answer "Wanneer gaat … open?" (text.mjs bridgeFaq); without data the general sentence.
  const faq = bridgeFaq(b, snap ? { opening: snap.opening ?? null, asOf: snap.asOf ?? '' } : null);
  const common = {
    id: b.id,
    name: b.name,
    variant,
    road: b.road ?? '',
    roadHref: road ? `/weg/${road.slug}/` : '',
    water: b.water ?? '',
    gemeente: b.gemeente ?? '',
    gemeenteHref: gem ? `/gemeente/${gem.slug}/` : '',
    woonplaats: b.woonplaats ?? '',
    placeHref: place ? (model.index.merged.has(place) ? `/gemeente/${model.index.merged.get(place).slug}/` : `/plaats/${place.slug}/`) : '',
    prov: b.prov ?? '',
    lon: b.lon,
    lat: b.lat,
    relatedBridges,
    hasRelatedBridges: relatedBridges.length > 0,
    mapHref: href,
  };
  if (isRoadBridge(b)) {
    const vars = roadBridgeVars(model, page, { variant, snap, href, roadEntry: road });
    return {
      ...common,
      ...vars,
      ...baseContext(model, page, {
        title: roadBridgeTitle(b, variant),
        description: roadBridgeDescription(b, { variant, aliases: vars.aliases, headline: snap?.headline ?? '', asOf: snap?.asOf ?? '' }),
        crumbs,
        current: vars.heading,
        ogType: 'article',
      }),
      // A bridge in a road shows the meldingen on and around it, like a road page: ads follow those,
      // not the openings. On 2026-11-12 the Merwedebrug page (29 meldingen, no openings) had ads off
      // while a page with one opening and nothing else had them on.
      adsOff: snap && Number.isFinite(snap.lasting) ? snap.lasting === 0 : page.quiet === true,
      kicker: [`Brug in de ${b.road}`, b.water ? `over ${b.water}` : '', variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : '', b.prov ?? ''].filter(Boolean).join(' · '),
      faq: roadBridgeFaq(b, { radiusKm: vars.radiusKm, roadHref: common.roadHref, openingsFaq: faq }),
    };
  }
  return {
    ...common,
    isRoadBridge: false,
    hasSnapshot: Boolean(snap),
    snapshotOpenings: snap?.openingsHtml ?? '',
    emptyHtml: `<p><strong>Geen openingen aangemeld.</strong> Voor ${escapeHtml(b.name)} zijn bij NDW op dit moment geen geplande openingen bekend. Dat betekent niet dat de brug niet opengaat: veel bruggen draaien op aanvraag van de scheepvaart. Kijk op <a href="${escapeHtml(href)}">de kaart</a> voor de actuele situatie in de omgeving.</p>`,
    ...baseContext(model, page, {
      title: bridgeTitle(b, variant),
      description: bridgeDescription(b, variant),
      crumbs,
      current: `Brugopeningen ${b.name}${variant ? ` (${variant})` : ''}`,
      ogType: 'article',
    }),
    heading: `Brugopeningen ${b.name}${variant ? ` (${variant})` : ''}`,
    kicker: [
      b.road ? `Brug in de ${b.road}` : 'Beweegbare brug',
      b.water ? `over ${b.water}` : '',
      variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : '',
      b.prov ?? '',
    ].filter(Boolean).join(' · '),
    intro: bridgeIntro(b),
    faq,
  };
}

const LIST_DEFAULTS = {
  heading: 'Overzicht',
  kicker: 'Overzicht',
  lead: '',
  emptyTitle: 'Geen meldingen.',
  emptyText: 'Op dit moment zijn er bij NDW geen meldingen bekend, of de gegevens konden niet worden geladen.',
};

function contentVars(model, extra = {}) {
  return {
    site: model.site,
    year: new Date(model.buildIso).getFullYear(),
    buildDate: fmtDate(model.buildIso),
    refreshMinutes: model.site.refreshMinutes ?? 5,
    planningMinutes: model.site.planningRefreshMinutes ?? PLANNING_REFRESH_MINUTES,
    publisher: publisherVars(model.site.owner),
    // Build-day dates for list titles ("di 20 okt", "23–26 okt"); '' when the build time is unusable.
    todayLabel: todayLabel(model.buildIso),
    weekendLabel: weekendLabel(model.buildIso),
    ...extra,
  };
}

/** Front-matter text with variables; a date that came out empty leaves no "()" behind. */
function fillText(text, vars) {
  return substituteVars(String(text), vars).replace(/\s*\(\s*\)/g, '');
}

function listContext(model, page) {
  const entry = model.content.get(page.slug);
  const data = { ...LIST_DEFAULTS, ...(entry?.data ?? {}) };
  const vars = contentVars(model, { counts: model.counts });
  const body = entry ? markdownToHtml(substituteVars(entry.body, vars, model.warn), { headingOffset: 0 }) : '';
  let prerendered = '';
  if (page.list === 'wegen') prerendered = renderWegenList(model.lists.roads);
  else if (page.list === 'plaatsen') prerendered = renderPlaatsenList(model.lists.gemeenten, model.index.woonplaatsenByGemeente, model.index.merged);
  else if (page.list === 'bruggen') prerendered = renderBruggenList(model.lists.bridges);
  const snap = !prerendered && model.snapshotFor ? model.snapshotFor(page, { mapHref: '/' }) : null;
  // No " | Wegwerk" on list titles: they are written to fit 60 characters, and Google adds the
  // site name itself.
  const title = data.title ? fillText(data.title, vars) : `${data.heading} | ${model.site.name}`;
  const description = clampText(data.description ? fillText(data.description, vars) : stripMarkdown(data.lead || data.heading));
  const summaryDefault = prerendered
    ? page.list === 'wegen'
      ? `${model.counts.roads} wegen met een eigen pagina`
      : page.list === 'plaatsen'
        ? `${model.counts.gemeenten} gemeenten en ${model.counts.woonplaatsen} woonplaatsen`
        : `${model.counts.bridges} bruggen met een eigen pagina`
    : 'Actuele meldingen worden geladen…';
  return {
    ...baseContext(model, page, {
      title,
      description,
      crumbs: [{ name: 'Kaart', href: '/' }],
      current: data.heading,
    }),
    list: page.list,
    slug: page.slug,
    heading: data.heading,
    kicker: data.kicker,
    lead: substituteVars(String(data.lead ?? ''), vars),
    summaryFallback: snap ? snap.summary : data.summary ? substituteVars(String(data.summary), vars) : summaryDefault,
    hasSnapshot: Boolean(snap),
    snapshotList: snap?.listHtml ?? '',
    emptyTitle: data.emptyTitle,
    emptyText: data.emptyText,
    emptyHtml: `<p><strong>${escapeHtml(data.emptyTitle)}</strong> ${escapeHtml(data.emptyText)} <a href="/">Bekijk de kaart</a> voor het volledige beeld.</p>`,
    body,
    hasBody: body.trim() !== '',
    prerendered,
    hasPrerendered: prerendered !== '',
    isLive: prerendered === '',
  };
}

/** Article markup for a guide: who wrote it and when, which a generated page cannot claim. */
function guideLd(model, page, { heading, description, published, updated }) {
  const siteUrl = String(model.site.url ?? '').replace(/\/+$/, '');
  const owner = String(model.site.owner?.name ?? '').trim();
  const org = { '@type': 'Organization', name: model.site.longName, url: `${siteUrl}/` };
  return {
    '@type': 'Article',
    headline: heading,
    description,
    inLanguage: 'nl-NL',
    mainEntityOfPage: siteUrl + page.path,
    ...(published ? { datePublished: published } : {}),
    ...(updated ? { dateModified: updated } : {}),
    author: owner ? { '@type': 'Person', name: owner } : org,
    publisher: org,
  };
}

function staticContext(model, page) {
  const entry = model.content.get(page.slug);
  const data = entry?.data ?? {};
  const vars = contentVars(model);
  const bodyMd = entry ? substituteVars(entry.body, vars, model.warn) : '';
  const isFaq = data.layout === 'faq';
  const extraLd = [];
  if (isFaq) {
    const { sections } = splitSections(bodyMd, 2);
    const items = sections.filter((s) => s.body).map((s) => ({ q: stripMarkdown(s.heading), a: markdownToHtml(s.body, { headingIds: false }) }));
    if (items.length) extraLd.push(faqLd(items));
  }
  const heading = data.heading ?? page.slug;
  const title = data.title ? `${substituteVars(String(data.title), vars)} | ${model.site.name}` : `${heading} | ${model.site.name}`;
  const updated = data.updated ? String(data.updated) : '';
  const description = clampText(data.description ? substituteVars(String(data.description), vars) : stripMarkdown(data.lead || heading));
  if (page.parent) extraLd.push(guideLd(model, page, { heading, description, published: data.published ? String(data.published) : updated, updated }));
  return {
    ...baseContext(model, page, {
      title,
      description,
      crumbs: [{ name: 'Kaart', href: '/' }, ...(page.parent ? [page.parent] : [])],
      current: heading,
      ogType: 'article',
      extraLd,
    }),
    slug: page.slug,
    heading,
    kicker: data.kicker ?? '',
    lead: substituteVars(String(data.lead ?? ''), vars),
    updated,
    updatedLabel: updated ? fmtDate(updated) : '',
    // A guide shows who wrote it (the same name as its Article JSON-LD author); without an owner name, nothing.
    author: page.parent && String(model.site.owner?.name ?? '').trim() ? String(model.site.owner.name).trim() : '',
    body: markdownToHtml(bodyMd),
    isFaq,
    isNotFound: page.slug === NOT_FOUND_SLUG,
  };
}

export function pageContext(page, model) {
  switch (page.type) {
    case 'road':
      return roadContext(model, page);
    case 'place':
      return placeContext(model, page);
    case 'bridge':
      return bridgeContext(model, page);
    case 'list':
      return listContext(model, page);
    case 'static':
      return staticContext(model, page);
    default:
      throw new Error(`Onbekend paginatype ${page.type}`);
  }
}

/** Render a page with the compiled templates (`type → fn`). */
export function renderPage(page, model, templates) {
  const tpl = templates[page.type];
  if (!tpl) throw new Error(`Template voor ${page.type} ontbreekt`);
  return protectEmails(tpl(pageContext(page, model)));
}

/** Synthetic 404 page (also used by the dev plugin for unknown slugs). */
export function notFoundPage(model, requestedPath = '') {
  const page = model.byPath.get('/404.html');
  return { ...page, requestedPath };
}

/** Output file path (relative to the dist root) for a page. */
export function outFileFor(page) {
  if (page.outFile) return page.outFile;
  return `${page.path.replace(/^\//, '')}index.html`;
}

export { escapeHtml };
