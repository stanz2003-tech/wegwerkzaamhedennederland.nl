/**
 * Road number detection. Order (docs/onderzoek.md §2.3):
 *   1. `sit:roadOrJunctionNumber` (rerouting records; "N33", "N7 Weg der Verenigde Naties")
 *   2. VILD ROADNUMBER of the AlertC location
 *   3. regex `\b([AN]\d{1,3})\b` on title / description / cause / source
 *   4. reverse-geocoded street name that looks like an A/N/s number
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
 * @param {object} input
 * @param {string=} input.roadNr      sit:roadOrJunctionNumber
 * @param {string=} input.vildRoad    VILD ROADNUMBER
 * @param {(string | undefined)[]=} input.texts
 * @param {string=} input.street      geocoded straatnaam
 * @returns {{ road?: string, roadType: RoadType }}
 */
export function detectRoad({ roadNr, vildRoad, texts = [], street }) {
  const road =
    roadFromRoadNumberField(roadNr) ?? normalizeVildRoad(vildRoad) ?? roadFromTexts(texts) ?? roadFromStreet(street);
  return road ? { road, roadType: roadTypeOf(road) } : { roadType: 'lokaal' };
}
