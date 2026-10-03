/**
 * Place mode as the map page drives it: entering and leaving it, a place picked in the search
 * box, the entity-page manifest that names a `?plaats=` slug, and the "Bedoelde je …?" of the
 * empty list. main.ts owns the state and hands this module what it needs (`PlaceHost`), so the
 * page entry does not grow with every mode. The pure parts live in ui/place-mode.ts.
 */
import { entityPagesNow, loadEntityPages } from '../data/entity-pages';
import type { PlaceHit, PlaceLocation } from '../data/search-index';
import type { HistoryMarker, PlaceRef, UrlState } from '../data/url-state';
import type { AppMap } from '../map/map';
import type { DidYouMean } from './list';
import { createDidYouMean, placeFromHit, resolvePlace } from './place-mode';

export interface LeaveOptions {
  /** The caller moves on to something else (a place, a deep-linked item) that speaks for itself. */
  quiet?: boolean;
  /** A history entry of its own (default; the "× Alle plaatsen" button), not on the back button. */
  push?: boolean;
  /** Move the focus (default); not when the caller decides where it goes. */
  focus?: boolean;
}

export const QUIETLY: LeaveOptions = { quiet: true, push: false, focus: false };
const STEP: HistoryMarker = { wegwerk: true };

export interface PlaceHost {
  url(): UrlState;
  setUrl(next: UrlState): void;
  dataOk(): boolean;
  render(): void;
  syncUrl(push: HistoryMarker | false): void;
  map(): AppMap | null;
  setQuery(q: string): void;
  /** Runs a place hit through the search box's own pick (lookup + frame + `pick`). */
  pickInSearch(hit: PlaceHit): void;
  /** Closes an open item without a history entry. */
  deselect(): void;
  leaveRoad(o: LeaveOptions): void;
  /** Answer in view, headline focused, spoken; `withMap`: the sheet at half on a phone. */
  showAnswer(withMap: boolean): void;
  /** Focus after leaving a subject, then speak unless quiet. */
  afterLeave(o: LeaveOptions): void;
  /** Re-paint an open detail (its "Alles in Almkerk" link needs the manifest). */
  repaintDetail(): void;
  /** The sheet down to its handle, for a zoom-only pick on a phone. */
  peek(): void;
}

export interface PlaceController {
  /** The place of place mode once its name is known; a bare URL slug is not applied yet. */
  active(): PlaceRef | null;
  enter(place: PlaceRef, fit: boolean): void;
  exit(o?: LeaveOptions): void;
  /** A PDOK place or street from the search box. */
  pick(loc: PlaceLocation | null, zoom: number, hit: PlaceHit): void;
  /** Whether the map should be fitted to the place's items now (once). */
  takeFit(): boolean;
  wantFit(): void;
  /** The `didYouMean` option of the empty text-filter list, when a guess is known. */
  didYouMeanOpt(query: string): { didYouMean?: DidYouMean };
}

export function createPlaceController(host: PlaceHost): PlaceController {
  let pendingFit = false;

  const active = (): PlaceRef | null => {
    const p = host.url().place;
    return p && p.name ? p : null;
  };

  const enter = (place: PlaceRef, fit: boolean): void => {
    host.setUrl({ ...host.url(), place, road: null, query: '' });
    pendingFit = fit;
    host.setQuery(place.name);
    host.deselect();
    host.render();
    host.syncUrl(STEP);
    host.showAnswer(true);
  };

  const exit = (o: LeaveOptions = {}): void => {
    host.setUrl({ ...host.url(), place: null });
    host.setQuery('');
    pendingFit = false;
    host.render();
    host.syncUrl(o.push === false ? false : STEP);
    host.afterLeave(o);
  };

  /** Frames the PDOK geometry; after the sheet moved, so the camera padding is the final one. */
  const frame = (loc: PlaceLocation | null, zoom: number): void => {
    const map = host.map();
    if (loc?.bbox) map?.fitBBox(loc.bbox, zoom);
    else if (loc) map?.flyTo(loc.center, zoom);
  };

  const pick = (loc: PlaceLocation | null, zoom: number, hit: PlaceHit): void => {
    const place = placeFromHit(hit, entityPagesNow());
    if (place) {
      enter(place, !loc);
      frame(loc, zoom);
      return;
    }
    // A provincie or a street stays zoom-only.
    if (host.url().road) host.leaveRoad(QUIETLY);
    if (host.url().place) exit(QUIETLY);
    if (loc) host.peek();
    frame(loc, zoom);
  };

  const didYouMean = createDidYouMean((q) => {
    if (host.url().query === q && host.dataOk()) host.render();
  });

  // The manifest names a `?plaats=` slug and says which place pages exist (links stay hidden
  // until it is here, and when it fails). An unknown slug is dropped from the URL.
  void loadEntityPages().then((pages) => {
    const ref = host.url().place;
    if (ref) {
      const place = resolvePlace(ref, pages);
      if (!ref.name && place) {
        host.setQuery(place.name);
        pendingFit = true;
      }
      host.setUrl({ ...host.url(), place });
      host.syncUrl(false);
    }
    if (!host.dataOk()) return;
    host.render();
    host.repaintDetail();
  });

  return {
    active,
    enter,
    exit,
    pick,
    takeFit() {
      const fit = pendingFit;
      pendingFit = false;
      return fit;
    },
    wantFit() {
      pendingFit = true;
    },
    didYouMeanOpt(query) {
      const hit = didYouMean(query);
      return hit ? { didYouMean: { label: hit.label, onPick: () => host.pickInSearch(hit) } } : {};
    },
  };
}
