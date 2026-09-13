/**
 * Index rows (index/all.json, index/prov/<PVxx>.json): positional rows for search and the
 * entity pages. Loaders cache per file; helpers are pure.
 */
import { normalizeText, sameRoad } from './filter';
import { fetchJson, isIndexFile, isIndexRow } from './load';
import type { Category, Hindrance, Impact, IndexFile, IndexRow, RoadType, Severity, Vehicle } from './types';
import { DATA_FILES } from './types';
import { cleanVehicles, isImpact } from './verdict';

/** Named view over a positional IndexRow (v2 rows get `imp: 'onbekend'` and no vehicle data). */
export interface IndexItem {
  id: string;
  cat: Category;
  sub: string | null;
  sev: Severity;
  title: string;
  road: string | null;
  roadType: RoadType | null;
  gemeente: string | null;
  woonplaats: string | null;
  prov: string | null;
  start: string;
  end: string | null;
  lon: number;
  lat: number;
  closed: boolean;
  hind: Hindrance | null;
  active: boolean;
  /** Contract v3 (positions 17–21); `onbekend` / null for a 17-column v2 row. */
  imp: Impact;
  veh: Vehicle[] | null;
  per: boolean;
  spd: number | null;
  lc: number | null;
}

/** Number of positions of a contract v3 row; a v2 row has 17. */
export const INDEX_ROW_V3 = 22;

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function indexItemFromRow(r: IndexRow): IndexItem {
  // Positions beyond 16 are optional at runtime (v2 files); read them defensively.
  const raw = r as readonly unknown[];
  return {
    id: r[0],
    cat: r[1],
    sub: r[2],
    sev: r[3],
    title: r[4],
    road: r[5],
    roadType: r[6],
    gemeente: r[7],
    woonplaats: r[8],
    prov: r[9],
    start: r[10],
    end: r[11],
    lon: r[12],
    lat: r[13],
    closed: r[14] === 1,
    hind: r[15],
    active: r[16] === 1,
    imp: isImpact(raw[17]) ? raw[17] : 'onbekend',
    veh: cleanVehicles(raw[18]),
    per: raw[19] === 1 || raw[19] === true,
    spd: positiveInt(raw[20]),
    lc: positiveInt(raw[21]),
  };
}

export function rowsToItems(rows: readonly unknown[]): IndexItem[] {
  return rows.filter(isIndexRow).map(indexItemFromRow);
}

const fileCache = new Map<string, Promise<IndexFile>>();

function loadIndexFile(file: string): Promise<IndexFile> {
  const cached = fileCache.get(file);
  if (cached) return cached;
  const p = fetchJson(file, isIndexFile).catch((err: unknown) => {
    fileCache.delete(file);
    throw err;
  });
  fileCache.set(file, p);
  return p;
}

export async function loadIndexAll(): Promise<IndexFile> {
  return loadIndexFile(DATA_FILES.indexAll);
}

/** Province shard, e.g. "PV30"; falls back to the full index when the code is unknown. */
export async function loadIndexProv(provCode: string | null | undefined): Promise<IndexFile> {
  const code = (provCode ?? '').trim();
  if (!/^PV\d{2}$/.test(code)) return loadIndexAll();
  return loadIndexFile(DATA_FILES.indexProv(code));
}

/* --------------------------------- filters --------------------------------- */

export function itemsOnRoad(items: readonly IndexItem[], road: string): IndexItem[] {
  return items.filter((it) => sameRoad(it.road, road));
}

export function itemsInGemeente(items: readonly IndexItem[], gemeente: string): IndexItem[] {
  const g = normalizeText(gemeente);
  return items.filter((it) => it.gemeente !== null && normalizeText(it.gemeente) === g);
}

export function itemsInWoonplaats(items: readonly IndexItem[], woonplaats: string): IndexItem[] {
  const w = normalizeText(woonplaats);
  return items.filter((it) => it.woonplaats !== null && normalizeText(it.woonplaats) === w);
}

/** Active items first (impact desc), then upcoming by start ascending. */
export function sortIndexItems(items: readonly IndexItem[]): IndexItem[] {
  return [...items].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.active) return b.sev - a.sev || a.start.localeCompare(b.start) || a.id.localeCompare(b.id);
    return a.start.localeCompare(b.start) || b.sev - a.sev || a.id.localeCompare(b.id);
  });
}

export function splitActive(items: readonly IndexItem[]): { active: IndexItem[]; upcoming: IndexItem[] } {
  return {
    active: items.filter((it) => it.active),
    upcoming: items.filter((it) => !it.active),
  };
}
