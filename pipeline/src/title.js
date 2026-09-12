/**
 * Display title (docs/onderzoek.md §2.3). A title must answer *where* something
 * happens, so raw Melvin text is cleaned up before it is used:
 *
 *   1. first warning comment (address noise removed: postcodes, house numbers)
 *   2. VILD road name / "from → to"
 *   3. geocoded "straat, woonplaats"
 *   4. causeDescription (same address clean-up)
 *   5. type label, with the place when we know it
 *
 * Texts from 1 and 4 are Melvin free text: they rarely name a location, so when
 * a place is known and the item has no road number (a municipal item) the place
 * is appended — "Opslag bouwmateriaal, Grou". Numbered roads keep the
 * "<road> · <text>" prefix instead; a road number already localises the item.
 * Nothing is ever invented: without a known place the text is left as it is.
 * Max 120 characters, cut on a word boundary.
 */

import { clean } from './merge.js';

export const TITLE_MAX = 120;

/** Dutch postcode, e.g. "9001 ZE" / "3481LA". Uppercase letters only, so years
 *  followed by a lowercase word ("2026 om") are never mistaken for one. */
const POSTCODE_RE = /(?<![A-Za-z0-9])\d{4}\s?[A-Z]{2}(?![A-Za-z0-9])/g;

/** Word endings that make a token read as a Dutch street name. */
const STREET_SUFFIX_RE =
  /(straat|straatweg|weg|laan|dijk|dyk|kade|kaai|plein|plantsoen|pad|wei|singel|gracht|steeg|hof|dreef|boulevard|tunnel|brug|sluis|allee|lei|erf|akker|dam|haven|markt|vliet|diep|wal|kamp|rade|hoven|dwinger)$/i;

/** A trailing house number: "Visserwei 1", "Strengen 114", "Kerkstraat 12a", "Dorpsweg 3-5". */
const HOUSE_TAIL_RE = /^(.*?[A-Za-z][A-Za-z.']{2,})\s+\d{1,5}[a-zA-Z]?(?:\s*[-–/]\s*\d{1,5}[a-zA-Z]?)?$/;

/** A leading house number: "1 Dorpsstraat". */
const HOUSE_HEAD_RE = /^\d{1,5}[a-zA-Z]?[,\s]+(?=[A-Za-z])/;

/** Unicode spaces that must become a normal space before the middot separator. */
const ODD_SPACE_RE = /[   -​  　﻿]/g;

/** Leading noise that would otherwise render as "A4 ·-tekst" or "A4 · , tekst". */
const LEADING_NOISE_RE = /^[\s·•|/\\,;:.\-–—_]+/;

/**
 * Melvin's "gevolg voor het verkeer" drop-down. These six phrases are the
 * warning comment of 11,313 of the ~16,000 planning situations in one feed, so
 * they say *what* happens but never *where* — the geocoded street is a far
 * better title. They are only demoted below the street, never dropped: without
 * a street they are still the best text we have.
 */
const GENERIC_COMMENTS = new Set([
  'weg dicht in beide richtingen',
  'weg dicht in een richting',
  'snelheidsbeperking',
  'geen gevolgen voor verkeer',
  'beperking voor langzaam verkeer',
  'verminderd aantal rijstroken beschikbaar',
]);

/** True for a boilerplate Melvin warning comment. */
/** @param {string} text */
export function isGenericComment(text) {
  return GENERIC_COMMENTS.has(text.replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim().toLowerCase());
}

/** Dutch labels for record/sub types used when nothing better is available. */
export const TYPE_LABELS = Object.freeze({
  werk: 'Wegwerkzaamheden',
  afsluiting: 'Afsluiting',
  file: 'File',
  incident: 'Incident',
  brug: 'Brugopening',
  evenement: 'Evenement',
  overig: 'Verkeersmaatregel',
  // sub types
  roadClosed: 'Weg afgesloten',
  carriagewayClosures: 'Rijbaan afgesloten',
  laneClosures: 'Rijstrook afgesloten',
  lanesDeviated: 'Rijstroken verlegd',
  narrowLanes: 'Versmalde rijstroken',
  hardShoulderRunningInOperation: 'Spitsstrook open',
  spitsstrook: 'Spitsstrook open',
  speedRestrictionInOperation: 'Snelheidsbeperking',
  slowTraffic: 'Langzaam rijdend verkeer',
  stationaryTraffic: 'Stilstaand verkeer',
  accident: 'Ongeval',
  brokenDownVehicle: 'Pechgeval',
  objectOnTheRoad: 'Voorwerp op de weg',
  vehicleObstruction: 'Voertuig op de weg',
  generalObstruction: 'Obstakel op de weg',
  bridgeSwingInOperation: 'Brug open',
  resurfacingWork: 'Asfalteringswerkzaamheden',
  maintenanceWork: 'Onderhoudswerkzaamheden',
  overheadWorks: 'Werkzaamheden boven de weg',
  treeAndVegetationCuttingWork: 'Snoeiwerkzaamheden',
  installationWork: 'Installatiewerkzaamheden',
  roadworks: 'Wegwerkzaamheden',
  roadsideWork: 'Werkzaamheden langs de weg',
  sweepingOfRoad: 'Veegwerkzaamheden',
  repairWork: 'Reparatiewerkzaamheden',
  roadMarkingWork: 'Wegmarkering',
  constructionWork: 'Bouwwerkzaamheden',
  festival: 'Festival',
  market: 'Markt',
  sportsMeeting: 'Sportevenement',
  funfair: 'Kermis',
  fair: 'Beurs',
  concert: 'Concert',
  bicycleRace: 'Wielerwedstrijd',
  marathon: 'Marathon',
  footballMatch: 'Voetbalwedstrijd',
  waterSportsMeeting: 'Watersportevenement',
  trafficBeingManuallyDirected: 'Verkeersregelaars',
  temporaryTrafficLights: 'Tijdelijke verkeerslichten',
});

/**
 * @param {object} input
 * @param {string=} input.comment       first warning comment
 * @param {string=} input.causeDesc
 * @param {string=} input.road          "A7"
 * @param {string=} input.roadName      VILD road name, "Afsluitdijk"
 * @param {string=} input.from          VILD name of the primary location
 * @param {string=} input.to
 * @param {string=} input.street        geocoded straatnaam
 * @param {string=} input.place         geocoded woonplaats (or gemeente)
 * @param {string} input.cat
 * @param {string=} input.sub
 * @returns {string}
 */
export function buildTitle(input) {
  const label = TYPE_LABELS[input.sub ?? ''] ?? TYPE_LABELS[input.cat] ?? 'Verkeersmaatregel';
  const place = clean(input.place);

  const comment = sanitizeAddress(clean(input.comment));
  // Boilerplate ("Weg dicht in beide richtingen") drops below the VILD name and
  // the geocoded street: those say where, the boilerplate only says what.
  const generic = comment !== undefined && isGenericComment(comment);

  // `localised` = the text already names a location, so no place is appended.
  const candidates = [
    { text: generic ? undefined : comment, localised: false },
    { text: vildText(input), localised: true },
    { text: streetText(input), localised: true },
    { text: generic ? comment : undefined, localised: false },
    { text: sanitizeAddress(clean(input.causeDesc)), localised: false },
    { text: place ? `${label} in ${place}` : label, localised: true },
  ];
  const chosen = candidates.find((c) => c.text !== undefined && c.text.length > 0);
  const base = sentenceCase(oneLine(/** @type {{text: string}} */ (chosen).text));
  const localised = /** @type {{localised: boolean}} */ (chosen).localised;

  const wantsPlace = !localised && place !== undefined && !input.road && !mentionsPlace(base, place);
  const withPlace = wantsPlace ? `${base}, ${place}` : base;
  const full = prefixRoad(withPlace, input.road);
  // The place is a bonus: drop it rather than truncate it away.
  if (wantsPlace && full.length > TITLE_MAX) return truncate(prefixRoad(base, input.road), TITLE_MAX);
  return truncate(full, TITLE_MAX);
}

/** @param {{ roadName?: string, from?: string, to?: string }} input */
function vildText(input) {
  if (input.roadName) return input.roadName;
  if (input.from && input.to) return `${input.from} → ${input.to}`;
  return input.from;
}

/** "Asterdkraag, Breda" — only when a street is known; a bare place is no title. */
/** @param {{ street?: string, place?: string }} input */
function streetText(input) {
  if (!input.street) return undefined;
  return input.place ? `${input.street}, ${input.place}` : input.street;
}

/**
 * Remove address noise from Melvin free text: postcodes and the house numbers
 * around a street name. Purely subtractive — nothing is added or reworded.
 * @param {string | undefined} text
 * @returns {string | undefined}
 */
export function sanitizeAddress(text) {
  if (!text) return text;
  const hadPostcode = POSTCODE_RE.test(text);
  POSTCODE_RE.lastIndex = 0;
  const withoutPostcode = tidySeparators(text.replace(POSTCODE_RE, ''));
  const stripped = stripHouseNumbers(withoutPostcode, hadPostcode);
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * Strip the house number from the first comma segment. Only done when the text
 * really looks like an address — it carried a postcode, or the word in front of
 * the number ends like a Dutch street name — so "Snelheidsbeperking 50" and
 * "Fase 2" keep their number.
 * @param {string} text
 * @param {boolean} hadPostcode
 */
export function stripHouseNumbers(text, hadPostcode = false) {
  const comma = text.indexOf(',');
  const head = comma >= 0 ? text.slice(0, comma) : text;
  const rest = comma >= 0 ? text.slice(comma) : '';
  const tail = head.match(HOUSE_TAIL_RE);
  if (tail) {
    const streetish = STREET_SUFFIX_RE.test(lastWord(tail[1]));
    if (hadPostcode || streetish) return tidySeparators(tail[1] + rest);
  }
  if (hadPostcode || STREET_SUFFIX_RE.test(lastWord(firstWordAfterNumber(head)))) {
    const head2 = head.replace(HOUSE_HEAD_RE, '');
    if (head2 !== head && head2.length > 0) return tidySeparators(head2 + rest);
  }
  return text;
}

/** @param {string} text */
function firstWordAfterNumber(text) {
  const m = text.match(/^\d{1,5}[a-zA-Z]?[,\s]+([A-Za-z][A-Za-z.'-]*)/);
  return m ? m[1] : '';
}

/** @param {string} text */
function lastWord(text) {
  const words = text.trim().split(/[\s.'-]+/).filter(Boolean);
  return words.length > 0 ? words[words.length - 1] : '';
}

/** Collapse the double commas and stray separators that removals leave behind. */
/** @param {string} text */
export function tidySeparators(text) {
  return text
    .replace(ODD_SPACE_RE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/,(?=\S)/g, ', ')
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .trim();
}

/** True when the text already names this place. */
/** @param {string} text @param {string} place */
export function mentionsPlace(text, place) {
  const fold = (/** @type {string} */ s) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const needle = fold(place);
  if (needle.length < 2) return true;
  const haystack = fold(text);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : haystack[at - 1];
    const after = haystack[at + needle.length] ?? '';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/** Newlines and odd spaces become one clean line without leading noise. */
/** @param {string} text */
export function oneLine(text) {
  return text
    .replace(ODD_SPACE_RE, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(LEADING_NOISE_RE, '')
    .trim();
}

/**
 * Melvin writes "gestuurde boring"; a title starts with a capital. Road codes
 * that are lowercase by convention ("s100") are left alone.
 * @param {string} text
 */
export function sentenceCase(text) {
  if (!/^[a-z]/.test(text)) return text;
  if (/^[sa-z]\d/.test(text)) return text;
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * "A7 · text" unless the text already starts with the road number ("A7 …",
 * "a7:", "A7-Afsluitdijk"). The separator is always exactly " · ".
 * @param {string} text
 * @param {string | undefined} road
 */
export function prefixRoad(text, road) {
  const body = oneLine(text);
  if (!road) return body;
  const re = new RegExp(`^${escapeRegExp(road)}(?![0-9])`, 'i');
  if (re.test(body)) return body;
  return `${road} · ${body}`;
}

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cut at a word boundary and add an ellipsis when longer than `max`.
 * @param {string} text
 * @param {number} max
 */
export function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:·-]+$/, '') + '…';
}
