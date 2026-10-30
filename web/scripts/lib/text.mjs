/**
 * Dutch copy for the generated entity pages: labels, intros, FAQs, titles and descriptions.
 * Everything here is built from the static facts we actually have (names, gemeente, provincie,
 * road/water) — no live counts, no promises we cannot keep.
 */

import { escapeHtml } from './render.mjs';

export const PLANNING_REFRESH_MINUTES = 15;

export const ROAD_KIND = {
  A: { label: 'Autosnelweg · rijksweg', badge: 'a', groupTitle: 'Autosnelwegen (A-wegen)' },
  N: { label: 'N-weg · provinciale weg of rijksweg', badge: 'n', groupTitle: 'N-wegen' },
  S: { label: 'Stadsroute', badge: 's', groupTitle: 'Stadsroutes (s-wegen)' },
  E: { label: 'Europese route', badge: 'e', groupTitle: 'Europese routes (E-wegen)' },
  overig: { label: 'Weg', badge: 'lokaal', groupTitle: 'Overige wegen' },
};

/**
 * Publisher lines for colofon, contact and over, from site.config `owner`. All fields are
 * optional: since 2026-10-25 the site names its maker by first name only (for the AdSense
 * review); with an empty `owner.name` the pages call Wegwerk a private initiative. Without a KvK
 * number nothing is said about registration: a "once registered" promise reads as an unfinished
 * site. Dutch law (art. 3:15d BW) asks a site
 * that earns money for the publisher's name and geographic address (`owner.address`, e.g.
 * "Dorpsstraat 1, 1234 AB Utrecht"), and the KvK and btw numbers once registered; `owner.city`
 * alone is the lighter option. Plain text: the values go into Markdown, which escapes them.
 */
export function publisherVars(owner) {
  const field = (key) => String(owner?.[key] ?? '').trim();
  const [name, address, city, kvk, btw] = ['name', 'address', 'city', 'kvk', 'btw'].map(field);
  const inCity = city ? ` (${city})` : '';
  // The address belongs in colofon and contact; "Over" names the maker, not the street.
  const who = name ? `${name}${address ? `, ${address}` : inCity}` : '';
  const maker = name ? `${name}${inCity}` : '';
  return {
    sentence: who ? `Wegwerk wordt uitgegeven door ${who}.` : 'Wegwerk is een particulier initiatief.',
    byline: maker ? `Wegwerk wordt gemaakt en onderhouden door ${maker}, los van de wegbeheerders.` : 'Wegwerk wordt onafhankelijk gemaakt en onderhouden, los van de wegbeheerders.',
    registration: kvk
      ? `KvK-nummer ${kvk}${btw ? `, btw-identificatienummer ${btw}` : ''}.`
      : '',
  };
}

export function roadKind(type) {
  return ROAD_KIND[type] ?? ROAD_KIND.overig;
}

/** "a, b en c" */
export function joinDutch(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} en ${list[list.length - 1]}`;
}

/** Meta descriptions: Google shows ~155–160 characters. */
export const DESCRIPTION_MAX = 158;

/**
 * Pick the first variant that fits within `max` characters, so a meta description degrades
 * gracefully (drop the optional details) instead of being cut off mid-sentence. The last
 * variant is clamped as a final resort.
 */
export function fitText(variants, max = DESCRIPTION_MAX) {
  const list = variants.filter((v) => typeof v === 'string' && v.trim() !== '');
  for (const v of list) {
    const s = v.replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
  }
  return clampText(list[list.length - 1] ?? '', max);
}

/**
 * Titles: Google shows about 60 characters before it cuts the title off or rewrites it (on
 * 2026-10-20 the 76–89 character titles showed up as "Wegwerkzaamheden A12 - WEGWERK Nederland").
 */
export const TITLE_MAX = 60;

/**
 * First title variant that fits `TITLE_MAX`. A title is never cut off with "…": when nothing fits,
 * the last (shortest) variant is used whole, because it carries the part that keeps it unique.
 */
export function fitTitle(variants) {
  const list = variants.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.replace(/\s+/g, ' ').trim());
  return list.find((v) => v.length <= TITLE_MAX) ?? list[list.length - 1] ?? '';
}

/** Trim a description to ~`max` chars at a word boundary. */
export function clampText(text, max = DESCRIPTION_MAX) {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,;:–-]$/, '')}…`;
}

const NL_DATE = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long', year: 'numeric' });
const NL_DATETIME = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : NL_DATE.format(d);
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : NL_DATETIME.format(d).replace(' om ', ', ');
}

const NL_DAY_PARTS = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short' });
const MS_DAY = 24 * 60 * 60 * 1000;

function dayParts(ms) {
  const parts = Object.fromEntries(NL_DAY_PARTS.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, day: parts.day, month: parts.month };
}

/** "di 20 okt": the Amsterdam day of `iso`, for the title of /vandaag/. '' for a bad date. */
export function todayLabel(iso) {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const { weekday, day, month } = dayParts(ms);
  return `${weekday} ${day} ${month}`;
}

/**
 * "23–26 okt" or "30 okt – 2 nov": Friday to Monday of the weekend /dit-weekend/ shows, for its
 * title. The page is rebuilt once a day (deploy.yml, 04:41 UTC), so the label must hold for the
 * whole day after the build: on Saturday and Sunday it is the weekend in progress, from Monday on
 * the coming one (the map's own window, web/src/data/time.ts, still looks back until Monday 06:00).
 * Noon keeps the day arithmetic clear of daylight-saving changes. '' for a bad date.
 */
export function weekendLabel(iso) {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const [y, m, d] = new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' }).split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  const offset = [-2, 4, 3, 2, 1, 0, -1][new Date(noon).getUTCDay()]; // Sunday … Saturday → Friday
  const friday = dayParts(noon + offset * MS_DAY);
  const monday = dayParts(noon + (offset + 3) * MS_DAY);
  return friday.month === monday.month
    ? `${friday.day}–${monday.day} ${monday.month}`
    : `${friday.day} ${friday.month} – ${monday.day} ${monday.month}`;
}

/**
 * Endpoint names that need an article in running text: borders/coasts ("de Duitse grens") and
 * road numbers, which VILD sometimes uses as a route endpoint ("de N842/s106").
 */
function withArticle(place) {
  if (/^[ANSEans]\d+[a-z]?(\/[ANSEans]\d+[a-z]?)*$/.test(place)) return `de ${place}`;
  return /(grens|kust)$/i.test(place) ? `de ${place}` : place;
}

/* ------------------------------------------------------------------------------------------ */
/* Roads                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const ROAD_CODE_RE = /^[AENS]\d+[a-z]?(\/[AENS]\d+[a-z]?)*$/i;

/** Split `names` into route segments, E-codes and local road names. */
export function analyseRoadNames(names = []) {
  const segments = [];
  const eCodes = new Set();
  const local = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const arrow = name.split(/\s*(?:→|->|—>|=>)\s*/);
    if (arrow.length === 2 && arrow[0] && arrow[1]) {
      segments.push({ from: arrow[0], to: arrow[1] });
      continue;
    }
    if (ROAD_CODE_RE.test(name)) {
      for (const code of name.split('/')) if (/^E\d+/i.test(code)) eCodes.add(code.toUpperCase());
      continue;
    }
    if (!local.includes(name)) local.push(name);
  }
  return { segments, eCodes: [...eCodes], local };
}

function routeSentence(road, segments) {
  if (!segments.length) return '';
  const chained = segments.every((s, i) => i === 0 || segments[i - 1].to === s.from);
  if (chained) {
    const via = [];
    for (let i = 1; i < segments.length; i++) if (!via.includes(segments[i].from)) via.push(segments[i].from);
    const from = withArticle(segments[0].from);
    const to = withArticle(segments[segments.length - 1].to);
    if (!via.length) return `De ${road} loopt van ${from} naar ${to}.`;
    const viaText = via.length > 5 ? `onder meer ${joinDutch(via.slice(0, 5))}` : joinDutch(via);
    return `De ${road} loopt van ${from} via ${viaText} naar ${to}.`;
  }
  const places = [];
  for (const s of segments) for (const p of [s.from, s.to]) if (!places.includes(p)) places.push(p);
  return `De ${road} verbindt onder meer ${joinDutch(places.slice(0, 6).map(withArticle))}.`;
}

function roadTypeSentence(road, type, hasRoute) {
  switch (type) {
    case 'A':
      return hasRoute
        ? `Als autosnelweg is de ${road} bijna overal in beheer bij Rijkswaterstaat; groot onderhoud wordt meestal 's nachts of in het weekend uitgevoerd en ruim vooraf aangemeld.`
        : `De ${road} is een autosnelweg (rijksweg), bijna overal in beheer bij Rijkswaterstaat; groot onderhoud wordt meestal 's nachts of in het weekend uitgevoerd en ruim vooraf aangemeld.`;
    case 'N':
      return `${hasRoute ? 'De weg is een N-weg' : `De ${road} is een N-weg`}: meestal een provinciale weg, bij de lagere nummers vaak een rijksweg van Rijkswaterstaat.`;
    case 'S':
      return `${hasRoute ? 'De route is een stadsroute (s-weg)' : `De ${road} is een stadsroute (s-weg)`} in beheer bij de gemeente. Werkzaamheden worden door de gemeente en haar aannemers aangemeld in Melvin, het landelijke meldsysteem van de Nederlandse wegbeheerders.`;
    case 'E':
      return `De ${road} is een Europese route die over bestaande Nederlandse A- en N-wegen loopt; de meldingen komen van de wegbeheerders van die wegen.`;
    default:
      return `De meldingen voor de ${road} komen van de wegbeheerder die de weg onderhoudt.`;
  }
}

/**
 * Pre-rendered intro paragraph (HTML) for a road page. How fresh the data is stands in the stamp
 * above the list; saying it again here made the same sentence part of ~600 road pages.
 */
export function roadIntro(entry) {
  const { road, type, names } = entry;
  const { segments, eCodes, local } = analyseRoadNames(names);
  const parts = [];
  const route = routeSentence(road, segments);
  if (route) parts.push(route);
  parts.push(roadTypeSentence(road, type, Boolean(route)));
  if (local.length === 1) parts.push(`Een deel van de weg staat ook bekend als ${local[0]}.`);
  else if (local.length > 1) parts.push(`Delen van de weg staan ook bekend als ${joinDutch(local.slice(0, 6))}.`);
  if (eCodes.length) parts.push(`De weg maakt deel uit van de Europese ${eCodes.length > 1 ? 'routes' : 'route'} ${joinDutch(eCodes)}.`);
  const first = `<p>${escapeHtml(parts.join(' '))}</p>`;
  const second =
    `<p>Op deze pagina zie je alle werkzaamheden, afsluitingen, omleidingen en evenementen met verkeersmaatregelen op de ${escapeHtml(road)} ` +
    `die nu gelden of binnen 30 dagen beginnen, plus de files van dit moment, uit de open data van het Nationaal Dataportaal Wegverkeer (NDW).</p>`;
  return first + second;
}

export function roadRouteShort(entry) {
  const { segments } = analyseRoadNames(entry.names);
  if (!segments.length) return '';
  return ` (${withArticle(segments[0].from)} – ${withArticle(segments[segments.length - 1].to)})`;
}

/**
 * Entity-page titles and descriptions (2026-10-20, docs/groei-onderzoek-2026-10.md): the search
 * term first, at most `TITLE_MAX` characters, a reason to click, and no " | Wegwerk" (Google adds
 * the site name itself). Descriptions open with the question people type and end with how fresh
 * the data is.
 */
const FRESHNESS = 'Elk kwartier bijgewerkt.';

export function roadTitle(entry) {
  return fitTitle([
    `${entry.road} afsluitingen & werkzaamheden: vandaag en dit weekend`,
    `${entry.road} afsluitingen & werkzaamheden`,
  ]);
}

export function roadDescription(entry) {
  const ask = `Is de ${entry.road} dicht?`;
  const what = `Afsluitingen en werkzaamheden op de ${entry.road}`;
  const route = roadRouteShort(entry);
  return fitText([
    `${ask} ${what}${route}: vandaag, dit weekend en de komende 30 dagen, plus de files. ${FRESHNESS}`,
    `${ask} ${what}${route}: vandaag, dit weekend en de komende 30 dagen. ${FRESHNESS}`,
    `${ask} ${what}: vandaag, dit weekend en de komende 30 dagen, plus de files. ${FRESHNESS}`,
  ]);
}

/**
 * The questions that differ per road type. "Is de A2 dit weekend dicht?" and "how fresh" are
 * answered with data above the FAQ (the question block and the stamp), not with template text.
 */
export function roadFaq(entry) {
  const { road, type } = entry;
  const r = escapeHtml(road);
  const announce = type === 'A'
    ? `Rijkswaterstaat meldt afsluitingen op de ${r} doorgaans één tot twee weken vooraf aan`
    : `Wegbeheerders melden afsluitingen op de ${r} meestal minstens een week vooraf aan`;
  let authority;
  switch (type) {
    case 'A':
      authority = `De ${r} is een rijksweg, bijna overal in beheer bij Rijkswaterstaat. Vragen of meldingen over de weg zelf kun je kwijt bij de gratis Landelijke Informatielijn 0800-8002 of via rijkswaterstaat.nl. Werk dat door een andere partij is aangemeld, bijvoorbeeld bij een aansluiting, staat met die partij als bron in de lijst.`;
      break;
    case 'N':
      authority = `N-wegen zijn meestal in beheer bij de provincie; een aantal N-wegen met een laag nummer is rijksweg en valt onder Rijkswaterstaat. Bij elke melding in het overzicht staat welke wegbeheerder haar heeft ingevoerd; daar kun je ook terecht met vragen over de uitvoering.`;
      break;
    case 'S':
      authority = `Stadsroutes (s-wegen) zijn in beheer bij de gemeente. Bij elke melding staat de gemeente of aannemer die haar heeft ingevoerd; meldingen over de weg zelf doe je via de website of app van de gemeente.`;
      break;
    default:
      authority = `Bij elke melding in het overzicht staat welke wegbeheerder haar heeft ingevoerd: Rijkswaterstaat, een provincie of een gemeente. Daar kun je ook terecht met vragen over de uitvoering.`;
  }
  return [
    {
      q: `Hoe ver vooruit staan afsluitingen op de ${road}?`,
      a: `${announce}; hierboven staan ze zodra dat is gebeurd. Alle afsluitingen van dit weekend in heel Nederland vind je op de pagina <a href="/dit-weekend/">dit weekend</a>.`,
    },
    { q: `Wie is de wegbeheerder van de ${road}?`, a: authority },
  ];
}

/* ------------------------------------------------------------------------------------------ */
/* Places                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * The names people search for instead of the official one. "Den Bosch" stood nowhere on the
 * site, while /gemeente/s-hertogenbosch/ is the page with the most clicks.
 */
export const PLACE_ALIASES = new Map([
  ["'s-Hertogenbosch", 'Den Bosch'],
  ["'s-Gravenhage", 'Den Haag'],
]);

export function placeAlias(naam) {
  return PLACE_ALIASES.get(naam) ?? '';
}

/** "Den Bosch ('s-Hertogenbosch)", or just the name when it has no alias. */
function placeLabel(naam) {
  const alias = placeAlias(naam);
  return alias ? `${alias} (${naam})` : naam;
}

/**
 * Whether a gemeente has a woonplaats of its own name (Eindhoven, Utrecht: 227 of 342). People
 * then search for the place, not the gemeente, so its title and description drop "gemeente";
 * Haarlemmermeer or Altena keep it.
 */
export function hasSameNameKern(gemeente, woonplaatsen) {
  return woonplaatsen.some((w) => w.naam === gemeente.naam);
}

/**
 * `sameNameKern` (gemeente pages, see hasSameNameKern). A woonplaats keeps its gemeente in the
 * title: 70 woonplaats names occur twice. A woonplaats named like its gemeente (/plaats/eindhoven/)
 * says "(woonplaats)" instead, so it does not repeat the gemeente page's title.
 */
export function placeTitle(place, kind, { sameNameKern = false } = {}) {
  const name = placeAlias(place.naam) || place.naam;
  let who;
  if (kind === 'gemeente') who = sameNameKern ? name : `gemeente ${name}`;
  else who = place.naam === place.gemeente ? `${name} (woonplaats)` : `${name} (${place.gemeente})`;
  return fitTitle([`Wegwerkzaamheden ${who}: wat is nu dicht?`, `Wegwerkzaamheden ${who}: wat is dicht?`, `Wegwerkzaamheden ${who}`]);
}

/** "Welke wegen zijn nu dicht in <where>?" with the longest details that still fit. */
function placeQuestionDescription(wheres) {
  const what = 'Alle wegwerkzaamheden en afsluitingen, vandaag en de komende 30 dagen.';
  const shorter = 'Werkzaamheden en afsluitingen, vandaag en de komende 30 dagen.';
  return fitText([
    ...wheres.map((w) => `Welke wegen zijn nu dicht in ${w}? ${what} ${FRESHNESS}`),
    ...wheres.map((w) => `Welke wegen zijn nu dicht in ${w}? ${shorter} ${FRESHNESS}`),
    `Welke wegen zijn nu dicht in ${wheres[wheres.length - 1]}? ${shorter}`,
  ]);
}

export function placeDescription(place, kind, { sameNameKern = false } = {}) {
  const label = placeLabel(place.naam);
  const inProv = (where) => (place.prov ? [`${where} (${place.prov})`, where] : [where]);
  if (kind === 'gemeente') return placeQuestionDescription(inProv(sameNameKern ? label : `de gemeente ${label}`));
  if (place.naam === place.gemeente) return placeQuestionDescription(inProv(`de woonplaats ${label}`));
  // The gemeente stays in every variant: it tells apart the 70 woonplaats names that occur twice.
  const gem = `gemeente ${place.gemeente}`;
  return placeQuestionDescription(place.prov ? [`${label} (${gem}, ${place.prov})`, `${label} (${gem})`] : [`${label} (${gem})`]);
}

export function placeHeading(place, kind) {
  const alias = placeAlias(place.naam);
  if (kind === 'gemeente') return alias ? `Wegwerkzaamheden ${alias} (gemeente ${place.naam})` : `Wegwerkzaamheden gemeente ${place.naam}`;
  return `Wegwerkzaamheden in ${placeLabel(place.naam)}`;
}

export function mapHref(lon, lat, zoom) {
  return `/?c=${lon.toFixed(4)},${lat.toFixed(4)}&z=${zoom}`;
}

/**
 * Pre-rendered intro of a place page: where it lies and, for a gemeente, its places. How the
 * meldingen get here (Melvin, NDW) is told once, in /uitleg/waar-komt-de-data-vandaan/; on every
 * place page it was ~60 identical words.
 */
export function placeIntro(place, kind, woonplaatsen) {
  const naam = escapeHtml(place.naam);
  const prov = escapeHtml(place.prov ?? '');
  const alias = placeAlias(place.naam);
  const aka = alias ? `, beter bekend als ${escapeHtml(alias)},` : '';
  const parts = [];
  if (kind === 'gemeente') {
    const allNames = woonplaatsen.map((w) => w.naam);
    const hasOwnName = allNames.includes(place.naam);
    const names = allNames.filter((n) => n !== place.naam);
    parts.push(`De gemeente ${naam}${aka} ligt in de provincie ${prov}.`);
    if (names.length > 0) {
      const shown = names.slice(0, 8);
      const rest = names.length - shown.length;
      // "A, B en C" — but with a rest clause the last shown name keeps its comma:
      // "A, B, C en nog 81 andere plaatsen".
      const list = rest > 0
        ? `${shown.join(', ')} en nog ${rest} andere ${rest === 1 ? 'plaats' : 'plaatsen'}`
        : joinDutch(shown);
      parts.push(
        hasOwnName
          ? `Naast ${naam} zelf ${names.length === 1 ? 'hoort' : 'horen'} volgens de Basisregistratie Adressen en Gebouwen ${escapeHtml(list)} bij de gemeente; elke plaats heeft hieronder een eigen pagina.`
          : `Tot de gemeente ${names.length === 1 ? 'hoort' : 'horen'} volgens de Basisregistratie Adressen en Gebouwen ${escapeHtml(list)}; elke plaats heeft hieronder een eigen pagina.`,
      );
    } else if (hasOwnName) {
      parts.push(`De gemeente telt volgens de Basisregistratie Adressen en Gebouwen één woonplaats: ${naam} zelf.`);
    }
    parts.push(
      `Op deze pagina zie je alle wegwerkzaamheden, afsluitingen, omleidingen en evenementen met verkeersmaatregelen binnen de gemeente die nu gelden of binnen 30 dagen beginnen: op rijkswegen (Rijkswaterstaat), provinciale wegen (provincie ${prov}) en op de straten van de gemeente zelf.`,
    );
  } else {
    const sameName = place.naam === place.gemeente;
    parts.push(
      sameName
        ? `${naam}${aka} is een woonplaats in de gelijknamige gemeente, in de provincie ${prov}.`
        : `${naam}${aka} is een woonplaats in de gemeente ${escapeHtml(place.gemeente)}, in de provincie ${prov}.`,
    );
    parts.push(
      `Op deze pagina zie je alle wegwerkzaamheden, afsluitingen, omleidingen en evenementen met verkeersmaatregelen in ${naam} die nu gelden of binnen 30 dagen beginnen.`,
    );
  }
  return `<p>${parts.join(' ')}</p>`;
}

/**
 * Questions about a place that the data above them does not answer. Why something may be missing
 * from the map is answered once, on /veelgestelde-vragen/.
 */
export function placeFaq(place, kind) {
  const naam = escapeHtml(place.naam);
  const gemeente = escapeHtml(kind === 'gemeente' ? place.naam : place.gemeente);
  const prov = escapeHtml(place.prov ?? '');
  const here = kind === 'gemeente' ? `in de gemeente ${naam}` : `in ${naam}`;
  return [
    {
      q: `Wie voert de werkzaamheden ${here} uit en waar kan ik terecht met vragen?`,
      a: `Bij elke melding staat de wegbeheerder die haar heeft aangemeld: de gemeente ${gemeente} voor straten binnen de bebouwde kom, de provincie ${prov} voor provinciale N-wegen en Rijkswaterstaat voor rijkswegen. Vragen over planning, bereikbaarheid of overlast stel je aan die wegbeheerder; de gemeente heeft daarvoor meestal een meldpunt openbare ruimte op haar website.`,
    },
  ];
}

/* ------------------------------------------------------------------------------------------ */
/* Bridges                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** Words that precede the head noun in Dutch water names and never carry the gender. */
const WATER_MODIFIERS = new Set([
  'nieuw', 'nieuwe', 'oud', 'oude', 'groot', 'grote', 'klein', 'kleine', 'hoog', 'hoge', 'laag', 'lage',
  'zuid', 'zuider', 'noord', 'noorder', 'oost', 'ooster', 'west', 'wester', 'buiten', 'binnen',
  'voor', 'achter', 'boven', 'beneden', 'hollands', 'hollandsch', 'noordhollands', 'noordhollandsch',
  'zuidhollands', 'zuidhollandsch', 'van', 'den', 'der', 'ter', 'te',
]);

const WATER_NEUTER_RE = /(kanaal|diep|meer|water|gat|ij|spui|wiel|zwin|spaarne|scheur|vaarwater|wad|gouw|dok|ei|ie)$/i;

/**
 * Rough Dutch article for water names. The gender follows the head noun: the first word that is
 * not a directional or adjectival modifier. "het Kanaal door Walcheren", "de Ringvaart
 * Haarlemmermeer", "het Nieuwe Meer", "het Van Starkenborghkanaal", "de Oude Rijn".
 */
export function waterWithArticle(water) {
  let w = String(water).trim().replace(/^brug\s+(over|in)\s+(de\s+|het\s+)?/i, '');
  if (/^(de|het)\s/i.test(w)) return w;
  const words = w.split(/[\s,]+/).filter(Boolean);
  const head = words.find((x) => !WATER_MODIFIERS.has(x.toLowerCase())) ?? words[0] ?? w;
  return WATER_NEUTER_RE.test(head) ? `het ${w}` : `de ${w}`;
}

/**
 * Two bridges can carry the same fallback name ("Brug in de Buitenhaven bij Terneuzen").
 * Give every member of such a group a short, factual distinguishing label so titles,
 * descriptions and headings stay unique. Returns `Map<id, label>` (only for collisions).
 */
export function bridgeVariants(bridges) {
  const byName = new Map();
  for (const b of bridges) {
    if (!byName.has(b.name)) byName.set(b.name, []);
    byName.get(b.name).push(b);
  }
  const variants = new Map();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    if (group.length === 2) {
      const [p, q] = group;
      const dLatKm = Math.abs(p.lat - q.lat) * 110.57;
      const dLonKm = Math.abs(p.lon - q.lon) * 68.5;
      const [first, second] =
        dLatKm >= dLonKm
          ? [...group].sort((a, b) => b.lat - a.lat)
          : [...group].sort((a, b) => a.lon - b.lon);
      const labels = dLatKm >= dLonKm ? ['noordelijke brug', 'zuidelijke brug'] : ['westelijke brug', 'oostelijke brug'];
      variants.set(first.id, labels[0]);
      variants.set(second.id, labels[1]);
      continue;
    }
    const sorted = [...group].sort((a, b) => b.lat - a.lat || a.slug.localeCompare(b.slug, 'nl'));
    sorted.forEach((b, i) => variants.set(b.id, `brug ${i + 1} van ${sorted.length}, van noord naar zuid`));
  }
  return variants;
}

/**
 * The variant label keeps two same-named bridges apart, so every title variant keeps it. A place
 * the name already carries ("Hefbrug, Alphen aan den Rijn") is not repeated in brackets.
 */
export function bridgeTitle(bridge, variant = '') {
  const near = bridge.road || bridge.woonplaats || bridge.gemeente;
  const where = [near && !bridge.name.includes(near) ? near : '', variant].filter(Boolean).join(', ');
  const base = `Brugopeningen ${bridge.name}${where ? ` (${where})` : ''}`;
  return fitTitle([`${base}: vandaag en deze week`, base]);
}

export function bridgeDescription(bridge, variant = '') {
  const paren = (...bits) => {
    const list = bits.filter(Boolean);
    return list.length ? ` (${list.join(', ')})` : '';
  };
  // The variant label is what makes two same-named bridges distinguishable: never drop it.
  const wheres = [
    paren(bridge.road, bridge.woonplaats || bridge.gemeente, variant),
    paren(bridge.road || bridge.woonplaats || bridge.gemeente, variant),
    paren(variant),
  ];
  const tails = [
    ' open? Actuele status en de geplande openingen voor de komende 7 dagen, met de werkzaamheden in de buurt. Open data van NDW.',
    ' open? Actuele status en de geplande openingen voor de komende 7 dagen. Open data van NDW.',
    ' open? Actuele status en de geplande openingen. Open data van NDW.',
  ];
  const variants = [];
  for (const tail of tails) for (const where of wheres) variants.push(`Staat ${bridge.name}${where}${tail}`);
  return fitText(variants);
}

/** Where the bridge is. When openings are announced and how fresh the data is: the FAQ and the footer. */
export function bridgeIntro(bridge) {
  const name = escapeHtml(bridge.name);
  const bits = [];
  if (bridge.road) bits.push(`in de ${escapeHtml(bridge.road)}`);
  if (bridge.water) bits.push(`over ${escapeHtml(waterWithArticle(bridge.water))}`);
  if (bridge.woonplaats && bridge.woonplaats !== bridge.gemeente) bits.push(`bij ${escapeHtml(bridge.woonplaats)}`);
  let where = bits.length ? ` ${bits.join(' ')}` : '';
  if (bridge.gemeente) {
    const inGem = bridge.woonplaats && bridge.woonplaats !== bridge.gemeente ? `gemeente ${escapeHtml(bridge.gemeente)}` : `in ${escapeHtml(bridge.gemeente)}`;
    where += bridge.prov ? ` (${inGem}, ${escapeHtml(bridge.prov)})` : ` (${inGem})`;
  } else if (bridge.prov) {
    where += ` (${escapeHtml(bridge.prov)})`;
  }
  return `<p>${name} is een beweegbare brug${where}. Gaat de brug open voor de scheepvaart, dan staat het wegverkeer erover stil; op deze pagina zie je of de brug nu open is en welke openingen voor de komende zeven dagen bij het Nationaal Dataportaal Wegverkeer (NDW) zijn aangemeld.</p>`;
}

export function bridgeFaq(bridge) {
  const name = escapeHtml(bridge.name);
  const road = bridge.road ? ` op de ${escapeHtml(bridge.road)}` : '';
  return [
    {
      q: `Wanneer gaat ${bridge.name} open?`,
      a: `De geplande openingen voor de komende zeven dagen staan hierboven, zoals de brugbeheerder ze bij NDW heeft aangemeld. Veel bruggen gaan alleen open op aanvraag van de scheepvaart of op vaste tijden buiten de spits, en niet elke opening wordt vooraf gemeld. Staat ${name} nu open, dan zie je dat bovenaan de pagina.`,
    },
    {
      q: `Wat betekent een brugopening voor het wegverkeer${bridge.road ? ` op de ${bridge.road}` : ''}?`,
      a: `Tijdens een opening is de weg over de brug${road} in beide richtingen dicht. Er is geen omleiding: je wacht voor de slagbomen tot de brug weer gesloten is. Op drukke routes ontstaat daardoor soms een korte file die na de opening weer oplost. Fietsers en voetgangers wachten net als het overige verkeer.`,
    },
  ];
}
