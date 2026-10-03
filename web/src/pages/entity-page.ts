/**
 * Shared logic of the road and place pages: load the EntityFile of contract v3 when it exists
 * (geometry + full detail incl. `periods`), fall back to the index (+ live.geojson) otherwise,
 * and drive the forecast block, the list and the small map from one set of items.
 */
import type { AnswerSubject } from '../data/answer';
import { featureFromIndexItem, splitForEntity } from '../data/entity';
import { indexItemFromFeature, loadEntityFile } from '../data/entity-file';
import type { ForecastItem } from '../data/forecast';
import type { IndexItem } from '../data/index';
import type { EntityItem, ItemDetail, ItemFeature, RoadType } from '../data/types';
import { readStoredMode, setWhenParams, storeMode, type UrlState } from '../data/url-state';
import { isRelevantFor, verdictFor, type VehicleMode } from '../data/verdict';
import type { EntityMap, EntityView } from '../map/entity-map';
import { mountPageMap, upgradeMapGeometry } from '../ui/entity-map-mount';
import { renderEntityList, sortByVerdict, summaryText, type EntitySection } from '../ui/entity-list';
import { mountForecastBlock, type ForecastState } from '../ui/forecast-block';
import { fmtDay, formatCount } from '../ui/format';
import { localDateKey } from '../data/time';
import { setEmptyVisible, setText } from '../ui/page-boot';

export interface EntitySource {
  /** Items with geometry and detail (EntityFile) or index points and no detail (fallback). */
  items: ForecastItem[];
  /** True when the EntityFile was used (real geometry for every item, periods available). */
  fromEntityFile: boolean;
}

/** Loads the EntityFile; null when it does not exist (v2 data / no items) or fails. */
export async function loadEntitySource(kind: 'road' | 'gemeente', slug: string | null, filter?: (it: EntityItem) => boolean): Promise<EntitySource | null> {
  if (!slug) return null;
  try {
    const file = await loadEntityFile(kind, slug);
    if (!file) return null;
    const items = (filter ? file.items.filter(filter) : file.items).map((it) => ({ f: it.f, d: it.d }));
    return { items, fromEntityFile: true };
  } catch (err) {
    console.warn('[wegwerk] entiteitsbestand niet geladen, val terug op de index:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Fallback source: index rows (representative points) plus live features for their real lines. */
export function sourceFromIndex(rows: readonly IndexItem[], live: readonly ItemFeature[]): EntitySource {
  const liveById = new Map(live.map((f) => [f.properties.id, f]));
  return {
    items: rows.map((it) => ({ f: liveById.get(it.id) ?? featureFromIndexItem(it), d: null })),
    fromEntityFile: false,
  };
}

export function detailsOf(source: EntitySource): Map<string, ItemDetail> {
  const m = new Map<string, ItemDetail>();
  for (const it of source.items) if (it.d) m.set(it.f.properties.id, it.d);
  return m;
}

/** Initial vehicle mode of a page: `?v=` wins, then the stored choice, then auto. */
export function initialMode(url: UrlState): VehicleMode {
  if (window.location.search.includes('v=')) return url.mode;
  return readStoredMode() ?? url.mode;
}

export interface EntityPageOptions {
  subject: AnswerSubject;
  roadType?: RoadType | null;
  url: UrlState;
  source: EntitySource;
  view: EntityView;
  listEl: HTMLElement | null;
  forecastEl: HTMLElement | null;
  /** Hidden nvt items are still counted for the hero counters; the list shows what applies. */
  linkQuery?: string;
  /** "20:17" while the data is stale: the answer for "nu" then names that moment. */
  dataAsOf?: string;
}

/** The "Wanneer?" choice of the block as URL parameters: `t` for a moment, `dag` (+ `deel`) for a day. */
export function whenParamsOf(state: Pick<ForecastState, 'selection'>): { moment: number | null; day: string | null; part: UrlState['part'] } {
  const s = state.selection;
  if (s.kind === 'moment') return { moment: s.at, day: null, part: null };
  if (s.kind === 'day') return { moment: null, day: localDateKey(s.cell.from), part: null };
  if (s.kind === 'window') return { moment: null, day: s.date, part: s.part };
  return { moment: null, day: null, part: null };
}

/**
 * The context a link from this page to the map carries: vehicle and moment or day
 * (`v=vracht&dag=2026-10-06`), so the map answers the question the page just showed (zoek-10).
 */
export function mapQueryOf(state: Pick<ForecastState, 'selection' | 'mode'>): string {
  const params = new URLSearchParams();
  if (state.mode !== 'auto') params.set('v', state.mode);
  setWhenParams(params, whenParamsOf(state));
  return params.toString().replace(/%3A/g, ':');
}

/** Writes `?v=` / `?t=` / `?dag=` back to the address bar so the page state can be shared. */
function syncPageUrl(state: ForecastState): void {
  const params = new URLSearchParams(window.location.search);
  if (state.mode === 'auto') params.delete('v');
  else params.set('v', state.mode);
  setWhenParams(params, whenParamsOf(state));
  const qs = params.toString().replace(/%3A/g, ':');
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(null, '', next);
}

/**
 * The feature the entity map draws: the item plus its verdict level for the paint expressions.
 * Uses the same inputs as the list (timeline, and the day window when a day is picked), so the map
 * and the list next to it never disagree about the same item.
 */
function judged(items: readonly ForecastItem[], mode: VehicleMode, at: number, window?: { from: number; to: number }): ItemFeature[] {
  return items.map((it) => ({
    ...it.f,
    properties: {
      ...it.f.properties,
      v: verdictFor(it.f.properties, mode, {
        periods: it.d?.periods ?? null,
        ...(it.d?.tl ? { tl: it.d.tl } : {}),
        ...(it.d?.tlTo ? { tlTo: it.d.tlTo } : {}),
        ...(window ? { window } : { now: at }),
      }).level,
    } as ItemFeature['properties'],
  }));
}

/**
 * Wires counters, summary, forecast block, list and map of an entity page around one source.
 * Returns once the initial render is done; the map keeps loading in the background.
 */
export async function runEntityPage(opts: EntityPageOptions): Promise<void> {
  const { source, listEl } = opts;
  const now = Date.now();
  const rows = source.items.map((it) => indexItemFromFeature(it.f));
  const { active, upcoming } = splitForEntity(rows, now);
  const details = detailsOf(source);

  setText('entity-count-active', formatCount(active.length));
  setText('entity-count-upcoming', formatCount(upcoming.length));
  setText('entity-summary', summaryText(active, upcoming));
  setEmptyVisible('entity-empty', active.length === 0 && upcoming.length === 0);

  let map: EntityMap | null = null;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const renderList = (state: ForecastState): void => {
    if (!listEl) return;
    const listOpts = {
      mode: state.mode,
      at: state.at,
      ...(state.window ? { window: state.window } : {}),
      details,
      revealClosures: true,
      ...(opts.linkQuery ? { linkQuery: opts.linkQuery } : {}),
      mapQuery: mapQueryOf(state),
    };
    if (state.items === null) {
      const relevant = (list: IndexItem[]): IndexItem[] => list.filter((it) => isRelevantFor(it, state.mode));
      // "Nu actief" leads with the heaviest pill (impact order within a level): by impact alone
      // three "Doorrijden mogelijk" incidents stood above the "Rijbaan dicht" at Gorinchem.
      // "Gepland" keeps its start order, as its heading promises.
      const sections: EntitySection[] = [
        { title: 'Nu actief', items: sortByVerdict(relevant(active), now, listOpts) },
        { title: 'Gepland (komende 30 dagen)', items: relevant(upcoming) },
      ];
      const hidden = active.length + upcoming.length - sections.reduce((n, s) => n + s.items.length, 0);
      if (hidden > 0) {
        const others = [...active, ...upcoming].filter((it) => !isRelevantFor(it, state.mode));
        sections.push({ title: 'Geldt niet voor jou', items: others, collapsed: true, note: `Deze ${hidden === 1 ? 'melding geldt' : 'meldingen gelden'} alleen voor ander verkeer (bijvoorbeeld een fietspad).` });
      }
      renderEntityList(listEl, sections, now, listOpts);
      return;
    }
    const listed = state.items.map((it) => byId.get(it.f.properties.id)).filter((it): it is IndexItem => it !== undefined);
    const title =
      state.selection.kind === 'day'
        ? `Op ${state.whenLabel === 'vandaag' || state.whenLabel === 'morgen' ? state.whenLabel : fmtDay(state.selection.cell.from)}`
        : `Op ${state.whenLabel}`;
    renderEntityList(listEl, [{ title, items: listed }], now, listOpts);
    if (listed.length === 0) {
      listEl.innerHTML = `<p class="entity-list__notice" role="status">Niets gemeld ${title.toLowerCase()} voor ${state.mode === 'auto' ? "auto's" : state.mode === 'vracht' ? 'vrachtverkeer' : 'fietsers'}.</p>`;
    }
  };

  const onState = (state: ForecastState): void => {
    storeMode(state.mode);
    renderList(state);
    map?.setItems(judged(source.items, state.mode, state.at, state.window));
    syncPageUrl(state);
  };

  let state: ForecastState = {
    mode: initialMode(opts.url),
    selection: opts.url.moment ? { kind: 'moment', at: opts.url.moment } : { kind: 'all' },
    at: opts.url.moment ?? now,
    items: null,
    whenLabel: 'nu',
  };

  if (opts.forecastEl) {
    const block = mountForecastBlock(opts.forecastEl, {
      items: source.items,
      subject: opts.subject,
      roadType: opts.roadType ?? null,
      mode: state.mode,
      moment: opts.url.moment,
      day: opts.url.day ? { date: opts.url.day, part: opts.url.part } : null,
      ...(opts.dataAsOf ? { dataAsOf: opts.dataAsOf } : {}),
      onChange: onState,
    });
    state = block.getState();
  }
  renderList(state);

  map = await mountPageMap(judged(source.items, state.mode, state.at), opts.view);
  if (map && !source.fromEntityFile) {
    // The index only knows a point per measure; the real line geometry arrives afterwards.
    const live = source.items.map((it) => it.f).filter((f) => f.geometry.type !== 'Point');
    void upgradeMapGeometry(map, rows, { geometry: live });
  }
}
