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
}

export interface PlaceHit {
  kind: 'place';
  id: string;
  name: string;
  /** PDOK type: weg | woonplaats | gemeente | provincie */
  type: string;
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
    });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'nl'));
  return hits.slice(0, limit);
}

/* ----------------------------- PDOK Locatieserver ---------------------------- */

const LOCATIESERVER = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';
const SUGGEST_TYPES = 'type:(weg OR woonplaats OR gemeente OR provincie)';

interface SuggestDoc {
  id: string;
  weergavenaam: string;
  type: string;
}

interface LookupDoc extends SuggestDoc {
  centroide_ll?: string;
  geometrie_ll?: string;
}

interface LocatieserverResponse<T> {
  response?: { docs?: T[] };
}

export async function suggestPlaces(query: string, signal?: AbortSignal, rows = 6): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${LOCATIESERVER}/suggest?q=${encodeURIComponent(q)}&fq=${encodeURIComponent(SUGGEST_TYPES)}&rows=${rows}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Locatieserver suggest ${res.status}`);
  const json = (await res.json()) as LocatieserverResponse<SuggestDoc>;
  const docs = json.response?.docs ?? [];
  return docs
    .filter((d) => typeof d.id === 'string' && typeof d.weergavenaam === 'string')
    .map((d) => ({ kind: 'place' as const, id: d.id, name: d.weergavenaam, type: String(d.type ?? '') }));
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
