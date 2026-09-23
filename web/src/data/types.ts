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
 *   roads/<slug>.json         EntityFile — every item on one road, geometry + full detail
 *   gemeenten/<slug>.json     EntityFile — every item in one municipality, geometry + full detail
 *   manifest.json             Record<path, sha1> of every file above (used by the uploader)
 *
 * Contract v3 (2026-09-13): `imp`/`veh`/`per`/`spd`/`lc` on every item (impact verdict),
 * `detourGeom` in the detail, the per-road and per-gemeente EntityFiles.
 *
 * Contract v4 (2026-09-23): the verdict gets a time axis. `ItemDetail.tl` says what a measure does
 * WHEN — per stretch of time the impact and the vehicles it applies to — and `ItemDetail.tlTo`
 * says up to when that is known. `Meta.horizon` says how far ahead the whole dataset reaches.
 * v3 flattened every DATEX situation to one window and one verdict: a street works in eight
 * phases, of which only the last closed nothing but the cycle path, read "dicht voor iedereen"
 * for 80 days; a sports event whose closures all fell on the Sunday read "dicht" from Thursday.
 * Everything v3 had is still there, so a v3 reader keeps working. Meta.version = "4".
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

/**
 * What the measure means for someone who wants to drive there, computed by the pipeline
 * (`pipeline/src/impact.js`) from the DATEX records of the whole situation:
 *
 *   dicht    – the road is closed: `roadClosed`, or `carriagewayClosures` on a local street /
 *              stadsroute (single carriageway), or a bridge opening.
 *   rijbaan  – one carriageway/direction is closed on an A- or N-road; the other direction may
 *              be open (`carriagewayClosures` with roadType A or N).
 *   hinder   – passable with hindrance: lane(s) closed, narrowed or deviated, a temporary speed
 *              limit, a queue/incident, or an expected delay of ten minutes or more.
 *   geen     – no or negligible effect on traffic (events without measures, `negligible` delay).
 *   onbekend – not enough information in the records.
 *
 * Combine with `veh`: when `veh` is present the measure only applies to those vehicle groups
 * (a `dicht` with `veh: ['bicycle','moped']` is a closed cycle path, not a closed road).
 */
export type Impact = 'dicht' | 'rijbaan' | 'hinder' | 'geen' | 'onbekend';

/** Vehicle groups a measure applies to (DATEX `forVehiclesWithCharacteristicsOf`). Absent = everyone. */
export type Vehicle = 'car' | 'lorry' | 'bicycle' | 'moped' | 'bus' | 'agricultural' | 'other';

/**
 * One stretch of a time-varying measure (contract v4): from `start` up to `end` (ISO 8601 UTC,
 * minute precision) the measure applies with impact `imp`, for the vehicle groups `veh` — absent
 * means all traffic. See `ItemDetail.tl`.
 */
export type TimelineSegment = [start: string, end: string, imp: Impact, veh?: Vehicle[]];

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
  /** Impact verdict, see `Impact`. */
  imp: Impact;
  /** Vehicle groups the measure applies to; absent = all traffic. */
  veh?: Vehicle[];
  /**
   * True when the measure varies over time: it only applies during certain blocks (e.g. nightly)
   * or its impact changes from phase to phase. Details in `ItemDetail.tl` (v4) and, derived from
   * it, `ItemDetail.periods`. `imp` and `veh` on the item are the heaviest verdict over the whole
   * timeline, for the map colour when no detail is loaded.
   */
  per?: true;
  /** Temporary speed limit in km/h, when set. */
  spd?: number;
  /** Number of lanes closed, when known (> 0). */
  lc?: number;
}

/** Full details, loaded on demand from detail/<shard>.json. */
export interface ItemDetail {
  id: string;
  /** Public comments (commentType warning/other), never internalNote. */
  desc?: string;
  /** Detour description (reroutingItineraryDescription). */
  detour?: string;
  /**
   * The blocks in which the measure applies, ISO pairs, sorted, non-overlapping. Since v4 this is
   * derived from `tl` (its segments merged regardless of impact) and kept for display and for v3
   * readers; `tl` is authoritative.
   */
  periods?: [string, string][];
  /**
   * Contract v4 — the timeline: what the measure does when. Sorted, non-overlapping segments
   * `[start, end, imp, veh?]`; between two segments the measure does not apply. `veh` absent means
   * all traffic. Present only when the measure varies over time (`ItemProperties.per`); a measure
   * without `tl` applies with the item's own `imp`/`veh` for its whole [start, end].
   *
   * Built from the validity of every DATEX situation record separately, so a phase that only
   * closes the cycle path, or a closure that only happens on the Sunday, gets its own verdict.
   * Clipped to local midnight of the day of the run and to `tlTo`, so the file changes once a day
   * rather than with every run.
   */
  tl?: TimelineSegment[];
  /**
   * Contract v4 — the timeline is complete up to this moment (ISO). For a moment after `tlTo` and
   * before the item's `end`, the honest answer is "not known yet", never "no hindrance": the list
   * of blocks may simply have been cut off there. Absent when the timeline covers the whole item.
   */
  tlTo?: string;
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
  /**
   * Signed detour route (`sit:alternativeRoute` of the rerouting record) as a simplified
   * `[lon, lat]` polyline of at most 12 points, WGS84, 5 decimals. Used to draw the detour on
   * the map and to open it as a Google Maps route with waypoints. Absent when the wegbeheerder
   * published no detour geometry.
   */
  detourGeom?: [number, number][];
  /** Last change of the situation, ISO 8601 UTC. */
  upd: string;
}

export type DetailShard = Record<string, ItemDetail>;

export type ItemGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.MultiLineString;
export type ItemFeature = GeoJSON.Feature<ItemGeometry, ItemProperties>;
export type ItemCollection = GeoJSON.FeatureCollection<ItemGeometry, ItemProperties>;

/**
 * Compact index row (positional, to keep index/all.json small):
 * [id, cat, sub, sev, title, road, roadType, gemeente, woonplaats, prov, start, end, lon, lat, closed, hind, active,
 *  imp, veh, per, spd, lc]
 * `lon`/`lat` = representative point (midpoint of the geometry), 5 decimals.
 * `active` = 1 when in werk-actueel or live, 0 when in werk-gepland.
 * Positions 17–21 were added in contract v3; readers must treat a 17-element row as `imp: 'onbekend'`.
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
  imp: Impact,
  veh: Vehicle[] | null,
  per: 0 | 1,
  spd: number | null,
  lc: number | null,
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

/** One item with everything a page needs: compact feature (with geometry) plus its full detail. */
export interface EntityItem {
  f: ItemFeature;
  d: ItemDetail;
}

/**
 * All items of one entity (a road such as "A2", or a gemeente), active or planned within 30 days,
 * so an entity page can answer "kan ik op <datum> over de A2?" exactly: it has the geometry for
 * its map, the impact verdict and vehicle groups, and the recurring `periods` for nightly works,
 * without loading the national collections or 32 detail shards.
 * `roads/<slug>.json` for every road in pipeline/static/wegen.json that has items;
 * `gemeenten/<slug>.json` for every gemeente in pipeline/static/plaatsen.json that has items.
 * Items are sorted: active first, then by start. Absent file = no items for that entity.
 */
export interface EntityFile {
  generated: string;
  kind: 'road' | 'gemeente';
  /** Display key, e.g. "A2" or "Utrecht". */
  key: string;
  slug: string;
  items: EntityItem[];
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
  /**
   * How far ahead the dataset reaches: measures that start later than `until` are not in the
   * files at all. Without this the site answered a question about a date six weeks out with
   * "Geen hinder gemeld" — the same sentence it uses for a genuinely quiet road — while it simply
   * had no data. Absent in older files, in which case the horizon is unknown and the answer
   * must not claim more than it knows.
   */
  horizon?: { days: number; until: string };
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
  road: (slug: string) => `roads/${slug}.json`,
  gemeente: (slug: string) => `gemeenten/${slug}.json`,
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
