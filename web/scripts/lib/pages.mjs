/**
 * Page model: every generated route with its type, template variables, metadata and JSON-LD.
 * Used by `gen-pages.mjs` (build) and `dev-pages-plugin.mjs` (on-request rendering).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { markdownToHtml, parseFrontMatter, splitSections, stripMarkdown } from './markdown.mjs';
import { escapeHtml } from './render.mjs';
import { loadLists, nearestByCentroid, nearestRoads } from './lists.mjs';
import { renderBruggenList, renderPlaatsenList, renderWegenList } from './fragments.mjs';
import {
  PLANNING_REFRESH_MINUTES,
  bridgeDescription, bridgeFaq, bridgeIntro, bridgeTitle, bridgeVariants,
  clampText, fmtDate, fmtDateTime, mapHref,
  placeDescription, placeFaq, placeHeading, placeIntro, placeTitle,
  roadDescription, roadFaq, roadIntro, roadKind, roadTitle,
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

export const STATIC_ROUTES = ['over', 'veelgestelde-vragen', 'privacy', 'cookies', 'disclaimer', 'colofon', 'contact'].map((slug) => ({
  slug,
  path: `/${slug}/`,
  priority: slug === 'over' || slug === 'veelgestelde-vragen' ? 0.5 : 0.3,
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

export function buildModel({ webRoot, repoRoot, listsDir, now = new Date(), warn = console.warn }) {
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

  const pages = [];
  for (const r of lists.roads) {
    pages.push({
      type: 'road', path: `/weg/${r.slug}/`, entity: r, sitemap: true,
      priority: r.type === 'A' ? 0.8 : r.type === 'N' ? 0.6 : 0.5, changefreq: 'daily',
    });
  }
  for (const g of lists.gemeenten) {
    pages.push({ type: 'place', kind: 'gemeente', path: `/gemeente/${g.slug}/`, entity: g, sitemap: true, priority: 0.6, changefreq: 'daily' });
  }
  for (const w of lists.woonplaatsen) {
    pages.push({ type: 'place', kind: 'woonplaats', path: `/plaats/${w.slug}/`, entity: w, sitemap: true, priority: 0.5, changefreq: 'daily' });
  }
  for (const b of lists.bridges) {
    pages.push({ type: 'bridge', path: `/brug/${b.slug}/`, entity: b, sitemap: true, priority: 0.5, changefreq: 'daily' });
  }
  for (const l of LIST_ROUTES) {
    if (!content.has(l.slug)) warn(`[gen-pages] content/${l.slug}.md ontbreekt – lijstpagina ${l.path} krijgt standaardtekst`);
    pages.push({ type: 'list', path: l.path, slug: l.slug, list: l.list, sitemap: true, priority: l.priority, changefreq: l.changefreq });
  }
  for (const s of STATIC_ROUTES) {
    if (!content.has(s.slug)) {
      warn(`[gen-pages] content/${s.slug}.md ontbreekt – pagina ${s.path} overgeslagen`);
      continue;
    }
    pages.push({ type: 'static', path: s.path, slug: s.slug, sitemap: true, priority: s.priority, changefreq: s.changefreq });
  }
  pages.push({ type: 'static', path: '/404.html', slug: NOT_FOUND_SLUG, sitemap: false, outFile: '404.html', noindex: true });

  const counts = {
    roads: lists.roads.length,
    gemeenten: lists.gemeenten.length,
    woonplaatsen: lists.woonplaatsen.length,
    bridges: lists.bridges.length,
    lists: pages.filter((p) => p.type === 'list').length,
    statics: pages.filter((p) => p.type === 'static').length,
  };

  return {
    site, now, buildIso: now.toISOString(), lists, content, pages, counts,
    byPath: new Map(pages.map((p) => [p.path, p])),
    index: {
      woonplaatsenByGemeente, gemeenteByCode, gemeenteByName, roadBySlug, roadByNumber,
      bridgesByGemeente, bridgesByProv, bridgeVariants: bridgeVariants(lists.bridges),
    },
    warn,
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
    robots: page.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large',
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

function roadContext(model, page) {
  const r = page.entity;
  const refresh = model.site.refreshMinutes ?? 5;
  const kind = roadKind(r.type);
  const faq = roadFaq(r, refresh);
  const related = nearestRoads(r, model.lists.roads, 12).map((o) => ({ road: o.road, href: `/weg/${o.slug}/`, badgeClass: roadKind(o.type).badge }));
  const bbox = Array.isArray(r.bbox) && r.bbox.length === 4 ? r.bbox.map((n) => Number(n).toFixed(5)).join(',') : '';
  const crumbs = [{ name: 'Kaart', href: '/' }, { name: 'Wegen', href: '/wegen/' }];
  return {
    ...baseContext(model, page, {
      title: roadTitle(r, model.site.name),
      description: roadDescription(r),
      crumbs,
      current: `Wegwerkzaamheden ${r.road}`,
      ogType: 'article',
      extraLd: [faqLd(faq)],
    }),
    road: r.road,
    slug: r.slug,
    roadType: r.type,
    badgeClass: kind.badge,
    kindLabel: kind.label,
    lon: r.lon,
    lat: r.lat,
    bbox,
    heading: `Wegwerkzaamheden ${r.road}`,
    intro: roadIntro(r, refresh),
    faq,
    related,
    hasRelated: related.length > 0,
    mapHref: bbox ? `/?b=${bbox}` : mapHref(r.lon, r.lat, 9),
  };
}

function placeContext(model, page) {
  const p = page.entity;
  const kind = page.kind;
  const refresh = model.site.refreshMinutes ?? 5;
  const isGemeente = kind === 'gemeente';
  const gemeente = isGemeente ? p : model.index.gemeenteByCode.get(p.gemeenteCode) ?? model.index.gemeenteByName.get((p.gemeente ?? '').toLowerCase());
  const siblings = (model.index.woonplaatsenByGemeente.get(isGemeente ? p.code : p.gemeenteCode) ?? []).filter((w) => w !== p);
  const faq = placeFaq(p, kind, refresh);
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
  const provName = p.prov ?? gemeente?.prov ?? '';
  const zoom = isGemeente ? 11 : 12;
  return {
    ...baseContext(model, page, {
      title: placeTitle(p, kind, model.site.name),
      description: placeDescription(p, kind),
      crumbs,
      current: placeHeading(p, kind),
      ogType: 'article',
      extraLd: [faqLd(faq)],
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
    intro: placeIntro(p, kind, siblings, refresh),
    faq,
    relatedPlaces,
    hasRelatedPlaces: relatedPlaces.length > 0,
    relatedPlacesTitle: isGemeente ? `Plaatsen in de gemeente ${p.naam}` : `Andere plaatsen in de gemeente ${p.gemeente ?? ''}`,
    relatedGemeenten,
    hasRelatedGemeenten: relatedGemeenten.length > 0,
    relatedGemeentenTitle: isGemeente ? 'Buurgemeenten' : 'Gemeente',
    mapHref: mapHref(p.lon, p.lat, zoom),
  };
}

function bridgeContext(model, page) {
  const b = page.entity;
  const refresh = model.site.refreshMinutes ?? 5;
  const variant = model.index.bridgeVariants.get(b.id) ?? '';
  const faq = bridgeFaq(b, refresh);
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
  return {
    ...baseContext(model, page, {
      title: bridgeTitle(b, model.site.name, variant),
      description: bridgeDescription(b, variant),
      crumbs,
      current: `Brugopeningen ${b.name}${variant ? ` (${variant})` : ''}`,
      ogType: 'article',
      extraLd: [faqLd(faq)],
    }),
    id: b.id,
    name: b.name,
    variant,
    heading: `Brugopeningen ${b.name}${variant ? ` (${variant})` : ''}`,
    kicker: [
      b.road ? `Brug in de ${b.road}` : 'Beweegbare brug',
      b.water ? `over ${b.water}` : '',
      variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : '',
      b.prov ?? '',
    ].filter(Boolean).join(' · '),
    road: b.road ?? '',
    roadHref: road ? `/weg/${road.slug}/` : '',
    water: b.water ?? '',
    gemeente: b.gemeente ?? '',
    gemeenteHref: gem ? `/gemeente/${gem.slug}/` : '',
    woonplaats: b.woonplaats ?? '',
    placeHref: place ? `/plaats/${place.slug}/` : '',
    prov: b.prov ?? '',
    lon: b.lon,
    lat: b.lat,
    intro: bridgeIntro(b, refresh),
    faq,
    relatedBridges,
    hasRelatedBridges: relatedBridges.length > 0,
    mapHref: mapHref(b.lon, b.lat, 14),
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
    ...extra,
  };
}

function listContext(model, page) {
  const entry = model.content.get(page.slug);
  const data = { ...LIST_DEFAULTS, ...(entry?.data ?? {}) };
  const vars = contentVars(model, { counts: model.counts });
  const body = entry ? markdownToHtml(substituteVars(entry.body, vars, model.warn), { headingOffset: 0 }) : '';
  let prerendered = '';
  if (page.list === 'wegen') prerendered = renderWegenList(model.lists.roads);
  else if (page.list === 'plaatsen') prerendered = renderPlaatsenList(model.lists.gemeenten, model.index.woonplaatsenByGemeente);
  else if (page.list === 'bruggen') prerendered = renderBruggenList(model.lists.bridges);
  const title = data.title ? `${data.title} | ${model.site.name}` : `${data.heading} | ${model.site.name}`;
  const description = clampText(
    data.description ? substituteVars(String(data.description), vars) : stripMarkdown(data.lead || data.heading),
  );
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
    summaryFallback: data.summary ? substituteVars(String(data.summary), vars) : summaryDefault,
    emptyTitle: data.emptyTitle,
    emptyText: data.emptyText,
    body,
    hasBody: body.trim() !== '',
    prerendered,
    hasPrerendered: prerendered !== '',
    isLive: prerendered === '',
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
  return {
    ...baseContext(model, page, {
      title,
      description: clampText(
        data.description ? substituteVars(String(data.description), vars) : stripMarkdown(data.lead || heading),
      ),
      crumbs: [{ name: 'Kaart', href: '/' }],
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
  return tpl(pageContext(page, model));
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
