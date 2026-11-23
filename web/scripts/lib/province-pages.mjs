/**
 * The twelve province pages (/provincie/<slug>/): a middle layer between the map and the 342
 * gemeenten and 2,500 woonplaatsen, which until 2026-11 were reachable only through the one list
 * /plaatsen/ with 2,771 links (docs/groei-onderzoek-2026-11.md §3.4).
 *
 * A province page is a list page of its own: what happens today in the province, motorways first
 * (the same view as /vandaag/, ui/list-sections.ts, on the province's own index file
 * index/prov/<PVxx>.json), then the gemeenten, the roads and the bridges of the province. Every
 * place page names its province in the breadcrumb ("Kaart › Noord-Brabant › …"), so a reader
 * of a gemeente page is one click away from the rest of the region.
 *
 * Roads have no province in the lists; a road belongs to a province when it runs through one of
 * its woonplaatsen (road-places.mjs, the same split the road and place pages link with).
 */

import { roadNumber } from './lists.mjs';
import { escapeHtml } from './render.mjs';
import { bridgesProvAnchor } from './fragments.mjs';
import { isRoadBridge } from './bridge-pages.mjs';
import { FRESHNESS, fitText, fitTitle, mapHref, roadKind } from './text.mjs';

/** Bridges listed on a province page; the rest stand on /bruggen/ under the province's heading. */
export const MAX_PROVINCE_BRIDGES = 40;
const ROAD_TYPE_ORDER = { A: 0, N: 1, E: 2, S: 3 };
const PROVINCE_ZOOM = 9;

/** "noord-brabant": the province name as a URL part. */
export function provinceSlug(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "/provincie/noord-brabant/", or '' for a place without a province. */
export function provinceHref(name) {
  const slug = name ? provinceSlug(name) : '';
  return slug ? `/provincie/${slug}/` : '';
}

/**
 * The provinces named in the gemeenten list, by name: `{ name, code, slug, gemeenten, lon, lat }`
 * with the centre of their gemeenten for the map link. A gemeente without a province (sample data)
 * belongs to none.
 */
export function provincesFrom(gemeenten) {
  const byName = new Map();
  for (const g of gemeenten) {
    const name = typeof g.prov === 'string' ? g.prov.trim() : '';
    if (!name || !provinceSlug(name)) continue;
    if (!byName.has(name)) byName.set(name, { name, code: typeof g.provCode === 'string' ? g.provCode : '', gemeenten: [] });
    byName.get(name).gemeenten.push(g);
  }
  return [...byName.values()]
    .map((p) => {
      const located = p.gemeenten.filter((g) => Number.isFinite(g.lon) && Number.isFinite(g.lat));
      const mean = (key) => (located.length ? located.reduce((s, g) => s + g[key], 0) / located.length : null);
      return { ...p, slug: provinceSlug(p.name), lon: mean('lon'), lat: mean('lat') };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

/** The routes of the province pages; in the sitemap, never thin (they always list their gemeenten). */
export function provinceRoutes(provinces) {
  return provinces.map((p) => ({ type: 'province', path: `/provincie/${p.slug}/`, entity: p, sitemap: true, priority: 0.7, changefreq: 'daily' }));
}

/** "Noord-Brabant", or "provincie Utrecht" where a gemeente has the same name. */
export function provinceLabel(province, gemeenten) {
  const clash = gemeenten.some((g) => g.naam.toLowerCase() === province.name.toLowerCase());
  return clash ? `provincie ${province.name}` : province.name;
}

export function provinceTitle(province, gemeenten) {
  const label = provinceLabel(province, gemeenten);
  return fitTitle([`Wegwerkzaamheden ${label}: wegafsluitingen vandaag`, `Wegwerkzaamheden ${label}`]);
}

export function provinceDescription(province, gemeenteCount) {
  const n = `${gemeenteCount} ${gemeenteCount === 1 ? 'gemeente' : 'gemeenten'}`;
  return fitText([
    `Welke wegen zijn vandaag dicht in de provincie ${province.name}? De snelwegen eerst, daarna alle werkzaamheden en afsluitingen in de ${n}. ${FRESHNESS}`,
    `Welke wegen zijn vandaag dicht in de provincie ${province.name}? Snelwegen eerst, daarna de ${n}. ${FRESHNESS}`,
    `Wegwerkzaamheden en afsluitingen in de provincie ${province.name}, vandaag. ${FRESHNESS}`,
  ]);
}

const linkable = (model, path) => {
  const page = model.byPath.get(path);
  return Boolean(page) && page.thin !== true;
};

/** Roads through the woonplaatsen of the province that are in Google: A-roads first, then by number. */
export function roadsInProvince(model, province) {
  const { roadsByPlace } = model.index.roadPlaces();
  const roads = new Set();
  for (const g of province.gemeenten) {
    for (const w of model.index.woonplaatsenByGemeente.get(g.code) ?? []) {
      for (const { slug } of roadsByPlace.get(w.slug) ?? []) {
        const road = model.index.roadBySlug.get(slug);
        if (road) roads.add(road);
      }
    }
  }
  return [...roads]
    .filter((r) => linkable(model, `/weg/${r.slug}/`))
    .sort((a, b) => (ROAD_TYPE_ORDER[a.type] ?? 9) - (ROAD_TYPE_ORDER[b.type] ?? 9) || roadNumber(a.road) - roadNumber(b.road) || a.road.localeCompare(b.road, 'nl'))
    .map((r) => ({ road: r.road, href: `/weg/${r.slug}/`, badgeClass: roadKind(r.type).badge }));
}

/** Bridges of the province with a page in Google: bridges in a road first, then by name. */
export function bridgesInProvince(model, province) {
  return [...(model.index.bridgesByProv.get(province.name) ?? [])]
    .filter((b) => linkable(model, `/brug/${b.slug}/`))
    .sort((a, b) => Number(isRoadBridge(b)) - Number(isRoadBridge(a)) || a.name.localeCompare(b.name, 'nl'))
    .map((b) => ({ name: b.name, href: `/brug/${b.slug}/`, sub: [b.road, b.water, b.woonplaats || b.gemeente].filter(Boolean).join(' · ') }));
}

/**
 * Template variables of a province page. `base` is pages.mjs baseContext; `snapshotFor` the
 * build's snapshot (snapshot.mjs), null without data.
 */
export function provinceContext(model, page, { base }) {
  const province = page.entity;
  const gemeenten = [...province.gemeenten]
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
    .map((g) => ({ name: g.naam, href: `/gemeente/${g.slug}/` }));
  const roads = roadsInProvince(model, province);
  const allBridges = bridgesInProvince(model, province);
  const bridges = allBridges.slice(0, MAX_PROVINCE_BRIDGES);
  const href = province.lon !== null && province.lat !== null ? mapHref(province.lon, province.lat, PROVINCE_ZOOM) : '/';
  const snap = model.snapshotFor ? model.snapshotFor(page, { mapHref: href }) : null;
  const heading = `Wegwerkzaamheden provincie ${province.name}`;
  const count = gemeenten.length;
  // Only the groups the page has: a province without bridge pages does not promise any.
  const below = [`de ${count} ${count === 1 ? 'gemeente' : 'gemeenten'}`, roads.length ? 'de wegen' : '', bridges.length ? 'de bruggen' : ''].filter(Boolean);
  const belowText = below.length > 1 ? `${below.slice(0, -1).join(', ')} en ${below[below.length - 1]}` : below[0];
  return {
    ...base(model, page, {
      title: provinceTitle(province, model.lists.gemeenten),
      description: provinceDescription(province, count),
      crumbs: [{ name: 'Kaart', href: '/' }, { name: 'Plaatsen', href: '/plaatsen/' }],
      current: `Provincie ${province.name}`,
    }),
    list: 'vandaag',
    prov: province.name,
    provCode: province.code,
    heading,
    kicker: 'Provincie',
    lead: `Wat er vandaag speelt op de wegen in de provincie ${province.name}: de snelwegen eerst, daarna alle werkzaamheden, afsluitingen en files. Onder de lijst staan ${belowText} van de provincie.`,
    summaryFallback: snap ? snap.summary : 'Actuele meldingen worden geladen…',
    hasSnapshot: Boolean(snap),
    snapshotList: snap?.listHtml ?? '',
    emptyHtml: `<p><strong>Niets gemeld voor vandaag.</strong> Op dit moment zijn er bij NDW voor vandaag geen werkzaamheden, afsluitingen of files in de provincie ${escapeHtml(province.name)} bekend. <a href="${escapeHtml(href)}">Bekijk de kaart</a> voor de komende dagen.</p>`,
    mapHref: href,
    gemeenten,
    gemeentenTitle: `Gemeenten in ${province.name}`,
    gemeenteCount: count,
    roads,
    hasRoads: roads.length > 0,
    roadsTitle: `Wegen in ${province.name}`,
    roadCount: roads.length,
    bridges,
    hasBridges: bridges.length > 0,
    bridgesTitle: `Bruggen in ${province.name}`,
    bridgeCount: allBridges.length,
    moreBridges: allBridges.length > bridges.length,
    moreBridgesHref: `/bruggen/#${bridgesProvAnchor(province.name)}`,
  };
}

/**
 * "Per provincie" above the gemeenten on /plaatsen/: twelve links to the province pages, so the
 * long list is not the only way into a region.
 */
export function renderProvinceNav(provinces) {
  if (!provinces?.length) return '';
  const links = provinces.map((p) => `<li><a class="chip" href="/provincie/${escapeHtml(p.slug)}/">${escapeHtml(p.name)}</a></li>`).join('');
  return `<nav class="list-group province-nav" aria-labelledby="province-nav-title"><h2 id="province-nav-title">Per provincie</h2><ul class="chips">${links}</ul></nav>\n`;
}
