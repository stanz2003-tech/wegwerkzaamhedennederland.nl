/**
 * Loading the pipeline output (contract v2). Every fetch has a timeout, a structural check
 * and a Dutch error message. Essential at start: meta.json + werk-actueel.geojson; live.geojson
 * is optional (a warning), werk-gepland.geojson is lazy.
 */
import type { BridgeFile, EntityFile, IndexFile, IndexRow, ItemCollection, ItemFeature, Meta } from './types';
import { DATA_FILES } from './types';
import { setHorizonFromMeta } from './horizon';

const FETCH_TIMEOUT_MS = 20_000;

export class DataLoadError extends Error {
  readonly file: string;
  readonly status: number | null;

  constructor(message: string, file: string, status: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DataLoadError';
    this.file = file;
    this.status = status;
  }
}

/** Base URL of the data files, always with a trailing slash. */
export function dataBase(): string {
  const env = import.meta.env.VITE_DATA_BASE as string | undefined;
  const base = env && env.trim() !== '' ? env.trim() : '/data/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function dataUrl(file: string): string {
  return `${dataBase()}${file}`;
}

export async function fetchJson<T>(file: string, validate: (v: unknown) => v is T, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(dataUrl(file), { signal: controller.signal, cache: 'no-cache' });
    if (!res.ok) throw new DataLoadError(`${file}: HTTP ${res.status}`, file, res.status);
    const json: unknown = await res.json();
    if (!validate(json)) throw new DataLoadError(`${file}: onverwachte structuur`, file);
    return json;
  } catch (err) {
    if (err instanceof DataLoadError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new DataLoadError(`${file}: ${reason}`, file, null, { cause: err });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------- validators ------------------------------- */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isItemCollection(v: unknown): v is ItemCollection {
  return isRecord(v) && v.type === 'FeatureCollection' && Array.isArray(v.features);
}

export function isMeta(v: unknown): v is Meta {
  return isRecord(v) && typeof v.generated === 'string' && isRecord(v.counts);
}

/** Accepts both the 17-column v2 row and the 22-column v3 row (positions 17–21 are optional). */
export function isIndexRow(r: unknown): r is IndexRow {
  return Array.isArray(r) && r.length >= 17 && typeof r[0] === 'string' && typeof r[1] === 'string' && typeof r[4] === 'string';
}

/** `roads/<slug>.json` / `gemeenten/<slug>.json` (contract v3). */
export function isEntityFile(v: unknown): v is EntityFile {
  return (
    isRecord(v) &&
    typeof v.generated === 'string' &&
    (v.kind === 'road' || v.kind === 'gemeente') &&
    typeof v.key === 'string' &&
    Array.isArray(v.items)
  );
}

export function isIndexFile(v: unknown): v is IndexFile {
  return isRecord(v) && typeof v.generated === 'string' && Array.isArray(v.rows);
}

export function isBridgeFile(v: unknown): v is BridgeFile {
  return isRecord(v) && typeof v.generated === 'string' && Array.isArray(v.bridges);
}

/** Keeps only features with a usable geometry and the required properties. */
export function sanitizeFeatures(fc: ItemCollection): ItemFeature[] {
  return fc.features.filter((f): f is ItemFeature => {
    if (!f || !f.geometry || !f.properties) return false;
    const g = f.geometry;
    if (g.type !== 'Point' && g.type !== 'LineString' && g.type !== 'MultiLineString') return false;
    const p = f.properties;
    return typeof p.id === 'string' && typeof p.cat === 'string' && typeof p.start === 'string' && typeof p.title === 'string';
  });
}

/* --------------------------------- loaders -------------------------------- */

export interface StartData {
  meta: Meta;
  actueel: ItemFeature[];
  live: ItemFeature[];
  /** Files that failed to load (non-essential ones). */
  warnings: string[];
}

export async function loadMeta(signal?: AbortSignal): Promise<Meta> {
  const meta = await fetchJson(DATA_FILES.meta, isMeta, signal);
  // Every page reaches meta.json through here, so this is the one place the data horizon has to
  // be recorded for the answer logic (see data/horizon.ts).
  setHorizonFromMeta(meta);
  return meta;
}

export async function loadCollection(file: string, signal?: AbortSignal): Promise<ItemFeature[]> {
  const fc = await fetchJson(file, isItemCollection, signal);
  return sanitizeFeatures(fc);
}

export async function loadLive(signal?: AbortSignal): Promise<ItemFeature[]> {
  return loadCollection(DATA_FILES.live, signal);
}

export async function loadActueel(signal?: AbortSignal): Promise<ItemFeature[]> {
  return loadCollection(DATA_FILES.werkActueel, signal);
}

export async function loadGepland(signal?: AbortSignal): Promise<ItemFeature[]> {
  return loadCollection(DATA_FILES.werkGepland, signal);
}

function reasonText(r: PromiseRejectedResult): string {
  return r.reason instanceof Error ? r.reason.message : String(r.reason);
}

/** Loads what the map needs at start; throws only when meta or werk-actueel fail. */
export async function loadStartData(signal?: AbortSignal): Promise<StartData> {
  const [metaRes, actueelRes, liveRes] = await Promise.allSettled([
    loadMeta(signal),
    loadCollection(DATA_FILES.werkActueel, signal),
    loadLive(signal),
  ]);
  if (metaRes.status === 'rejected') throw metaRes.reason;
  if (actueelRes.status === 'rejected') throw actueelRes.reason;
  const warnings: string[] = [];
  let live: ItemFeature[] = [];
  if (liveRes.status === 'fulfilled') live = liveRes.value;
  else warnings.push(reasonText(liveRes));
  return { meta: metaRes.value, actueel: actueelRes.value, live, warnings };
}

export interface LiveRefresh {
  meta: Meta;
  live: ItemFeature[];
}

/** Periodic refresh of the small files (meta + live). */
export async function loadLiveRefresh(signal?: AbortSignal): Promise<LiveRefresh> {
  const [meta, live] = await Promise.all([loadMeta(signal), loadLive(signal)]);
  return { meta, live };
}

export async function loadBridges(signal?: AbortSignal): Promise<BridgeFile> {
  return fetchJson(DATA_FILES.bruggen, isBridgeFile, signal);
}
