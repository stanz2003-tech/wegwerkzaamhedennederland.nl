/**
 * The items the map page holds: werk-actueel and live from the start (live refreshed every 90 s),
 * werk-gepland loaded once, lazily, when a question looks ahead (or a route needs it). Moved out
 * of main.ts so the page entry stays the wiring; main.ts still decides when to load and render.
 */
import { dedupeById } from '../data/filter';
import { loadGepland } from '../data/load';
import type { ItemFeature, Meta } from '../data/types';

export interface MapDataCallbacks {
  /** Whether the current question needs werk-gepland (main.ts `needsGepland`). */
  needsGepland(): boolean;
  /** werk-gepland arrived (main.ts re-renders). */
  onGepland(): void;
  onGeplandError(): void;
}

export interface MapData {
  /** Live + actueel, plus gepland when the question needs it; deduplicated. */
  items(): ItemFeature[];
  /** Everything loaded, gepland included (a route can run into work that starts on the way). */
  everything(): ItemFeature[];
  /** The item by id among `items()` as of the last load. */
  byId(id: string): ItemFeature | undefined;
  meta(): Meta | null;
  lastRefresh(): number;
  setStart(d: { meta: Meta; actueel: ItemFeature[]; live: ItemFeature[] }): void;
  setLive(d: { meta: Meta; live: ItemFeature[] }): void;
  ensureGepland(): Promise<void>;
  /** The werk-gepland request in flight or done; null before the first and after a failure. */
  geplandPending(): Promise<void> | null;
  geplandLoaded(): boolean;
}

export function createMapData(cb: MapDataCallbacks): MapData {
  let actueel: ItemFeature[] = [];
  let live: ItemFeature[] = [];
  let gepland: ItemFeature[] = [];
  let geplandLoad: Promise<void> | null = null;
  let geplandLoaded = false;
  let meta: Meta | null = null;
  let index = new Map<string, ItemFeature>();
  let lastRefresh = 0;

  const items = (): ItemFeature[] => dedupeById(cb.needsGepland() ? [...live, ...actueel, ...gepland] : [...live, ...actueel]);
  const reindex = (): void => {
    index = new Map(items().map((f) => [f.properties.id, f]));
  };

  const ensureGepland = (): Promise<void> => {
    if (geplandLoad) return geplandLoad;
    geplandLoad = loadGepland()
      .then((loaded) => {
        gepland = loaded;
        geplandLoaded = true;
        reindex();
        cb.onGepland();
      })
      .catch(() => {
        geplandLoad = null;
        cb.onGeplandError();
      });
    return geplandLoad;
  };

  return {
    items,
    everything: () => dedupeById([...live, ...actueel, ...gepland]),
    byId: (id) => index.get(id),
    meta: () => meta,
    lastRefresh: () => lastRefresh,
    setStart(d) {
      meta = d.meta;
      actueel = d.actueel;
      live = d.live;
      lastRefresh = Date.now();
      reindex();
    },
    setLive(d) {
      meta = d.meta;
      live = d.live;
      lastRefresh = Date.now();
      reindex();
    },
    ensureGepland,
    geplandPending: () => geplandLoad,
    geplandLoaded: () => geplandLoaded,
  };
}
