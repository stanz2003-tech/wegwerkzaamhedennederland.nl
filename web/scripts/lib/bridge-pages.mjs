/**
 * Bridges in a road (/brug/<slug>/ for the 286 registry bridges with a road number): the copy,
 * the template variables and the links from road, place and list pages.
 *
 * Stan, 2026-11-04: googling "Merwedebrug" or "Gorkumse brug" found nothing on the site, while
 * that A27 bridge at Gorinchem is a stretch with a lot of trouble. Its page was an openings page
 * for a bridge that never opens (empty, noindex). A bridge in a road now answers "Kan ik over de
 * Merwedebrug?" like a road page (web/src/pages/bridge-road.ts); the items are the road's
 * meldingen that touch the bridge (web/src/data/bridge-select.ts). A bridge without a road stays
 * an openings page, exactly as before.
 *
 * Curated aliases and radii: web/src/data/bridge-aliases.json (read here with readFileSync, so the
 * page model stays synchronous).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapeHtml } from './render.mjs';
import { FRESHNESS, fitText, fitTitle, joinDutch, waterWithArticle } from './text.mjs';

const FALLBACK_EXTRAS = { defaultRadiusKm: 1.2, bridges: {} };

/** bridge-aliases.json; the built-in default (no aliases) when it is missing or broken. */
export function loadBridgeExtras(webRoot, warn = console.warn) {
  const file = join(webRoot, 'src', 'data', 'bridge-aliases.json');
  if (!existsSync(file)) return FALLBACK_EXTRAS;
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const radius = Number(json.defaultRadiusKm);
    return {
      defaultRadiusKm: Number.isFinite(radius) && radius > 0 ? radius : FALLBACK_EXTRAS.defaultRadiusKm,
      bridges: json.bridges && typeof json.bridges === 'object' ? json.bridges : {},
    };
  } catch (err) {
    warn(`[gen-pages] bridge-aliases.json: ${err.message}`);
    return FALLBACK_EXTRAS;
  }
}

export const isRoadBridge = (b) => typeof b.road === 'string' && b.road.trim() !== '';

/** RIS bridges can carry openings; a `VILD-` bridge (named from the AlertC table) never does. */
export const isMovableBridge = (b) => !String(b.id).startsWith('VILD-');

export function bridgeAliases(b, extras) {
  const list = extras.bridges[b.slug]?.aliases;
  return Array.isArray(list) ? list.filter((a) => typeof a === 'string' && a.trim() !== '') : [];
}

export function bridgeRadiusKm(b, extras) {
  const r = Number(extras.bridges[b.slug]?.radiusKm);
  return Number.isFinite(r) && r > 0 ? r : extras.defaultRadiusKm;
}

/**
 * Indexable whatever the openings say: a bridge in an A-road (its page carries the road's status
 * and the day strip, also on a quiet day) and every bridge in bridge-aliases.json.
 */
export function alwaysIndexedBridge(b, extras) {
  return (isRoadBridge(b) && /^A\s*\d/i.test(b.road)) || Object.prototype.hasOwnProperty.call(extras.bridges, b.slug);
}

/** "Merwedebrug Gorinchem" from "Merwedebrug bij Gorinchem"; "Maasbrug" from "Maasbrug (A2)" when the road follows. */
export function shortBridgeName(b) {
  const road = b.road ? b.road.trim() : '';
  let name = b.name.replace(/\s+bij\s+/i, ' ');
  if (road) name = name.replace(new RegExp(`\\s*\\(${road}\\)`, 'i'), '');
  return name.trim();
}

/** Same as bridgeWithArticle in web/src/data/bridge-select.ts: "de Merwedebrug bij Gorinchem", "De Mark". */
export function bridgeWithArticle(name) {
  if (/^(de|het)\s/i.test(name)) return name;
  if (/^brug\s/i.test(name)) return `de ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  return `de ${name}`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function radiusText(km) {
  return `${String(Math.round(km * 10) / 10).replace('.', ',')} km`;
}

/** "(A27)" unless the name already carries the road number ("Schipholbrug (Rijksweg A9)"). */
function roadParen(b, variant, name = b.name) {
  const bits = [name.toUpperCase().includes(b.road.toUpperCase()) ? '' : b.road, variant].filter(Boolean);
  return bits.length ? ` (${bits.join(', ')})` : '';
}

/** "Merwedebrug Gorinchem (A27): afsluitingen en werk" — the search term first, at most 60 characters. */
export function roadBridgeTitle(b, variant = '', movable = isMovableBridge(b)) {
  const short = shortBridgeName(b);
  const base = `${short}${roadParen(b, variant, short)}`;
  return fitTitle(
    movable
      ? [`${base}: afsluitingen, werk en brugopeningen`, `${base}: afsluitingen en brugopeningen`, `${base}: afsluitingen en werk`, base]
      : [`${base}: afsluitingen en werk`, `${base}: afsluitingen`, base],
  );
}

/**
 * "Kan ik over de Merwedebrug bij Gorinchem (A27)? Stand wo 4 nov 16:53: Rijbaan dicht …": the
 * question people type, the build's answer (so the description is never the same template text
 * on every bridge), what the page holds, an alias when it fits.
 */
export function roadBridgeDescription(b, { variant = '', aliases = [], headline = '', asOf = '', movable = isMovableBridge(b) } = {}) {
  const ask = `Kan ik over ${bridgeWithArticle(b.name)}${roadParen(b, variant)}?`;
  const now = headline ? ` Stand ${asOf ? `${asOf}: ` : ''}${headline.replace(/[.\s]+$/, '')}.` : '';
  const what = movable
    ? ' Afsluitingen, werk en brugopeningen op en rond de brug, vandaag en de komende 30 dagen.'
    : ' Afsluitingen en werk op en rond de brug, vandaag en de komende 30 dagen.';
  const short = ' Afsluitingen en werk op en rond de brug.';
  const aka = aliases.length ? ` Ook: ${aliases[0]}.` : '';
  return fitText([
    `${ask}${now}${what}${aka} ${FRESHNESS}`,
    `${ask}${now}${what} ${FRESHNESS}`,
    `${ask}${now}${what}`,
    `${ask}${now}${short}`,
    // A long headline: the verdict matters more than the description of the page.
    ...(now ? [`${ask}${now}`, `${b.name}${roadParen(b, variant)}.${now}`] : []),
    `${ask}${what} ${FRESHNESS}`,
  ]);
}

/** Where the bridge is and what the page answers. */
export function roadBridgeIntro(b, movable = isMovableBridge(b)) {
  const bits = [`in de ${escapeHtml(b.road)}`];
  if (b.water) bits.push(`over ${escapeHtml(waterWithArticle(b.water))}`);
  let where = bits.join(' ');
  const place = b.woonplaats && b.woonplaats !== b.gemeente ? `bij ${escapeHtml(b.woonplaats)}, gemeente ${escapeHtml(b.gemeente)}` : b.gemeente ? `in ${escapeHtml(b.gemeente)}` : '';
  const paren = [place, b.prov ? escapeHtml(b.prov) : ''].filter(Boolean).join(', ');
  if (paren) where += ` (${paren})`;
  const opens = movable
    ? ' Het is een beweegbare brug: gaat hij open voor de scheepvaart, dan staat het verkeer erover stil. De aangemelde openingen staan onder de meldingen.'
    : '';
  return `<p>${escapeHtml(capitalize(bridgeWithArticle(b.name)))} ligt ${where}. Hieronder zie je of je er nu en de komende twee weken overheen kunt, met de auto, met vrachtverkeer of op de fiets.${opens}</p>`;
}

/** The sentence that says plainly what counts: also work just before or after the bridge. */
export function roadBridgeScope(b, radiusKm) {
  return `Werk vlak voor en na de brug telt mee: alle meldingen op de ${escapeHtml(b.road)} binnen ${radiusText(radiusKm)} van de brug, en meldingen die de brug bij naam noemen. Zo mis je ook een dichte op- of afrit of een afgesloten rijbaan in de aanloop naar de brug.`;
}

/** Questions about the bridge itself; a movable bridge keeps its two questions about openings. */
export function roadBridgeFaq(b, { radiusKm, roadHref = '', movable = isMovableBridge(b), openingsFaq = [] }) {
  const the = bridgeWithArticle(b.name);
  const r = escapeHtml(b.road);
  const authority = /^A/i.test(b.road)
    ? `De ${r} is een rijksweg; de brug is in beheer bij Rijkswaterstaat. Vragen over de brug zelf kun je kwijt bij de gratis Landelijke Informatielijn 0800-8002.`
    : `Bij elke melding staat welke wegbeheerder haar heeft aangemeld; bij hem kun je terecht met vragen over de uitvoering.`;
  return [
    {
      q: `Is ${the} dicht?`,
      a: `Het antwoord staat bovenaan deze pagina, voor nu en voor elke dag van de komende twee weken. Een afsluiting van de brug zelf telt mee, ook als maar één richting dicht is. Is alleen een op- of afrit vlak ervoor dicht, dan staat dat er apart bij en kun je over de brug zelf gewoon door. ${authority}`,
    },
    {
      q: `Welke meldingen tellen mee voor ${the}?`,
      a: `Alle meldingen op de ${r} binnen ${radiusText(radiusKm)} van de brug, gemeten tot de dichtstbijzijnde plek van het traject, en meldingen die ${escapeHtml(the)} bij naam noemen. Werk op een andere weg vlakbij telt niet mee.${roadHref ? ` De hele ${r} staat op <a href="${escapeHtml(roadHref)}">de pagina van de ${r}</a>.` : ''}`,
    },
    ...(movable ? openingsFaq : []),
  ];
}

/* ------------------------------------------------------------------------------------------ */
/* Links                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** A page that exists and is in Google: links go only there (no noindex page). */
function linkable(model, path) {
  const page = model.byPath.get(path);
  return Boolean(page) && page.thin !== true;
}

const KM_PER_DEG_LAT = 110.57;

/**
 * Bridges along a road, ordered along it: north to south for a road that runs mainly north–south
 * (the A27), west to east otherwise, from the spread of its bridges.
 */
export function orderAlong(bridges) {
  if (bridges.length < 2) return [...bridges];
  const lats = bridges.map((b) => b.lat);
  const lons = bridges.map((b) => b.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const height = (Math.max(...lats) - Math.min(...lats)) * KM_PER_DEG_LAT;
  const width = (Math.max(...lons) - Math.min(...lons)) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  return [...bridges].sort(height >= width ? (a, b) => b.lat - a.lat : (a, b) => a.lon - b.lon);
}

const linkOf = (b, sub) => ({ name: b.name, href: `/brug/${b.slug}/`, sub });

/** "Bruggen op de A27" on /weg/a27/: the road's bridges along the road, with their water. */
export function bridgesOnRoad(model, road) {
  const own = model.lists.bridges.filter((b) => isRoadBridge(b) && b.road.toUpperCase() === road.road.toUpperCase());
  return orderAlong(own)
    .filter((b) => linkable(model, `/brug/${b.slug}/`))
    .map((b) => linkOf(b, [b.water ? `over ${waterWithArticle(b.water)}` : '', b.woonplaats || b.gemeente].filter(Boolean).join(' · ')));
}

/** Bridges in a gemeente, or at a woonplaats: road bridges first, then by name. */
export function bridgesInPlace(model, page) {
  const p = page.entity;
  const pool = page.kind === 'gemeente' ? model.index.bridgesByGemeente.get(p.naam) ?? [] : (model.index.bridgesByGemeente.get(p.gemeente) ?? []).filter((b) => b.woonplaats === p.naam);
  return [...pool]
    .sort((a, b) => Number(isRoadBridge(b)) - Number(isRoadBridge(a)) || a.name.localeCompare(b.name, 'nl'))
    .filter((b) => linkable(model, `/brug/${b.slug}/`))
    .map((b) => linkOf(b, [b.road, b.water].filter(Boolean).join(' · ')));
}

/* ------------------------------------------------------------------------------------------ */
/* Template variables                                                                         */
/* ------------------------------------------------------------------------------------------ */

/**
 * The extra variables of a road bridge's page (templates/bridge.html `isRoadBridge`). `snap` is
 * the build's snapshot (snapshot.mjs) or null.
 */
export function roadBridgeVars(model, page, { variant, snap, href, roadEntry }) {
  const b = page.entity;
  const extras = model.index.bridgeExtras;
  const movable = isMovableBridge(b);
  const aliases = bridgeAliases(b, extras);
  const radiusKm = bridgeRadiusKm(b, extras);
  const the = bridgeWithArticle(b.name);
  const gem = b.gemeente ? model.index.gemeenteByName.get(b.gemeente.toLowerCase()) : null;
  const openings = snap?.openingsHtml ?? '';
  return {
    isRoadBridge: true,
    isMovable: movable,
    slug: b.slug,
    roadType: roadEntry?.type ?? '',
    roadSlug: roadEntry?.slug ?? '',
    gemeenteSlug: gem?.slug ?? '',
    heading: `${b.name}${variant ? ` (${variant})` : ''}`,
    question: `Kan ik over ${the}?`,
    theName: the,
    hasAliases: aliases.length > 0,
    aliasText: joinDutch(aliases),
    intro: roadBridgeIntro(b, movable),
    scopeHtml: roadBridgeScope(b, radiusKm),
    hasSnapshot: Boolean(snap?.answerHtml),
    snapshotAnswer: snap?.answerHtml ?? '',
    snapshotList: snap?.listHtml ?? '',
    hasOpeningsSnapshot: openings !== '',
    snapshotOpenings: openings,
    emptyHtml: `<p><strong>Geen meldingen voor ${escapeHtml(the)}.</strong> Op dit moment zijn er bij NDW geen actuele of geplande werkzaamheden, afsluitingen of files op de brug of op de ${escapeHtml(b.road)} vlak ervoor en erna bekend. Kijk op <a href="${escapeHtml(href)}">de kaart</a> voor de omgeving.</p>`,
    radiusKm,
    aliases,
  };
}
