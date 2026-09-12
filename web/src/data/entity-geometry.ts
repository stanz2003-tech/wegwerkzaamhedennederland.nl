/**
 * Real geometry for the small map of a generated entity page.
 *
 * The index rows only carry a representative point (`lon`/`lat`), so a page built from the index
 * alone shows a dot per measure and never the shape of the works — on /weg/a2/ that means 296
 * points and not a single metre of the motorway. The `LineString`/`MultiLineString` geometry
 * lives in the GeoJSON collections, so the page loads the collections its items actually come
 * from and keeps the features whose id it shows.
 *
 * The collections are big for a page map (werk-actueel ≈ 0.6 MB gzipped, werk-gepland ≈ 1.15 MB),
 * so this runs *after* the map is mounted with the index points: the map is usable immediately
 * and upgrades to the real lines when the data arrives. Filtering happens after the download —
 * there is no per-entity file to fetch instead.
 *
 * `werk-gepland` is deliberately NOT downloaded for a page map (`includePlanned` defaults to
 * false). It would more than double the page weight for a visitor who arrives from a search
 * engine on a single road page, while the shape of a work that starts in three weeks adds little:
 * planned items keep their index point on the map and are fully described in the list next to it.
 * The proper fix, if the shapes turn out to matter, is per-entity geometry files from the pipeline
 * (`roads/<weg>.json`), not a bigger download here.
 */
import type { IndexItem } from './index';
import { loadActueel, loadGepland, loadLive } from './load';
import type { ItemFeature } from './types';

/** Which GeoJSON collections hold the geometry of these items. */
export interface NeededCollections {
  /** Items the pipeline marked active live in werk-actueel (works/closures) or live.geojson. */
  actueel: boolean;
  live: boolean;
  /** Items that are not active yet live in werk-gepland. */
  gepland: boolean;
}

/** Categories that the pipeline publishes in live.geojson rather than werk-actueel. */
const LIVE_CATS = new Set(['file', 'incident', 'brug']);

export interface GeometryOptions {
  /**
   * Also download `werk-gepland.geojson` (≈ 1.15 MB gzipped) for the line geometry of items that
   * have not started yet. Off by default; see the note at the top of this file.
   */
  includePlanned?: boolean;
}

/**
 * Decides which collections to download for a set of index rows. An empty list needs nothing,
 * and a page with only planned works downloads nothing unless `includePlanned` is set.
 */
export function neededCollections(
  items: readonly IndexItem[],
  opts: GeometryOptions = {},
): NeededCollections {
  const needed: NeededCollections = { actueel: false, live: false, gepland: false };
  for (const it of items) {
    if (!it.active) needed.gepland = opts.includePlanned === true;
    else if (LIVE_CATS.has(it.cat)) needed.live = true;
    else needed.actueel = true;
  }
  return needed;
}

/** The features whose id is in `ids`, deduplicated, first occurrence wins. */
export function pickByIds(features: readonly ItemFeature[], ids: ReadonlySet<string>): ItemFeature[] {
  const seen = new Set<string>();
  const out: ItemFeature[] = [];
  for (const f of features) {
    const id = f.properties.id;
    if (!ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(f);
  }
  return out;
}

/** True when the feature adds a shape the index row could not express. */
export function hasLineGeometry(f: ItemFeature): boolean {
  return f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString';
}

/**
 * Loads the real geometry of the given items. Never rejects: a page map with index points is
 * better than no map, so every failed collection is skipped with a warning.
 */
export async function loadEntityGeometry(
  items: readonly IndexItem[],
  signal?: AbortSignal,
  opts: GeometryOptions = {},
): Promise<ItemFeature[]> {
  const needed = neededCollections(items, opts);
  const jobs: Promise<ItemFeature[]>[] = [];
  if (needed.actueel) jobs.push(loadActueel(signal));
  if (needed.live) jobs.push(loadLive(signal));
  if (needed.gepland) jobs.push(loadGepland(signal));
  if (jobs.length === 0) return [];

  const ids = new Set(items.map((it) => it.id));
  const settled = await Promise.allSettled(jobs);
  const out: ItemFeature[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') out.push(...pickByIds(result.value, ids));
    else console.warn('[wegwerk] kaartgeometrie niet geladen:', result.reason instanceof Error ? result.reason.message : String(result.reason));
  }
  return out;
}
