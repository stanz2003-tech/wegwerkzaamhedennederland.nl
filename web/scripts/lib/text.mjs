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
      return `${hasRoute ? 'De weg is een N-weg' : `De ${road} is een N-weg`}: meestal een provinciale weg, bij de lagere nummers vaak een rijksweg van Rijkswaterstaat. Werkzaamheden op N-wegen gaan vaker gepaard met een volledige afsluiting en een omleiding, omdat er weinig ruimte is om het verkeer langs het werk te leiden.`;
    case 'S':
      return `${hasRoute ? 'De route is een stadsroute (s-weg)' : `De ${road} is een stadsroute (s-weg)`} in beheer bij de gemeente. Werkzaamheden worden door de gemeente en haar aannemers aangemeld in Melvin, het landelijke meldsysteem van de Nederlandse wegbeheerders.`;
    case 'E':
      return `De ${road} is een Europese route die over bestaande Nederlandse A- en N-wegen loopt; de meldingen komen van de wegbeheerders van die wegen.`;
    default:
      return `De meldingen voor de ${road} komen van de wegbeheerder die de weg onderhoudt.`;
  }
}

/** Pre-rendered intro paragraph (HTML) for a road page. */
export function roadIntro(entry, refresh) {
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
    `die nu gelden of binnen 30 dagen beginnen, plus de files van dit moment. De gegevens komen van het Nationaal Dataportaal Wegverkeer (NDW) ` +
    `en worden automatisch bijgewerkt: files, incidenten en brugopeningen elke ${refresh} minuten, de planning van werkzaamheden ongeveer elk kwartier.</p>`;
  return first + second;
}

export function roadRouteShort(entry) {
  const { segments } = analyseRoadNames(entry.names);
  if (!segments.length) return '';
  return ` (${withArticle(segments[0].from)} – ${withArticle(segments[segments.length - 1].to)})`;
}

export function roadTitle(entry, siteName) {
  return `Wegwerkzaamheden ${entry.road} – actuele werkzaamheden, afsluitingen en files | ${siteName}`;
}

export function roadDescription(entry) {
  const tail = ', nu en de komende 30 dagen, plus de files van dit moment. Open data van NDW.';
  return fitText([
    `Wegwerkzaamheden, afsluitingen en omleidingen op de ${entry.road}${roadRouteShort(entry)}${tail}`,
    `Wegwerkzaamheden, afsluitingen en omleidingen op de ${entry.road}${tail}`,
  ]);
}

function refreshAnswer(refresh) {
  return (
    `Wegwerk haalt de gegevens automatisch op bij het Nationaal Dataportaal Wegverkeer (NDW): files, incidenten en brugopeningen elke ${refresh} minuten, ` +
    `de planning van werkzaamheden ongeveer elk kwartier. Het tijdstip van de laatste update staat bovenaan de pagina. Je ziet wat de wegbeheerder heeft ingevoerd; ` +
    `werk kan eerder klaar zijn of uitlopen zonder dat de melding meteen wordt aangepast. Volg onderweg altijd de borden.`
  );
}

export function roadFaq(entry, refresh) {
  const { road, type } = entry;
  const r = escapeHtml(road);
  const announce = type === 'A' ? 'Rijkswaterstaat doet dat doorgaans één tot twee weken vooraf' : 'wegbeheerders doen dat meestal minstens een week vooraf';
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
      q: `Is de ${road} dit weekend dicht?`,
      a: `Weekendafsluitingen op de ${r} staan in het overzicht hierboven zodra de wegbeheerder ze heeft aangemeld; ${announce}. Kijk bij de geplande meldingen naar een afsluiting die op vrijdagavond begint en maandagochtend eindigt. Alle afsluitingen van dit weekend in heel Nederland vind je op de pagina <a href="/dit-weekend/">dit weekend</a>.`,
    },
    {
      q: `Waar vind ik de omleiding bij een afsluiting op de ${road}?`,
      a: `Klik op de afsluiting in de lijst: bij de details staat de omleidingsroute zoals de wegbeheerder die heeft aangemeld, bijvoorbeeld welke gele borden (letter of nummer) je volgt. Onderweg gaan de gele omleidingsborden altijd vóór op je navigatie; die kent de afsluiting niet altijd op tijd.`,
    },
    { q: `Hoe actueel is de informatie over de ${road}?`, a: refreshAnswer(refresh) },
    { q: `Wie is de wegbeheerder van de ${road}?`, a: authority },
  ];
}

/* ------------------------------------------------------------------------------------------ */
/* Places                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export function placeTitle(place, kind, siteName) {
  return kind === 'gemeente'
    ? `Wegwerkzaamheden gemeente ${place.naam} – alle werkzaamheden en afsluitingen | ${siteName}`
    : `Wegwerkzaamheden in ${place.naam} (${place.gemeente}) – actueel overzicht | ${siteName}`;
}

export function placeDescription(place, kind) {
  if (kind === 'gemeente') {
    const tail = ': rijkswegen, provinciale wegen en straten, nu en de komende 30 dagen. Open data van NDW.';
    return fitText([
      `Alle wegwerkzaamheden en afsluitingen in de gemeente ${place.naam} (${place.prov})${tail}`,
      `Alle wegwerkzaamheden en afsluitingen in de gemeente ${place.naam}${tail}`,
      `Alle wegwerkzaamheden en afsluitingen in de gemeente ${place.naam}, nu en de komende 30 dagen. Open data van NDW.`,
    ]);
  }
  const tail = ': wat nu geldt en wat binnen 30 dagen begint. Open data van NDW.';
  return fitText([
    `Wegwerkzaamheden, afsluitingen en omleidingen in ${place.naam} (gemeente ${place.gemeente}, ${place.prov})${tail}`,
    `Wegwerkzaamheden, afsluitingen en omleidingen in ${place.naam} (gemeente ${place.gemeente})${tail}`,
    `Wegwerkzaamheden, afsluitingen en omleidingen in ${place.naam}${tail}`,
  ]);
}

export function placeHeading(place, kind) {
  return kind === 'gemeente' ? `Wegwerkzaamheden gemeente ${place.naam}` : `Wegwerkzaamheden in ${place.naam}`;
}

export function mapHref(lon, lat, zoom) {
  return `/?c=${lon.toFixed(4)},${lat.toFixed(4)}&z=${zoom}`;
}

export function placeIntro(place, kind, woonplaatsen, refresh) {
  const naam = escapeHtml(place.naam);
  const prov = escapeHtml(place.prov ?? '');
  const parts = [];
  if (kind === 'gemeente') {
    const allNames = woonplaatsen.map((w) => w.naam);
    const hasOwnName = allNames.includes(place.naam);
    const names = allNames.filter((n) => n !== place.naam);
    parts.push(`De gemeente ${naam} ligt in de provincie ${prov}.`);
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
        ? `${naam} is een woonplaats in de gelijknamige gemeente, in de provincie ${prov}.`
        : `${naam} is een woonplaats in de gemeente ${escapeHtml(place.gemeente)}, in de provincie ${prov}.`,
    );
    parts.push(
      `Op deze pagina zie je alle wegwerkzaamheden, afsluitingen, omleidingen en evenementen met verkeersmaatregelen in ${naam} die nu gelden of binnen 30 dagen beginnen.`,
    );
  }
  const gemeente = escapeHtml(kind === 'gemeente' ? place.naam : place.gemeente);
  const second =
    `<p>Gemeentelijke werkzaamheden, van een rioolvervanging in een woonstraat tot een afgesloten kruispunt, worden door de gemeente ${gemeente} en haar aannemers aangemeld in Melvin, ` +
    `het landelijke meldsysteem van de Nederlandse wegbeheerders. Via het Nationaal Dataportaal Wegverkeer (NDW) komen die meldingen automatisch op deze pagina, samen met het werk van Rijkswaterstaat en de provincie. ` +
    `De planning wordt ongeveer elk kwartier vernieuwd, files en incidenten elke ${refresh} minuten.</p>`;
  return `<p>${parts.join(' ')}</p>${second}`;
}

export function placeFaq(place, kind, refresh) {
  const naam = escapeHtml(place.naam);
  const gemeente = escapeHtml(kind === 'gemeente' ? place.naam : place.gemeente);
  const prov = escapeHtml(place.prov ?? '');
  const here = kind === 'gemeente' ? `in de gemeente ${naam}` : `in ${naam}`;
  return [
    {
      q: `Welke wegwerkzaamheden zijn er nu ${kind === 'gemeente' ? `in de gemeente ${place.naam}` : `in ${place.naam}`}?`,
      a: `Het overzicht hierboven toont alle meldingen ${here} die op dit moment gelden, gevolgd door de werkzaamheden die binnen 30 dagen beginnen. Klik op een melding voor de periode, de verwachte hinder en de omleiding, of <a href="${mapHref(place.lon, place.lat, kind === 'gemeente' ? 11 : 13)}">open de kaart</a> om ook de omgeving te bekijken.`,
    },
    {
      q: `Waarom staat een afsluiting ${here} niet op de kaart?`,
      a: `Wegwerk toont wat wegbeheerders in Melvin hebben aangemeld. Kleine, kortdurende klussen, zoals een nutsbedrijf dat een paar uur een parkeerstrook gebruikt, hoeven niet altijd te worden gemeld, en soms voert een gemeente een werk pas laat in. Werk op particulier terrein of bij spoorwegovergangen (ProRail) zit meestal niet in de gegevens. Klopt er iets structureel niet, meld het dan bij de gemeente ${gemeente}.`,
    },
    {
      q: `Wie voert de werkzaamheden ${here} uit en waar kan ik terecht met vragen?`,
      a: `Bij elke melding staat de wegbeheerder die haar heeft aangemeld: de gemeente ${gemeente} voor straten binnen de bebouwde kom, de provincie ${prov} voor provinciale N-wegen en Rijkswaterstaat voor rijkswegen. Vragen over planning, bereikbaarheid of overlast stel je aan die wegbeheerder; de gemeente heeft daarvoor meestal een meldpunt openbare ruimte op haar website.`,
    },
    { q: 'Hoe actueel is deze pagina?', a: refreshAnswer(refresh) },
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

export function bridgeTitle(bridge, siteName, variant = '') {
  const where = [bridge.road || bridge.woonplaats || bridge.gemeente, variant].filter(Boolean).join(', ');
  return `Brugopeningen ${bridge.name}${where ? ` (${where})` : ''} – actuele en geplande openingen | ${siteName}`;
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

export function bridgeIntro(bridge, refresh) {
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
  const first = `<p>${name} is een beweegbare brug${where}. Gaat de brug open voor de scheepvaart, dan staat het wegverkeer erover stil; op deze pagina zie je of de brug nu open is en welke openingen voor de komende zeven dagen bij het Nationaal Dataportaal Wegverkeer (NDW) zijn aangemeld.</p>`;
  const second = `<p>De actuele status komt uit het verkeersbeeld van NDW en wordt elke ${refresh} minuten vernieuwd; de planning van openingen ongeveer elk kwartier. Niet elke brug meldt al zijn openingen vooraf: veel bruggen gaan open op aanvraag van de scheepvaart of op vaste tijden buiten de spits. Onder de openingen staan de wegwerkzaamheden in de buurt van de brug.</p>`;
  return first + second;
}

export function bridgeFaq(bridge, refresh) {
  const name = escapeHtml(bridge.name);
  const road = bridge.road ? ` op de ${escapeHtml(bridge.road)}` : '';
  return [
    {
      q: `Wanneer gaat ${bridge.name} open?`,
      a: `De geplande openingen voor de komende zeven dagen staan hierboven, zoals de brugbeheerder ze bij NDW heeft aangemeld. Veel bruggen gaan alleen open op aanvraag van de scheepvaart of op vaste tijden buiten de spits, en niet elke opening wordt vooraf gemeld. Staat ${name} nu open, dan zie je dat bovenaan de pagina.`,
    },
    {
      q: 'Hoe lang duurt een brugopening?',
      a: 'Meestal enkele minuten tot een kwartier, afhankelijk van het aantal schepen en van het type brug. Bij elke geplande opening staat de verwachte begin- en eindtijd. Houd er rekening mee dat het verkeer na een opening nog even nodig heeft om weer op gang te komen.',
    },
    {
      q: `Wat betekent een brugopening voor het wegverkeer${bridge.road ? ` op de ${bridge.road}` : ''}?`,
      a: `Tijdens een opening is de weg over de brug${road} in beide richtingen dicht. Er is geen omleiding: je wacht voor de slagbomen tot de brug weer gesloten is. Op drukke routes ontstaat daardoor soms een korte file die na de opening weer oplost. Fietsers en voetgangers wachten net als het overige verkeer.`,
    },
    {
      q: 'Hoe actueel is deze informatie?',
      a: `Of de brug nu open is, komt uit het actuele verkeersbeeld van NDW en wordt elke ${refresh} minuten vernieuwd; de planning van openingen ongeveer elk kwartier. Het tijdstip van de laatste update staat bovenaan de pagina. Een opening kan korter of langer duren dan gepland; volg ter plaatse altijd de slagbomen en de verkeerslichten.`,
    },
  ];
}
