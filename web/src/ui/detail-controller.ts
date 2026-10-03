/**
 * The detail view as the map page drives it: selecting an item (or clearing the selection),
 * loading its detail shard, painting it for the asked vehicle and moment or day, "Terug" and
 * "Deel". main.ts owns the URL state and hands this module what it needs (`DetailHost`), the
 * same way ui/place-controller.ts works, so the page entry stays the wiring.
 */
import { loadDetail } from '../data/detail';
import { midpointOf } from '../data/filter';
import type { ItemDetail, ItemFeature } from '../data/types';
import { detailStepBackAllowed, itemDeepLink, type HistoryMarker, type UrlState } from '../data/url-state';
import type { AppMap } from '../map/map';
import { renderDetail } from './detail';
import { copyLink } from './map-page';
import { dayWindowOf, whenLabelOf } from './panel-answer';

export interface DetailHost {
  url(): UrlState;
  setUrl(next: UrlState): void;
  item(id: string): ItemFeature | null;
  map(): AppMap | null;
  syncUrl(push: HistoryMarker | false): void;
  /** "Alleen de A27 bekijken" in the detail. */
  enterRoad(road: string): void;
  /** Detail view on (the list hidden) or off. */
  setDetail(open: boolean): void;
  /** Focuses the visible "Terug". */
  focusBack(): void;
  listSelected(id: string | null): void;
  /** Gives the focus back to the row the detail was opened from. */
  focusRow(id: string | null): void;
  /** The sheet at least half open and the camera padding updated, before flying to the item. */
  makeRoom(): void;
  detailEl: HTMLElement;
  listEl: HTMLElement;
}

export interface DetailController {
  selected(): ItemFeature | null;
  /**
   * Selects an item (or clears the selection) and updates map, URL and panel. `push` (default:
   * opening an item while none was open) gives the item its own history entry; switching from one
   * item to the next replaces it, so the back button does not walk through every row.
   */
  select(id: string | null, fly?: boolean, push?: boolean): void;
  /**
   * Re-paints the open detail. `open`: the detail was just opened, so "Terug" gets the focus. A
   * repaint (mode, moment, the loaded shard) keeps the focus where it is — the date field must stay
   * editable in detail view — unless it sat inside the re-rendered detail.
   */
  paint(open?: boolean): void;
  /**
   * "Terug": when this page view pushed the entry of the open item, step back in the history (the
   * back gesture and the button then agree); after a deep link or a reload there is no such entry,
   * and the detail just closes — "Terug" never leaves the site.
   */
  close(): void;
  share(): Promise<void>;
  /** The detour polyline of the open detail, when the wegbeheerder published one. */
  detour(): [number, number][] | null;
}

export function createDetailController(host: DetailHost): DetailController {
  let selected: ItemFeature | null = null;
  let data: ItemDetail | null = null;
  let failed = false;

  const detour = (): [number, number][] | null => {
    const g = data?.detourGeom;
    return g && g.length >= 2 ? g : null;
  };

  const paint = (open = false): void => {
    if (!selected) return;
    const refocus = open || host.detailEl.contains(document.activeElement);
    host.detailEl.hidden = false;
    host.listEl.hidden = true;
    host.setDetail(true);
    const now = Date.now();
    const url = host.url();
    const dayWin = dayWindowOf(url, now);
    renderDetail(
      host.detailEl,
      {
        props: selected.properties,
        center: midpointOf(selected.geometry),
        detail: data,
        loading: data === null && !failed,
        error: failed,
        mode: url.mode,
        at: url.moment ?? now,
        ...(dayWin ? { window: dayWin, whenLabel: whenLabelOf(url) } : {}),
        roadMode: url.road,
      },
      now,
      {
        onBack: () => close(),
        onShare: () => void share(),
        onRetry: () => void load(selected),
        onRoad: (road) => host.enterRoad(road),
      },
    );
    if (refocus) host.focusBack();
    host.map()?.setDetour(detour());
  };

  const share = async (): Promise<void> => {
    if (selected) await copyLink(itemDeepLink(selected.properties.id));
  };

  const load = async (feature: ItemFeature | null, open = false): Promise<void> => {
    if (!feature) return;
    const id = feature.properties.id;
    data = null;
    failed = false;
    paint(open);
    try {
      const d = await loadDetail(id);
      if (selected?.properties.id !== id) return;
      data = d;
      failed = d === null;
    } catch {
      if (selected?.properties.id !== id) return;
      failed = true;
    }
    paint();
  };

  const close = (): void => {
    if (selected && detailStepBackAllowed()) {
      window.history.back();
      return;
    }
    select(null);
  };

  const select = (id: string | null, fly = true, push?: boolean): void => {
    const previous = selected?.properties.id ?? null;
    const feature = id ? host.item(id) : null;
    selected = feature;
    host.setUrl({ ...host.url(), id: feature ? feature.properties.id : null });
    host.map()?.setSelected(feature ? feature.properties.id : null);
    host.listSelected(feature ? feature.properties.id : null);
    if (!feature) {
      host.detailEl.hidden = true;
      host.listEl.hidden = false;
      host.setDetail(false);
      data = null;
      failed = false;
      host.map()?.setDetour(null);
      host.syncUrl(false);
      host.focusRow(previous);
      return;
    }
    host.makeRoom();
    if (fly) host.map()?.fitToFeature(feature);
    void load(feature, true);
    host.syncUrl((push ?? previous === null) ? { wegwerk: true, detail: true } : false);
  };

  return { selected: () => selected, select, paint, close, share, detour };
}
