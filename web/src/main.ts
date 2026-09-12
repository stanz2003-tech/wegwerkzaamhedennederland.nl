/**
 * App entry: wires the map, the panel (search, filters, list, detail) and the top bar.
 *
 * Flow: URL state → map (PDOK basemap with fallbacks) → meta + werk-actueel + live → layers →
 * filters/list → detail on select. `werk-gepland.geojson` is loaded lazily the first time a
 * time window beyond "Nu" is chosen; `live.geojson` + `meta.json` refresh every 90 s while the
 * document is visible. URL state is written back debounced (replaceState).
 */
import './styles/base.css';
import './styles/components.css';
import './styles/chrome.css';
// map.css + the MapLibre stylesheet come in via src/map/map.ts.
import './styles/panel.css';
import './styles/app.css';

import site from '../site.config.json';
import { clearDetailCache, loadDetail } from './data/detail';
import {
  bboxIntersects,
  bboxOf,
  countByCategory,
  dedupeById,
  filterItems,
  midpointOf,
  sortItems,
  type BBox,
  type SortId,
} from './data/filter';
import { loadIndexAll, rowsToItems, type IndexItem } from './data/index';
import { DataLoadError, loadGepland, loadLiveRefresh, loadStartData } from './data/load';
import { DEFAULT_TIME_WINDOW, TIME_WINDOWS, isActiveAt, toMs } from './data/time';
import type { Category, ItemDetail, ItemFeature, Meta } from './data/types';
import { itemDeepLink, readUrlState, writeUrlState, type UrlState } from './data/url-state';
import { AppMap, NL_BOUNDS, NL_CENTER, NL_ZOOM } from './map/map';
import { wireCmpLinks } from './ui/ads';
import { mountAnalytics } from './ui/analytics';
import { mountCategoryChips, mountTimeChips } from './ui/chips';
import { mountSortSelect, mountSwitch } from './ui/controls';
import { renderDetail } from './ui/detail';
import { esc, fmtTime, formatCount, plural } from './ui/format';
import { ICONS } from './ui/icons';
import { mountList } from './ui/list';
import { modelFromProps } from './ui/list-item';
import { mountPanel } from './ui/panel';
import { mountSearch } from './ui/search';
import { currentTheme, onThemeChange, prefersReducedMotion } from './ui/theme';
import { showToast } from './ui/toast';
import { liveStatusFromMeta, mountTopbar } from './ui/topbar';

const REFRESH_MS = 90_000;
/** Upper bound on list models; the list itself renders in batches of 40. */
const LIST_MAX = 800;
const DESKTOP_PANEL_PAD = 420;

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Element ${selector} ontbreekt in de pagina`);
  return node;
}

/* ------------------------------------------------------------------ state */

const reducedMotion = prefersReducedMotion();
let url: UrlState = readUrlState();
let sort: SortId = 'impact';
let onlyInView = false;
let actueel: ItemFeature[] = [];
let live: ItemFeature[] = [];
let gepland: ItemFeature[] = [];
let geplandLoad: Promise<void> | null = null;
let meta: Meta | null = null;
let byId = new Map<string, ItemFeature>();
let selected: ItemFeature | null = null;
let detailData: ItemDetail | null = null;
let detailError = false;
let lastRefresh = 0;
let dataOk = false;
let map: AppMap | null = null;
let localItems: Promise<readonly IndexItem[]> | null = null;

/* ------------------------------------------------------------------ chrome */

const topbar = mountTopbar();
topbar.setLive({ kind: 'loading' });
mountAnalytics();
wireCmpLinks(() => showToast('Er worden nu geen advertenties of advertentiecookies gebruikt.'));

const stageEl = el<HTMLElement>('[data-stage]');
const mapEl = el<HTMLElement>('[data-map]');
const mapErrorEl = el<HTMLElement>('[data-map-error]');
const panelEl = el<HTMLElement>('[data-panel]');
const handleEl = el<HTMLElement>('[data-sheet-handle]');
const listEl = el<HTMLElement>('[data-list]');
const detailEl = el<HTMLElement>('[data-detail]');
const summaryEl = el<HTMLElement>('[data-summary]');

/* ------------------------------------------------------------------ helpers */

function catSet(): Set<Category> | null {
  return url.cats ? new Set(url.cats) : null;
}

function needsGepland(): boolean {
  return url.time !== 'nu';
}

function allItems(): ItemFeature[] {
  return dedupeById(needsGepland() ? [...live, ...actueel, ...gepland] : [...live, ...actueel]);
}

function mapBounds(): BBox | null {
  return map ? map.getBBox() : null;
}

function timeLabel(): string {
  return (TIME_WINDOWS.find((w) => w.id === url.time)?.label ?? '').toLowerCase();
}

function syncUrl(): void {
  if (map) {
    url = { ...url, zoom: map.getZoom(), center: map.getCenter() };
  }
  writeUrlState(url);
}

/** Camera padding so `fitBounds` keeps the feature clear of the panel / sheet. */
function updatePadding(): void {
  if (!map) return;
  const mobile = panel.isMobile();
  map.setPadding({
    top: 24,
    right: 24,
    bottom: mobile ? Math.min(panel.coveredPx() + 16, Math.round(stageEl.clientHeight * 0.6)) : 24,
    left: mobile ? 24 : DESKTOP_PANEL_PAD,
  });
}

/* ------------------------------------------------------------------ rendering */

function renderSummary(total: number, shown: number): void {
  const parts = [plural(total, 'melding', 'meldingen'), timeLabel()];
  if (onlyInView) parts.push('in beeld');
  summaryEl.textContent = parts.join(' · ');
  summaryEl.title =
    shown < total
      ? `${parts.join(' · ')} — de eerste ${formatCount(shown)} staan in de lijst; zoom in of filter om te verfijnen.`
      : parts.join(' · ');
}

/** Signature of the dataset handed to the map, so panning does not re-upload the GeoJSON. */
let lastMapKey = '';

function render(): void {
  const now = Date.now();
  const items = allItems();
  const bounds = onlyInView ? mapBounds() : null;
  const cats = catSet();

  // Counts ignore the category filter (so a chip shows what turning it on would give you).
  const forCounts = filterItems(items, { cats: null, time: url.time, query: url.query, bounds }, now);
  chips.setCounts(countByCategory(forCounts));

  // The map always shows every category-matching item; "alleen in beeld" only trims the list.
  const forMap = filterItems(items, { cats, time: url.time, query: url.query, bounds: null }, now);
  const mapKey = `${url.time}|${url.cats?.join(',') ?? '*'}|${url.query}|${forMap.length}|${items.length}`;
  if (mapKey !== lastMapKey) {
    lastMapKey = mapKey;
    map?.setItems(forMap);
    map?.setSelected(selected?.properties.id ?? null);
  }

  const forList = bounds ? forMap.filter((f) => bboxIntersects(bboxOf(f.geometry) ?? bounds, bounds)) : forMap;
  const ordered = sortItems(forList, sort, map?.getCenter() ?? null);
  const models = ordered.slice(0, LIST_MAX).map((f) => modelFromProps(f.properties));
  list.setItems(models, now, selected?.properties.id ?? null);
  renderSummary(ordered.length, models.length);
}

function renderHomeCounts(m: Meta): void {
  let total = 0;
  for (const [cat, n] of Object.entries(m.counts)) {
    total += n;
    const node = document.querySelector<HTMLElement>(`[data-home-count="${cat}"]`);
    if (node) node.textContent = formatCount(n);
  }
  const updated = document.querySelector<HTMLElement>('[data-home-updated]');
  if (updated) {
    updated.textContent = `Bijgewerkt om ${fmtTime(toMs(m.generated))} · ${plural(total, 'actieve melding', 'actieve meldingen')} in Nederland.`;
  }
}

function showFatal(message: string): void {
  mapErrorEl.hidden = false;
  mapErrorEl.classList.add('is-visible');
  mapErrorEl.setAttribute('role', 'alert');
  mapErrorEl.innerHTML = `<p class="map__notice-title">De gegevens konden niet worden geladen.</p>
    <p>${esc(message)}</p>
    <button type="button" class="btn btn--primary" data-retry>${ICONS.refreshCw}<span>Opnieuw proberen</span></button>`;
  mapErrorEl.querySelector('[data-retry]')?.addEventListener('click', () => void start(true));
  list.setError(message);
  topbar.setLive({ kind: 'error' });
}

function clearFatal(): void {
  mapErrorEl.hidden = true;
  mapErrorEl.classList.remove('is-visible');
  mapErrorEl.removeAttribute('role');
  mapErrorEl.innerHTML = '';
}

/* ------------------------------------------------------------------ detail view */

function showList(): void {
  detailEl.hidden = true;
  listEl.hidden = false;
}

function paintDetail(): void {
  if (!selected) return;
  detailEl.hidden = false;
  listEl.hidden = true;
  renderDetail(
    detailEl,
    {
      props: selected.properties,
      center: midpointOf(selected.geometry),
      detail: detailData,
      loading: detailData === null && !detailError,
      error: detailError,
    },
    Date.now(),
    {
      onBack: () => selectItem(null),
      onShare: () => void share(),
      onRetry: () => void loadDetailFor(selected),
    },
  );
  detailEl.querySelector<HTMLElement>('[data-back]')?.focus();
}

async function share(): Promise<void> {
  if (!selected) return;
  const link = itemDeepLink(selected.properties.id);
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link gekopieerd naar het klembord.');
  } catch {
    showToast('Kopiëren lukte niet. De link staat in de adresbalk.', 'error');
  }
}

async function loadDetailFor(feature: ItemFeature | null): Promise<void> {
  if (!feature) return;
  const id = feature.properties.id;
  detailData = null;
  detailError = false;
  paintDetail();
  try {
    const d = await loadDetail(id);
    if (selected?.properties.id !== id) return;
    detailData = d;
    detailError = d === null;
  } catch {
    if (selected?.properties.id !== id) return;
    detailError = true;
  }
  paintDetail();
}

/** Selects an item (or clears the selection) and updates map, URL and panel. */
function selectItem(id: string | null, fly = true): void {
  const previous = selected?.properties.id ?? null;
  const feature = id ? (byId.get(id) ?? null) : null;
  selected = feature;
  url = { ...url, id: feature ? feature.properties.id : null };
  map?.setSelected(feature ? feature.properties.id : null);
  list.setSelected(feature ? feature.properties.id : null);
  if (!feature) {
    showList();
    detailData = null;
    detailError = false;
    syncUrl();
    list.focusItem(previous);
    return;
  }
  panel.ensureAtLeast('half');
  updatePadding();
  if (fly) map?.fitToFeature(feature);
  void loadDetailFor(feature);
  syncUrl();
}

/* ------------------------------------------------------------------ UI mounts */

const panel = mountPanel(panelEl, handleEl, stageEl);
panel.onChange(() => {
  updatePadding();
  map?.resize();
});

const list = mountList(listEl, {
  onSelect: (id) => selectItem(id),
  onHover: (id) => map?.setHover(id),
  onReset: () => {
    url = { ...url, cats: null, time: DEFAULT_TIME_WINDOW, query: '' };
    onlyInView = false;
    chips.setSelected(null);
    times.setSelected(DEFAULT_TIME_WINDOW);
    inView.set(false);
    search.setQuery('');
    render();
    syncUrl();
  },
  onRetry: () => void start(true),
});

const chips = mountCategoryChips(el<HTMLElement>('[data-cats]'), (cats) => {
  url = { ...url, cats: cats ? [...cats] : null };
  render();
  syncUrl();
});

const times = mountTimeChips(el<HTMLElement>('[data-times]'), url.time, (id) => {
  url = { ...url, time: id };
  if (needsGepland()) void ensureGepland();
  render();
  syncUrl();
});

const inView = mountSwitch(el<HTMLElement>('[data-inview]'), 'Alleen in beeld', false, (on) => {
  onlyInView = on;
  render();
});

const sortSelect = mountSortSelect(el<HTMLElement>('[data-sort]'), sort, (id) => {
  sort = id;
  render();
});

const search = mountSearch(el<HTMLElement>('[data-search]'), {
  localItems: () => {
    if (!localItems) {
      localItems = loadIndexAll()
        .then((f) => rowsToItems(f.rows))
        .catch(() => {
          localItems = null;
          return [] as readonly IndexItem[];
        });
    }
    return localItems;
  },
  onPickItem: (hit) => {
    if (byId.has(hit.id)) {
      selectItem(hit.id);
      return;
    }
    void resolveDeepLink(hit.id);
  },
  onPickPlace: (loc, zoom) => {
    if (loc.bbox) map?.fitBBox(loc.bbox, zoom);
    else map?.flyTo(loc.center, zoom);
    panel.snap('peek');
  },
  onQuery: (q) => {
    url = { ...url, query: q };
    render();
    syncUrl();
  },
  onFocus: () => panel.ensureAtLeast('half'),
});

search.setQuery(url.query);
sortSelect.set(sort);
chips.setSelected(catSet());

/* ------------------------------------------------------------------ data */

async function ensureGepland(): Promise<void> {
  if (geplandLoad) return geplandLoad;
  geplandLoad = loadGepland()
    .then((items) => {
      gepland = items;
      index();
      render();
    })
    .catch(() => {
      geplandLoad = null;
      showToast('De geplande werkzaamheden konden niet worden geladen.', 'error');
    });
  return geplandLoad;
}

function index(): void {
  byId = new Map(allItems().map((f) => [f.properties.id, f]));
}

/** Loads the item behind `?id=` even when it is not in the active set. */
async function resolveDeepLink(id: string): Promise<void> {
  if (!byId.has(id) && !geplandLoad) await ensureGepland();
  const feature = byId.get(id);
  if (!feature) {
    showToast('Deze melding staat niet meer in de actuele gegevens.', 'error');
    url = { ...url, id: null };
    syncUrl();
    return;
  }
  ensureItemVisible(feature);
  selectItem(id);
}

/** Relaxes the filters so a deep-linked item is actually on the map. */
function ensureItemVisible(feature: ItemFeature): void {
  const now = Date.now();
  if (!isActiveAt(feature.properties, now) && url.time === 'nu') {
    url = { ...url, time: '30d' };
    times.setSelected('30d');
  }
  const cats = catSet();
  if (cats && !cats.has(feature.properties.cat)) {
    url = { ...url, cats: null };
    chips.setSelected(null);
  }
  if (onlyInView) {
    onlyInView = false;
    inView.set(false);
  }
  render();
}

async function start(retry = false): Promise<void> {
  if (retry) {
    clearFatal();
    list.setLoading();
    topbar.setLive({ kind: 'loading' });
  }
  try {
    const data = await loadStartData();
    dataOk = true;
    meta = data.meta;
    actueel = data.actueel;
    live = data.live;
    lastRefresh = Date.now();
    index();
    clearFatal();
    topbar.setLive(liveStatusFromMeta(data.meta));
    topbar.setCounts(data.meta.counts);
    renderHomeCounts(data.meta);
    if (needsGepland()) void ensureGepland();
    render();
    for (const warning of data.warnings) {
      showToast(`Onderdeel niet geladen: ${warning}`, 'error');
    }
    if (url.id) void resolveDeepLink(url.id);
  } catch (err) {
    dataOk = false;
    const message = err instanceof DataLoadError ? err.message : err instanceof Error ? err.message : 'Onbekende fout';
    showFatal(message);
  }
}

async function refresh(): Promise<void> {
  if (document.visibilityState !== 'visible') return;
  try {
    const next = await loadLiveRefresh();
    meta = next.meta;
    live = next.live;
    lastRefresh = Date.now();
    clearDetailCache();
    index();
    topbar.setLive(liveStatusFromMeta(next.meta));
    topbar.setCounts(next.meta.counts);
    renderHomeCounts(next.meta);
    render();
    if (selected && !byId.has(selected.properties.id)) selectItem(null);
  } catch {
    if (meta) topbar.setLive({ kind: 'stale', generated: meta.generated });
  }
}

/* ------------------------------------------------------------------ boot */

async function boot(): Promise<void> {
  list.setLoading();
  // Data and basemap load in parallel: the list must never wait for PDOK.
  const data = start();
  map = await AppMap.create({
    container: mapEl,
    theme: currentTheme(),
    center: url.center ?? NL_CENTER,
    zoom: url.zoom ?? NL_ZOOM,
    attribution: site.attribution,
    reducedMotion,
    callbacks: {
      onSelect: (id) => selectItem(id, false),
      onHover: () => undefined,
      onMoveEnd: () => {
        if (onlyInView) render();
        syncUrl();
      },
      onBasemap: (kind) => {
        if (kind === 'openfreemap' || kind === 'raster') {
          showToast('De achtergrondkaart van het Kadaster is niet beschikbaar; we gebruiken een alternatief.');
        }
      },
    },
  });
  if (!map) {
    stageEl.dataset.noWebgl = '1';
    showToast('Deze browser kan de interactieve kaart niet tonen. De lijst werkt gewoon.', 'error');
  }
  updatePadding();
  // Without a camera in the URL, frame the country in the part of the stage the panel leaves
  // free. On desktop that is the default zoom re-centred next to the panel (the BRT tiles only
  // carry water and terrain fills from zoom 7, so we do not zoom out below it); on a phone the
  // sheet covers half the stage, so there we fit the whole country into what is left.
  if (map && url.center === null && url.zoom === null) {
    if (panel.isMobile()) map.fitBBox(NL_BOUNDS, 9);
    else map.flyTo(NL_CENTER, NL_ZOOM);
  }
  onThemeChange((theme) => void map?.setTheme(theme));
  await data;
  // Only re-render when the data actually arrived: after a failure the list must keep the
  // error banner with its retry button instead of falling back to the empty state.
  if (map && dataOk) {
    // The first render may have run without a map; push the data into the new sources.
    lastMapKey = '';
    render();
    if (selected) map.fitToFeature(selected);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (selected) {
    e.preventDefault();
    selectItem(null);
    return;
  }
  if (panel.isMobile() && panel.getSnap() !== 'peek') {
    e.preventDefault();
    panel.snap('peek');
  }
});

window.setInterval(() => void refresh(), REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRefresh > REFRESH_MS) void refresh();
});
window.addEventListener('popstate', () => {
  const next = readUrlState();
  url = { ...next, zoom: url.zoom, center: url.center };
  times.setSelected(url.time);
  chips.setSelected(catSet());
  search.setQuery(url.query);
  render();
  if (next.id) void resolveDeepLink(next.id);
  else if (selected) selectItem(null);
});

void boot();
