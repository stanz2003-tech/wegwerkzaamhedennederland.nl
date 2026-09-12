/**
 * Data contract between the pipeline (pipeline/src/output.js) and the frontend.
 * Keep in sync with docs/build-contracts.md ("Data files"). Nulls are omitted in JSON.
 *
 * Files under the data base URL (default `/data/`, production `https://data.<domain>/v1/`):
 *   meta.json                 Meta
 *   werk-actueel.geojson      ItemCollection — works/closures/events/other that are active NOW
 *   werk-gepland.geojson      ItemCollection — not active yet, start within 30 days
 *   live.geojson              ItemCollection — files, incidents, bridge openings happening now
 *   index/all.json            IndexFile — one compact row per item in the three files above
 *   index/prov/<PVxx>.json    IndexFile — same rows, per province (PV20..PV31, `_` = unknown)
 *   detail/<00..31>.json      DetailShard — full details per item, shard = sha1(id) % 32
 *   bruggen.json              BridgeFile — bridge registry with upcoming openings
 *   manifest.json             Record<path, sha1> of every file above (used by the uploader)
 */

export type Category =
  | 'werk'
  | 'afsluiting'
  | 'file'
  | 'incident'
  | 'brug'
  | 'evenement'
  | 'overig';

export const CATEGORIES: readonly Category[] = [
  'werk',
  'afsluiting',
  'file',
  'incident',
  'brug',
  'evenement',
  'overig',
] as const;

/** 0 = none/lowest … 4 = highest (from DATEX II overallSeverity). */
export type Severity = 0 | 1 | 2 | 3 | 4;

/** A = rijksweg (red badge), N = provinciale weg (yellow), S = stadsroute, E = Europese weg, lokaal = street. */
export type RoadType = 'A' | 'N' | 'S' | 'E' | 'lokaal';

export type Direction = 'positive' | 'negative' | 'both';

export type Probability = 'certain' | 'probable' | 'riskOf';

export type DelayBand =
  | 'negligible'
  | 'upToTenMinutes'
  | 'betweenTenMinutesAndThirtyMinutes'
  | 'betweenThirtyMinutesAndOneHour'
  | 'betweenOneHourAndThreeHours'
  | 'longerThanThreeHours';

/** Melvin hindrance category: A = most hindrance … E = least. */
export type Hindrance = 'A' | 'B' | 'C' | 'D' | 'E';

/** Compact properties shipped inside the GeoJSON files (keep small: ~15 keys). */
export interface ItemProperties {
  /** DATEX II situation id, stable across runs (prefix tells the publisher: NDW03_, RWS01_, NLRWS_, BMS01_ …). */
  id: string;
  cat: Category;
  /** DATEX II sub type: laneClosures, roadClosed, carriagewayClosures, speedRestrictionInOperation,
   *  slowTraffic, stationaryTraffic, accident, brokenDownVehicle, bridgeSwingInOperation, festival … */
  sub?: string;
  sev: Severity;
  /** Display title, e.g. "A7 · Afsluitdijk" or "Asterdkraag, Breda". Max 120 chars. */
  title: string;
  /** Road number as printed on signs: "A2", "N57", "s100". */
  road?: string;
  roadType?: RoadType;
  /** Municipality (gemeente) the item lies in. */
  gemeente?: string;
  /** Place (woonplaats) the item lies in. */
  woonplaats?: string;
  /** Province name, e.g. "Noord-Holland". */
  prov?: string;
  /** ISO 8601 UTC, minute precision. */
  start: string;
  /** ISO 8601 UTC; absent = open ended. */
  end?: string;
  /** True when a whole road or carriageway is closed (also set on `afsluiting` items). */
  closed?: boolean;
  hind?: Hindrance;
  prob?: Probability;
  /** Short publisher name, e.g. "Rijkswaterstaat", "Gemeente Breda", "Provincie Utrecht". */
  src: string;
}

/** Full details, loaded on demand from detail/<shard>.json. */
export interface ItemDetail {
  id: string;
  /** Public comments (commentType warning/other), never internalNote. */
  desc?: string;
  /** Detour description (reroutingItineraryDescription). */
  detour?: string;
  /** Recurring sub-periods within [start, end], ISO pairs, max 60, sorted. */
  periods?: [string, string][];
  lanes?: { closed?: number; open?: number; total?: number };
  /** Temporary speed limit in km/h. */
  speed?: number;
  delay?: DelayBand;
  /** Expected delay in seconds (files, some works). */
  delaySec?: number;
  /** Queue length in metres (files). */
  queueM?: number;
  from?: string;
  to?: string;
  dir?: Direction;
  /** Full publisher / road authority name as published. */
  src: string;
  /** Melvin planning status: published, running, final, alignmentFinished, initial … */
  status?: string;
  /** Link to more information at the road authority (melvin.ndw.nu, ltc.andes.nl …). */
  url?: string;
  /** Vehicle types the measure applies to (bicycle, lorry …). */
  vehicles?: string[];
  /** Type of works / cause label, e.g. "resurfacingWork", "bridge". */
  works?: string;
  /**
   * Ids of the situations the pipeline folded into this one. Rijkswaterstaat publishes a running
   * roadwork twice: the planning object in the Melvin planning feed (`RWS01_SM1013188_D2`) and
   * the actual measure in actueel_beeld (`RWS01_SM1013188_D2_WWA`). The actual measure survives,
   * the planning id lands here, and every field only the planning item knew is copied over.
   * Absent when nothing was merged. See `pipeline/src/dedup.js` and `pipeline/README.md`.
   */
  related?: string[];
  /** Last change of the situation, ISO 8601 UTC. */
  upd: string;
}

export type DetailShard = Record<string, ItemDetail>;

export type ItemGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.MultiLineString;
export type ItemFeature = GeoJSON.Feature<ItemGeometry, ItemProperties>;
export type ItemCollection = GeoJSON.FeatureCollection<ItemGeometry, ItemProperties>;

/**
 * Compact index row (positional, to keep index/all.json small):
 * [id, cat, sub, sev, title, road, roadType, gemeente, woonplaats, prov, start, end, lon, lat, closed, hind, active]
 * `lon`/`lat` = representative point (midpoint of the geometry), 5 decimals.
 * `active` = 1 when in werk-actueel or live, 0 when in werk-gepland.
 */
export type IndexRow = [
  id: string,
  cat: Category,
  sub: string | null,
  sev: Severity,
  title: string,
  road: string | null,
  roadType: RoadType | null,
  gemeente: string | null,
  woonplaats: string | null,
  prov: string | null,
  start: string,
  end: string | null,
  lon: number,
  lat: number,
  closed: 0 | 1,
  hind: Hindrance | null,
  active: 0 | 1,
];

export interface IndexFile {
  generated: string;
  rows: IndexRow[];
}

export interface BridgeEntry {
  /** RIS-index code, e.g. "NLSPL002120533400126" (also the DATEX externalLocationCode). */
  id: string;
  /** URL slug used for /brug/<slug>/ (from the static registry). */
  slug: string;
  /** Bridge name when known (VILD / registry), else a descriptive fallback like "Brug in de N231 bij Aalsmeer". */
  name: string;
  road?: string;
  water?: string;
  gemeente?: string;
  woonplaats?: string;
  prov?: string;
  lon: number;
  lat: number;
  /** True when a bridgeSwingInOperation record for this bridge is active now. */
  openNow: boolean;
  /** Planned openings in the next 7 days as [start, end] ISO pairs, sorted, max 50. */
  openings: [string, string][];
}

export interface BridgeFile {
  generated: string;
  bridges: BridgeEntry[];
}

export interface SourceMeta {
  url: string;
  ok: boolean;
  /** DATEX publicationTime of the file that was processed. */
  publicationTime?: string;
  lastModified?: string;
  etag?: string;
  /** True when the feed was unchanged (ETag) and the previous result was reused. */
  reused?: boolean;
  situations: number;
  error?: string;
}

export interface Meta {
  /** ISO 8601 UTC time the data files were generated. */
  generated: string;
  /** Data format version, e.g. "1". Bump on breaking changes. */
  version: string;
  sources: Record<string, SourceMeta>;
  /** Active items per category (werk-actueel + live). */
  counts: Record<Category, number>;
  /** Items in werk-gepland per category. */
  upcoming: Record<Category, number>;
  /** Features dropped because they had no usable geometry / coordinates outside NL. */
  dropped: number;
  /**
   * Double publications folded into one item this run: a planning situation plus the actual
   * measure that describes the same work (see `ItemDetail.related`). Absent in older files.
   */
  merged?: number;
  /** Situation record types the classifier did not recognise (went to `overig`). */
  unknownTypes: Record<string, number>;
  /** Wall time of the run in ms and peak RSS in MB (for monitoring). */
  runMs?: number;
  peakRssMb?: number;
}

/** Province codes as used by PDOK/CBS (PV20 Groningen … PV31 Limburg). */
export const PROVINCES: Record<string, string> = {
  PV20: 'Groningen',
  PV21: 'Friesland',
  PV22: 'Drenthe',
  PV23: 'Overijssel',
  PV24: 'Flevoland',
  PV25: 'Gelderland',
  PV26: 'Utrecht',
  PV27: 'Noord-Holland',
  PV28: 'Zuid-Holland',
  PV29: 'Zeeland',
  PV30: 'Noord-Brabant',
  PV31: 'Limburg',
};

export const DETAIL_SHARDS = 32;

/** File layout under the data base URL (default /data/). */
export const DATA_FILES = {
  meta: 'meta.json',
  werkActueel: 'werk-actueel.geojson',
  werkGepland: 'werk-gepland.geojson',
  live: 'live.geojson',
  indexAll: 'index/all.json',
  indexProv: (provCode: string) => `index/prov/${provCode}.json`,
  detail: (shard: number) => `detail/${String(shard).padStart(2, '0')}.json`,
  bruggen: 'bruggen.json',
  manifest: 'manifest.json',
} as const;

/**
 * Shard number for an item id: first 8 hex chars of SHA-1(id) mod DETAIL_SHARDS.
 * The pipeline uses node:crypto; the browser uses crypto.subtle (async) — see web/src/data/detail.ts.
 */
export function shardFromHashPrefix(hexPrefix: string): number {
  return Number.parseInt(hexPrefix.slice(0, 8), 16) % DETAIL_SHARDS;
}

/**
 * URL slug shared by the page generator and the client (must be identical everywhere):
 * lowercase, diacritics stripped, anything not [a-z0-9] becomes "-", collapsed, trimmed.
 * "'s-Hertogenbosch" → "s-hertogenbosch", "Bergen (NH)" → "bergen-nh", "A12 hrb" → "a12-hrb".
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
