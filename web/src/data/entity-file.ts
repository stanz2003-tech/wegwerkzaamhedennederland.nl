/**
 * Per-entity files of contract v3: `roads/<slug>.json` and `gemeenten/<slug>.json`, each holding
 * every item of one road or gemeente with geometry AND full detail (incl. recurring `periods`).
 * An entity page loads one of these instead of the national index + detail shards, so it can
 * answer "kan ik op <datum> over de A2?" exactly.
 *
 * A 404 means "no such file" (v2 data, or an entity without items) and resolves to null; the
 * caller then falls back to the index. Other failures reject.
 */
import { midpointOf } from './filter';
import type { IndexItem } from './index';
import { DataLoadError, fetchJson, isEntityFile, isRecord } from './load';
import type { EntityFile, EntityItem, ItemFeature } from './types';
import { DATA_FILES } from './types';
import { cleanVehicles, isImpact } from './verdict';

const fileCache = new Map<string, Promise<EntityFile | null>>();

function isEntityItem(v: unknown): v is EntityItem {
  if (!isRecord(v) || !isRecord(v.f) || !isRecord(v.d)) return false;
  const f = v.f;
  if (f.type !== 'Feature' || !isRecord(f.geometry) || !isRecord(f.properties)) return false;
  const g = f.geometry;
  if (g.type !== 'Point' && g.type !== 'LineString' && g.type !== 'MultiLineString') return false;
  const p = f.properties;
  return typeof p.id === 'string' && typeof p.cat === 'string' && typeof p.start === 'string' && typeof p.title === 'string';
}

/** Drops malformed items; keeps the file's order (active first, then by start). */
export function sanitizeEntityItems(file: EntityFile): EntityItem[] {
  return file.items.filter(isEntityItem);
}

export async function loadEntityFile(kind: 'road' | 'gemeente', slug: string): Promise<EntityFile | null> {
  const file = kind === 'road' ? DATA_FILES.road(slug) : DATA_FILES.gemeente(slug);
  const cached = fileCache.get(file);
  if (cached) return cached;
  const p = fetchJson(file, isEntityFile)
    .then((f): EntityFile | null => ({ ...f, items: sanitizeEntityItems(f) }))
    .catch((err: unknown) => {
      if (err instanceof DataLoadError && err.status === 404) return null;
      fileCache.delete(file);
      throw err;
    });
  fileCache.set(file, p);
  return p;
}

/** Slug of the entity a generated page is about, from its URL: `/weg/a2/` → "a2". */
export function slugFromPath(pathname: string, prefix: '/weg/' | '/gemeente/' | '/plaats/'): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/(index\.html)?$/, '');
  return rest !== '' && !rest.includes('/') ? rest : null;
}

/** The compact feature of an EntityItem as an index row view, so the existing list code works. */
export function indexItemFromFeature(f: ItemFeature): IndexItem {
  const p = f.properties;
  const mid = midpointOf(f.geometry) ?? [0, 0];
  const activeNow = Date.now();
  const start = Date.parse(p.start);
  const end = p.end ? Date.parse(p.end) : Number.POSITIVE_INFINITY;
  return {
    id: p.id,
    cat: p.cat,
    sub: p.sub ?? null,
    sev: p.sev,
    title: p.title,
    road: p.road ?? null,
    roadType: p.roadType ?? null,
    gemeente: p.gemeente ?? null,
    woonplaats: p.woonplaats ?? null,
    prov: p.prov ?? null,
    start: p.start,
    end: p.end ?? null,
    lon: mid[0],
    lat: mid[1],
    closed: p.closed === true,
    hind: p.hind ?? null,
    // EntityFiles carry no explicit active flag; the pipeline sorts active items first and the
    // time span says the rest. Items between two nightly periods still count as active here;
    // the verdict handles the period check.
    active: Number.isFinite(start) && start <= activeNow && end >= activeNow,
    imp: isImpact(p.imp) ? p.imp : 'onbekend',
    veh: cleanVehicles(p.veh),
    per: p.per === true,
    spd: typeof p.spd === 'number' ? p.spd : null,
    lc: typeof p.lc === 'number' ? p.lc : null,
  };
}
