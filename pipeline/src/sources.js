/**
 * NDW open-data feeds consumed by the pipeline (docs/onderzoek.md §2.1).
 *
 * - `planning`: Melvin planning feed — every road authority's roadworks and
 *   events, planned and running. Large (17 MB gz), refreshed every 15 min,
 *   fetched with a conditional GET and re-used from cache when unchanged.
 * - `actueel`: current picture — files (AbnormalTraffic), incidents, current
 *   RWS measures and bridges open right now. Small, refreshed every minute.
 * - `bruggen`: planned bridge openings (BMS01), used for bruggen.json only.
 *
 * `veiligheidsgerelateerde_berichten_srti` and
 * `tijdelijke_verkeersmaatregelen_afsluitingen` are NOT fetched separately:
 * NDW documents (and our counts confirm) that `actueel_beeld` contains them.
 * Adding a source = adding an entry here and, when its records need new
 * handling, extending classify.js (see README "Adding a source").
 */

export const NDW_BASE = 'https://opendata.ndw.nu/';

/**
 * @typedef {object} SourceDef
 * @property {string} name        Short key used in CLI flags, meta.json and cache files.
 * @property {string} url         Download URL (gzip).
 * @property {'planning'|'live'|'bridges'} role  How the pipeline uses the situations.
 * @property {boolean} conditional  Use If-None-Match and reuse the cached parse when unchanged.
 * @property {number} floor       Validation floor: fewer parsed situations → exit code 2.
 * @property {string} description
 */

/** @type {Record<string, SourceDef>} */
export const SOURCES = Object.freeze({
  planning: {
    name: 'planning',
    url: `${NDW_BASE}planningsfeed_wegwerkzaamheden_en_evenementen.xml.gz`,
    role: 'planning',
    conditional: true,
    floor: 1000,
    description: 'Melvin planning: roadworks and events of all road authorities',
  },
  actueel: {
    name: 'actueel',
    url: `${NDW_BASE}actueel_beeld.xml.gz`,
    role: 'live',
    conditional: false,
    floor: 50,
    description: 'Current picture: files, incidents, current measures, bridges open now',
  },
  bruggen: {
    name: 'bruggen',
    url: `${NDW_BASE}planningsfeed_brugopeningen.xml.gz`,
    role: 'bridges',
    conditional: false,
    floor: 0,
    description: 'Planned bridge openings (BMS01)',
  },
});

export const SOURCE_NAMES = Object.freeze(Object.keys(SOURCES));

export const VILD_ZIP_URL = `${NDW_BASE}VILD6.13.A.zip`;

/**
 * @param {string} name
 * @returns {SourceDef}
 */
export function getSource(name) {
  const def = SOURCES[name];
  if (!def) {
    throw new Error(`Unknown source "${name}". Known sources: ${SOURCE_NAMES.join(', ')}`);
  }
  return def;
}

/**
 * Parse the `--sources a,b` CLI value.
 * @param {string | undefined} value
 * @returns {SourceDef[]}
 */
export function selectSources(value) {
  if (!value) return SOURCE_NAMES.map((n) => SOURCES[n]);
  const names = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('--sources needs at least one source name');
  return names.map(getSource);
}
