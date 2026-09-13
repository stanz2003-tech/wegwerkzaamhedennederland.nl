/**
 * Road number detection. Order (docs/onderzoek.md §2.3, revised 2026-09-13):
 *   1. `sit:roadOrJunctionNumber` (rerouting records; "N33", "N7 Weg der Verenigde Naties")
 *   2. VILD ROADNUMBER of the AlertC location
 *   3. publishers that manage numbered roads (Rijkswaterstaat, provinces): regex
 *      `\b([AN]\d{1,3})\b` on title / description / cause / source, then the geocoded street
 *   0. (applied last) a publisher that is not Rijkswaterstaat or a province never gets an
 *      A-road: the rijkswegen are RWS's; anything else that lands on one is a crossing or
 *      parallel local road (a TMC point or PDOK snap on the motorway).
 *   4. everyone else (gemeenten, waterschappen, unknown): the reverse-geocoded street name
 *      when it looks like an A/N/s number; the text only when the item was not geocoded at
 *      all. A gemeente cannot publish a motorway measure, so "A4" in its text is a landmark
 *      or a detour — before this rule 51 of the 1,021 A-road `rijbaan` items were local
 *      streets that merely mentioned a motorway (e.g. NDW03_232949, Gemeente 's-Gravenhage).
 * roadType: A = rijksweg, N = provinciale weg, S = stadsroute (Amsterdam s100…),
 * E = Europese weg, lokaal = everything else.
 */

/** @typedef {'A'|'N'|'S'|'E'|'lokaal'} RoadType */

const TEXT_ROAD_RE = /(?<![A-Za-z0-9])([AN]\d{1,3})(?![0-9])(?![A-Za-z](?![A-Za-z]))/;
const LEADING_ROAD_RE = /^([ANE]\d{1,3}|[sS]\d{3})(?=$|[\s:;,\-/(])/;
const EXACT_ROAD_RE = /^(?:[ane]\d{1,3}|s\d{3}[a-z]?)$/i;
const STREET_ROAD_RE = /(?<![A-Za-z0-9])([AN]\d{1,3}|[sS]\d{3})(?![A-Za-z0-9])/;

/**
 * Normalise a road code: "a2" → "A2", "S100" → "s100", "N 57" → "N57".
 * Returns undefined when the string is not a plain A/N/E/s number.
 * @param {string | undefined} value
 */
export function normalizeRoad(value) {
  if (!value) return undefined;
  const compactValue = value.trim().replace(/^([ANEansSe])\s+(\d)/, '$1$2');
  if (!EXACT_ROAD_RE.test(compactValue)) return undefined;
  const letter = compactValue[0];
  const rest = compactValue.slice(1).replace(/^0+(?=\d)/, '');
  return letter.toLowerCase() === 's' ? `s${rest}` : `${letter.toUpperCase()}${rest}`;
}

/**
 * VILD ROADNUMBER → road number: carriageway variants ("A12 hrb", "A15 prb")
 * and branch letters ("N282A", "N342+") collapse onto their base road.
 * @param {string | undefined} value
 */
export function normalizeVildRoad(value) {
  if (!value) return undefined;
  const base = value
    .trim()
    .replace(/\s+(hrb|prb|hrl|hrr)$/i, '')
    .replace(/^([ANE]\d{1,3})[A-Za-z+]$/, '$1');
  return normalizeRoad(base);
}

/**
 * @param {string | undefined} road
 * @returns {RoadType}
 */
export function roadTypeOf(road) {
  if (!road) return 'lokaal';
  switch (road[0]) {
    case 'A':
      return 'A';
    case 'N':
      return 'N';
    case 's':
      return 'S';
    case 'E':
      return 'E';
    default:
      return 'lokaal';
  }
}

/**
 * Road number at the start of a `roadOrJunctionNumber` value.
 * @param {string | undefined} value
 */
export function roadFromRoadNumberField(value) {
  if (!value) return undefined;
  const m = value.trim().match(LEADING_ROAD_RE);
  return m ? normalizeRoad(m[1]) : undefined;
}

/**
 * First A/N number in free text ("Afsluiting A12 richting Utrecht" → "A12").
 * @param {(string | undefined)[]} texts
 */
export function roadFromTexts(texts) {
  for (const text of texts) {
    if (!text) continue;
    const m = text.match(TEXT_ROAD_RE);
    if (m) return normalizeRoad(m[1]);
  }
  return undefined;
}

/**
 * Road number in a geocoded street name ("Rijksweg A2", "N57", "s100").
 * @param {string | undefined} street
 */
export function roadFromStreet(street) {
  if (!street) return undefined;
  const m = street.match(STREET_ROAD_RE);
  return m ? normalizeRoad(m[1]) : undefined;
}

/**
 * Publishers whose free text may name the road a measure is on: Rijkswaterstaat (including
 * the RWS/NDW system names) and the provinces — the road authorities of the A- and N-roads.
 * @param {string | undefined} src   display name from `friendlySource()`
 */
export function publisherMayNameRoad(src) {
  return /^(Rijkswaterstaat|Provincie\s)/.test(src ?? '');
}

/**
 * @param {object} input
 * @param {string=} input.roadNr      sit:roadOrJunctionNumber
 * @param {string=} input.vildRoad    VILD ROADNUMBER
 * @param {(string | undefined)[]=} input.texts
 * @param {string=} input.street      geocoded straatnaam (undefined = not geocoded)
 * @param {string=} input.publisher   display name of the publisher (`friendlySource().src`)
 * @returns {{ road?: string, roadType: RoadType }}
 */
export function detectRoad({ roadNr, vildRoad, texts = [], street, publisher }) {
  const found = detectRoadUnchecked({ roadNr, vildRoad, texts, street, publisher });
  // Only Rijkswaterstaat manages the rijkswegen. When a gemeente or waterschap lands on an
  // A-road — a TMC point on the Merwedebrug for a cycle-path closure, or PDOK snapping the
  // Zouwendijk underpass to "A27" (both Waterschap Rivierenland, 2026-09-13) — the measure is
  // on a local road that crosses, passes under or runs next to the motorway. Users searching
  // "A27" must not see a closed motorway that is open. (28 of ~1,700 A-road items.)
  if (found.roadType === 'A' && !publisherMayNameRoad(publisher)) return typed(undefined);
  return found;
}

/** `detectRoad` without the publisher plausibility check. */
function detectRoadUnchecked({ roadNr, vildRoad, texts, street, publisher }) {
  const positional = roadFromRoadNumberField(roadNr) ?? normalizeVildRoad(vildRoad);
  if (positional) return typed(positional);
  if (publisherMayNameRoad(publisher)) return typed(roadFromTexts(texts) ?? roadFromStreet(street));
  const fromStreet = roadFromStreet(street);
  if (fromStreet) return typed(fromStreet);
  // A geocoded street that is not a road number contradicts any road mentioned in the text.
  return typed(street ? undefined : roadFromTexts(texts));
}

/** @param {string | undefined} road */
function typed(road) {
  return road ? { road, roadType: roadTypeOf(road) } : { roadType: 'lokaal' };
}
