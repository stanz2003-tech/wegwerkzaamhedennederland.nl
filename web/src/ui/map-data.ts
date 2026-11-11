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
  /** The item by id among `items()`: werk-gepland only counts while the question needs it. */
  byId(id: string): ItemFeature | undefined;
  /** The item by id among everything loaded (`everything()`), whatever the question. */
  find(id: string): ItemFeature | undefined;
  meta(): Meta | null;
  lastRefresh(): number;
  setStart(d: { meta: Meta; actueel: ItemFeature[]; live: ItemFeature[] }): void;
  setLive(d: { meta: Meta; live: ItemFeature[] }): void;
  ensureGepland(): Promise<void>;
  /** The werk-gepland request in flight or done; null before the first and after a failure. */
  geplandPending(): Promise<void> | null;
  geplandLoaded(): boolean;
}

/** `load`: how werk-gepland is fetched (the tests pass a stand-in). */
export function createMapData(cb: MapDataCallbacks, load: () => Promise<ItemFeature[]> = loadGepland): MapData {
  let actueel: ItemFeature[] = [];
  let live: ItemFeature[] = [];
  let gepland: ItemFeature[] = [];
  let geplandLoad: Promise<void> | null = null;
  let geplandLoaded = false;
  let meta: Meta | null = null;
  /*
   * Two indexes, so a lookup always agrees with the items of the moment: one of the start data
   * and one with werk-gepland. A single index built from `items()` at load time missed a planned
   * item whenever werk-gepland arrived while the question was "Nu" — exactly what a deep link to a
   * planned melding does — until the next 90 s refresh.
   */
  let startIndex = new Map<string, ItemFeature>();
  let allIndex = startIndex;
  let lastRefresh = 0;

  const startItems = (): ItemFeature[] => dedupeById([...live, ...actueel]);
  const everything = (): ItemFeature[] => dedupeById([...live, ...actueel, ...gepland]);
  const items = (): ItemFeature[] => (cb.needsGepland() ? everything() : startItems());
  const indexOf = (features: readonly ItemFeature[]): Map<string, ItemFeature> => new Map(features.map((f) => [f.properties.id, f]));
  const reindex = (): void => {
    startIndex = indexOf(startItems());
    allIndex = gepland.length > 0 ? indexOf(everything()) : startIndex;
  };

  const ensureGepland = (): Promise<void> => {
    if (geplandLoad) return geplandLoad;
    geplandLoad = load()
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
    everything,
    byId: (id) => (cb.needsGepland() ? allIndex : startIndex).get(id),
    find: (id) => allIndex.get(id),
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
