/**
 * Search: local matching over index rows (road, title, gemeente, woonplaats) plus the PDOK
 * Locatieserver suggest/lookup. The local part is pure; the PDOK part uses fetch + AbortSignal.
 */
import { normalizeRoad, normalizeText } from './filter';
import type { IndexItem } from './index';
import type { Category, RoadType } from './types';

export interface LocalHit {
  kind: 'item';
  id: string;
  title: string;
  road: string | null;
  roadType: RoadType | null;
  gemeente: string | null;
  woonplaats: string | null;
  cat: Category;
  active: boolean;
  lon: number;
  lat: number;
  score: number;
  /** The whole row: the suggestion shows its verdict and when, exactly as the list row does. */
  item: IndexItem;
}

export interface PlaceHit {
  kind: 'place';
  id: string;
  /** PDOK weergavenaam: "Almkerk, Altena, Noord-Brabant", "Gemeente Altena", "Dorpsstraat, Almkerk". */
  name: string;
  /** PDOK type: weg | woonplaats | gemeente | provincie */
  type: string;
  /** The place's own name ("Almkerk", "Altena"); the weergavenaam for a street. */
  label: string;
  gemeente: string | null;
  provincie: string | null;
  /** The best fuzzy guess for a typo: shown as "Bedoelde je Gorinchem?". */
  didYouMean?: boolean;
}

export type SearchHit = LocalHit | PlaceHit;

const ROAD_RE = /^([ansANSE])\s?0*(\d{1,3})$/;

/** Normalises "a 2" / "A02" → "A2" for road matching; null when not a road number. */
export function normalizeRoadQuery(q: string): string | null {
  const m = ROAD_RE.exec(q.trim());
  if (!m) return null;
  return `${(m[1] ?? '').toUpperCase()}${Number(m[2])}`;
}

/** Scores an index item against the query; higher is better, 0 = no match. */
export function scoreItem(it: IndexItem, query: string): number {
  const q = normalizeText(query);
  if (!q) return 0;
  const nTitle = normalizeText(it.title);
  const nRoad = it.road ? normalizeRoad(it.road).toLowerCase() : '';
  const nGemeente = it.gemeente ? normalizeText(it.gemeente) : '';
  const nPlaats = it.woonplaats ? normalizeText(it.woonplaats) : '';
  const roadQ = normalizeRoadQuery(q);

  let score = 0;
  if (roadQ && nRoad === roadQ.toLowerCase()) score += 100;
  else if (nRoad && nRoad === q) score += 100;
  else if (nRoad && nRoad.startsWith(q)) score += 40;

  if (nPlaats === q || nGemeente === q) score += 60;
  else if (nPlaats.startsWith(q) || nGemeente.startsWith(q)) score += 35;
  else if (nPlaats.includes(q) || nGemeente.includes(q)) score += 15;

  if (nTitle.startsWith(q)) score += 30;
  else if (nTitle.includes(q)) score += 20;

  // Multi-word queries: every term must appear somewhere.
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length > 1) {
    const hay = `${nRoad} ${nTitle} ${nGemeente} ${nPlaats}`;
    if (!terms.every((t) => hay.includes(t))) return 0;
    score += 10;
  }
  if (score > 0 && it.active) score += 5;
  return score;
}

export function searchLocal(items: readonly IndexItem[], query: string, limit = 6): LocalHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const hits: LocalHit[] = [];
  for (const it of items) {
    const score = scoreItem(it, q);
    if (score <= 0) continue;
    hits.push({
      kind: 'item',
      id: it.id,
      title: it.title,
      road: it.road,
      roadType: it.roadType,
      gemeente: it.gemeente,
      woonplaats: it.woonplaats,
      cat: it.cat,
      active: it.active,
      lon: it.lon,
      lat: it.lat,
      score,
      item: it,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'nl'));
  return hits.slice(0, limit);
}

/* ----------------------------- PDOK Locatieserver ---------------------------- */

const LOCATIESERVER = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';

/** PDOK types per suggest call: places and streets are asked separately (see search.ts). */
export type PlaceTypes = 'places' | 'streets' | 'towns';
const TYPE_FILTER: Record<PlaceTypes, string> = {
  places: 'type:(woonplaats OR gemeente OR provincie)',
  streets: 'type:weg',
  // The typo retry: only what can be a place mode.
  towns: 'type:(woonplaats OR gemeente)',
};
const SUGGEST_FIELDS = 'id,type,weergavenaam,woonplaatsnaam,gemeentenaam,provincienaam';

interface SuggestDoc {
  id: string;
  weergavenaam: string;
  type: string;
  woonplaatsnaam?: string;
  gemeentenaam?: string;
  provincienaam?: string;
}

interface LookupDoc extends SuggestDoc {
  centroide_ll?: string;
  geometrie_ll?: string;
}

interface LocatieserverResponse<T> {
  response?: { docs?: T[] };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** A suggest doc as a PlaceHit; exported for the tests. */
export function placeHitFromDoc(d: SuggestDoc): PlaceHit | null {
  if (typeof d.id !== 'string' || typeof d.weergavenaam !== 'string') return null;
  const type = String(d.type ?? '');
  const gemeente = str(d.gemeentenaam);
  const provincie = str(d.provincienaam);
  const own = type === 'woonplaats' ? str(d.woonplaatsnaam) : type === 'gemeente' ? gemeente : type === 'provincie' ? provincie : null;
  // Without the field, strip PDOK's "Gemeente " / "Provincie " and the ", Altena, …" tail.
  const fallback = d.weergavenaam.replace(/^(Gemeente|Provincie)\s+/i, '').split(',')[0]?.trim() ?? d.weergavenaam;
  return {
    kind: 'place',
    id: d.id,
    name: d.weergavenaam,
    type,
    label: type === 'weg' ? d.weergavenaam : (own ?? fallback),
    gemeente,
    provincie,
  };
}

/**
 * PDOK suggest. `types` picks the place kinds; `fuzzy` appends `~` to every term (Solr fuzzy
 * match), which finds "Gorinchem" for "Gorichem" — only used when nothing else was found.
 */
export async function suggestPlaces(query: string, signal?: AbortSignal, rows = 6, types: PlaceTypes = 'places', fuzzy = false): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const text = fuzzy ? q.split(/\s+/).filter(Boolean).map((t) => `${t}~`).join(' ') : q;
  const url = `${LOCATIESERVER}/suggest?q=${encodeURIComponent(text)}&fq=${encodeURIComponent(TYPE_FILTER[types])}&fl=${SUGGEST_FIELDS}&rows=${rows}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Locatieserver suggest ${res.status}`);
  const json = (await res.json()) as LocatieserverResponse<SuggestDoc>;
  return (json.response?.docs ?? []).map(placeHitFromDoc).filter((h): h is PlaceHit => h !== null);
}

/* ------------------------------ aliases and typos ------------------------------ */

/**
 * Names people type that PDOK does not know (or ranks low): applied before the query is sent.
 * Keys are compared after normalizeText.
 */
export const ALIASES: Readonly<Record<string, string>> = {
  'den bosch': "'s-Hertogenbosch",
  gorkum: 'Gorinchem',
  'den haag': "'s-Gravenhage",
};

/** The official name for an alias ("Den Bosch" → "'s-Hertogenbosch"); the query itself otherwise. */
export function applyAlias(query: string): string {
  const key = normalizeText(query).replace(/\s+/g, ' ');
  return ALIASES[key] ?? query;
}

/**
 * The fuzzy hits ordered for "Bedoelde je …?": the woonplaats that carries the name of PDOK's
 * best hit first ("Gorichem~" ranks "Gemeente Gorinchem" first, but the town is what people
 * mean), the rest in PDOK's order. The first one is flagged `didYouMean`.
 */
export function didYouMeanHits(fuzzy: readonly PlaceHit[]): PlaceHit[] {
  const best = fuzzy[0];
  if (!best) return [];
  const name = normalizeText(best.label);
  const town = fuzzy.find((h) => h.type === 'woonplaats' && normalizeText(h.label) === name) ?? best;
  return [{ ...town, didYouMean: true }, ...fuzzy.filter((h) => h !== town)];
}

/* ------------------------------ suggestion order ------------------------------ */

/** "A27" from a PDOK road name such as "A27, Gorinchem" or "Rijksweg A27"; null when none. */
export function roadFromName(name: string): string | null {
  const m = /(?:^|[\s,(])([ANSE]\s?\d{1,3})(?=$|[\s,)])/i.exec(name);
  return m ? normalizeRoadQuery(m[1] ?? '') : null;
}

export type SearchOption = { kind: 'query'; query: string } | { kind: 'road'; road: string } | LocalHit | PlaceHit;

/** A line of the dropdown: a selectable option, or a heading / note that arrow keys skip. */
export type SearchRow = { kind: 'option'; index: number } | { kind: 'heading'; label: string } | { kind: 'note'; text: string };

export interface OrderInput {
  /** What was searched for (after `applyAlias`). */
  query: string;
  /** The road number the query is, when it is one. */
  road: string | null;
  /** PDOK woonplaats / gemeente / provincie hits. */
  places: readonly PlaceHit[];
  local: readonly LocalHit[];
  /** PDOK `weg` hits. */
  streets: readonly PlaceHit[];
  /** The typo retry, only asked when everything else came back empty. */
  fuzzy?: readonly PlaceHit[];
}

export interface OrderedOptions {
  options: SearchOption[];
  rows: SearchRow[];
  /** The preselected option (Enter picks it), -1 for none. */
  active: number;
}

export const MAX_LOCAL_OPTIONS = 3;
const PLACE_RANK: Record<string, number> = { woonplaats: 0, gemeente: 1, provincie: 2 };

export function noResultText(query: string): string {
  return `Geen weg of plaats gevonden voor “${query}”. Probeer een wegnummer (A27, N322) of een plaatsnaam.`;
}

/**
 * The dropdown, in the order people mean (zoek-4, zoek-5, zoek-8):
 *   (a) the road option when the query is a road number (preselected);
 *   (b) places whose name starts with the query, the town first, preselected on an exact name;
 *   (c) "Meldingen": up to three items; places that only contain the query come after them;
 *   (d) "Straten": PDOK streets, without the ones that lead to the road option already shown
 *       ("A27, Almere", "A27, Baarn" … all opened the same road mode) and one per road number;
 *   (e) "Filter de lijst op …" last.
 * With no hit at all: the typo guesses ("Bedoelde je Gorinchem?" preselected), or a note that
 * explains what to type — and then no "Filter de lijst", which could only lead to an empty list.
 * Items are never merged, also when two share a label: their when-text tells them apart.
 */
export function orderOptions(input: OrderInput): OrderedOptions {
  const options: SearchOption[] = [];
  const rows: SearchRow[] = [];
  let active = -1;
  const add = (o: SearchOption): number => {
    options.push(o);
    rows.push({ kind: 'option', index: options.length - 1 });
    return options.length - 1;
  };
  const q = normalizeText(input.query);
  const local = input.local.slice(0, MAX_LOCAL_OPTIONS);
  const seenRoads = new Set<string>(input.road ? [input.road] : []);
  const streets = input.streets.filter((s) => {
    const r = roadFromName(s.name);
    if (!r) return true;
    if (seenRoads.has(r)) return false;
    seenRoads.add(r);
    return true;
  });
  const found = input.road !== null || input.places.length + local.length + streets.length > 0;

  if (input.road) active = add({ kind: 'road', road: input.road });

  const ranked = [...input.places].sort((a, b) => (PLACE_RANK[a.type] ?? 9) - (PLACE_RANK[b.type] ?? 9));
  const leading = ranked.filter((p) => normalizeText(p.label).startsWith(q));
  const other = input.places.filter((p) => !leading.includes(p));
  for (const p of leading) {
    const i = add(p);
    if (active < 0 && normalizeText(p.label) === q) active = i;
  }

  if (!found) {
    const fuzzy = didYouMeanHits(input.fuzzy ?? []);
    if (fuzzy.length === 0) {
      rows.push({ kind: 'note', text: noResultText(input.query) });
      return { options, rows, active };
    }
    for (const p of fuzzy.slice(0, 4)) {
      const i = add(p);
      if (active < 0) active = i;
    }
    return { options, rows, active };
  }

  if (local.length > 0) {
    rows.push({ kind: 'heading', label: 'Meldingen' });
    for (const hit of local) add(hit);
  }
  if (other.length > 0) {
    rows.push({ kind: 'heading', label: 'Plaatsen' });
    for (const p of other) add(p);
  }
  if (streets.length > 0) {
    rows.push({ kind: 'heading', label: 'Straten' });
    for (const s of streets) add(s);
  }
  add({ kind: 'query', query: input.query });
  return { options, rows, active };
}

export interface PlaceLocation {
  name: string;
  type: string;
  center: [number, number];
  bbox: [number, number, number, number] | null;
}

/** Extracts all "lon lat" pairs from a WKT string. */
export function wktCoords(wkt: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wkt)) !== null) {
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  return out;
}

export function wktBbox(wkt: string): [number, number, number, number] | null {
  const coords = wktCoords(wkt);
  if (coords.length < 2) return null;
  return coords.reduce<[number, number, number, number]>(
    (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

export async function lookupPlace(id: string, signal?: AbortSignal): Promise<PlaceLocation | null> {
  const url = `${LOCATIESERVER}/lookup?id=${encodeURIComponent(id)}&fl=id,type,weergavenaam,centroide_ll,geometrie_ll`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Locatieserver lookup ${res.status}`);
  const json = (await res.json()) as LocatieserverResponse<LookupDoc>;
  const doc = json.response?.docs?.[0];
  if (!doc) return null;
  const centroid = doc.centroide_ll ? wktCoords(doc.centroide_ll)[0] : undefined;
  if (!centroid) return null;
  return {
    name: doc.weergavenaam,
    type: doc.type,
    center: centroid,
    bbox: doc.geometrie_ll ? wktBbox(doc.geometrie_ll) : null,
  };
}

/** Sensible zoom for a PDOK result type when it has no geometry. */
export function zoomForPlaceType(type: string): number {
  switch (type) {
    case 'provincie':
      return 9;
    case 'gemeente':
      return 11;
    case 'woonplaats':
      return 12.5;
    case 'weg':
      return 14;
    default:
      return 12;
  }
}
