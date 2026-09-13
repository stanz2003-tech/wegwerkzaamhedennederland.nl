/**
 * App entry: wires the map, the panel (vehicle mode, search, filters, "Wanneer?", answer card,
 * list, detail) and the top bar around ONE question: "Kan ik erdoor?"
 *
 * Every filter is strict and shared — whatever the list shows is exactly what the map shows:
 * category chips, vehicle relevance, road mode (`?weg=a27`) and the chosen moment. Outside road
 * mode the list follows the map viewport. The verdict for the chosen vehicle mode colours the
 * map, leads every list row and the detail, and is summarised in one sentence above the list
 * (in road mode: the answer card).
 *
 * Flow: URL state → map (PDOK basemap with fallbacks) → meta + werk-actueel + live → layers →
 * filters/list → detail on select. `werk-gepland.geojson` is loaded lazily the first time a
 * window beyond "Nu" or a future moment is chosen; `live.geojson` + `meta.json` refresh every
 * 90 s while the document is visible. URL state is written back debounced (replaceState).
 */
import './styles/base.css';
import './styles/components.css';
import './styles/chrome.css';
// map.css + the MapLibre stylesheet come in via src/map/map.ts.
import './styles/panel.css';
import './styles/app.css';

import site from '../site.config.json';
import { answerFor, areaSentence, hiddenSentence, type Answer } from './data/answer';
import { clearDetailCache, loadDetail } from './data/detail';
import { matchesRoad } from './data/entity';
import { bboxIntersects, bboxOf, countByCategory, dedupeById, matchesQuery, midpointOf, sortItems, type BBox, type SortId } from './data/filter';
import { liveAppliesAt, type ForecastItem, type When } from './data/forecast';
import { loadIndexAll, rowsToItems, type IndexItem } from './data/index';
import { DataLoadError, loadGepland, loadLiveRefresh, loadStartData } from './data/load';
import { DEFAULT_TIME_WINDOW, TIME_WINDOWS, isActiveAt, matchesTimeWindow, timeWindowRange, toMs } from './data/time';
import type { Category, ItemDetail, ItemFeature, Meta } from './data/types';
import { itemDeepLink, normalizeRoadParam, readStoredMode, readUrlState, storeMode, writeUrlState, type UrlState } from './data/url-state';
import { VERDICT_SEVERITY, modeNoun, verdictFor, type VehicleMode, type VerdictLevel } from './data/verdict';
import { AppMap, NL_BOUNDS, NL_CENTER, NL_ZOOM } from './map/map';
import { wireCmpLinks } from './ui/ads';
import { mountAnalytics } from './ui/analytics';
import { renderAnswerCard } from './ui/answer-card';
import { mountCategoryChips } from './ui/chips';
import { mountSortSelect, mountSwitch } from './ui/controls';
import { renderDetail } from './ui/detail';
import { esc, fmtDayTime, fmtTime, formatCount, plural } from './ui/format';
import { ICONS } from './ui/icons';
import { mountLegend } from './ui/legend';
import { mountList } from './ui/list';
import { modelFromProps } from './ui/list-item';
import { mountModeSelect } from './ui/mode-select';
import { mountPanel } from './ui/panel';
import { mountSearch } from './ui/search';
import { currentTheme, onThemeChange, prefersReducedMotion } from './ui/theme';
import { showToast } from './ui/toast';
import { liveStatusFromMeta, mountTopbar } from './ui/topbar';
import { mountWhenControl } from './ui/when-control';

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
// The vehicle mode sticks across visits unless the URL says otherwise.
if (!window.location.search.includes('v=')) {
  const stored = readStoredMode();
  if (stored) url = { ...url, mode: stored };
}
let sort: SortId = 'impact';
/** "Alleen relevant voor …": hide the items that do not apply to the vehicle mode. */
let hideNvt = true;
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
/** Set when road mode was entered before the map/data were ready: fit once they are. */
let pendingRoadFit = false;

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
const answerEl = el<HTMLElement>('[data-answer]');
const hiddenBtn = el<HTMLButtonElement>('[data-hidden]');

/* ------------------------------------------------------------------ helpers */

function catSet(): Set<Category> | null {
  return url.cats ? new Set(url.cats) : null;
}

function needsGepland(now = Date.now()): boolean {
  if (url.moment !== null) return url.moment > now;
  return url.time !== 'nu';
}

function allItems(): ItemFeature[] {
  return dedupeById(needsGepland() ? [...live, ...actueel, ...gepland] : [...live, ...actueel]);
}

function mapBounds(): BBox | null {
  return map ? map.getBBox() : null;
}

/** The moment every verdict is computed for. */
function momentAt(now: number): number {
  return url.moment ?? now;
}

/** The "Wanneer?" choice as the answer module sees it. */
function whenFor(now: number): When {
  if (url.moment !== null) return { kind: 'moment', at: url.moment };
  if (url.time === 'nu') return { kind: 'moment', at: now };
  const { from, to } = timeWindowRange(url.time, now);
  return { kind: 'window', from, to };
}

function whenLabel(): string {
  if (url.moment !== null) return fmtDayTime(url.moment);
  return (TIME_WINDOWS.find((w) => w.id === url.time)?.label ?? 'nu').toLowerCase();
}

function inTime(p: ItemFeature['properties'], now: number): boolean {
  if (url.moment !== null) return isActiveAt(p, url.moment) && liveAppliesAt(p, url.moment, now);
  return matchesTimeWindow(p, url.time, now);
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

interface Judged {
  f: ItemFeature;
  level: VerdictLevel;
}

/** Verdict level per feature for the current mode and moment (no detail loaded here). */
function judge(features: readonly ItemFeature[], mode: VehicleMode, at: number): Judged[] {
  return features.map((f) => ({ f, level: verdictFor(f.properties, mode, { now: at }).level }));
}

/** The feature the map draws: the item plus its verdict level (`v`) for the paint expressions. */
function withVerdict(j: Judged): ItemFeature {
  return { ...j.f, properties: { ...j.f.properties, v: j.level } as ItemFeature['properties'] };
}

function asForecast(features: readonly ItemFeature[]): ForecastItem[] {
  return features.map((f) => ({ f, d: null }));
}

function renderAnswer(roadItems: readonly ItemFeature[], now: number): void {
  const road = url.road;
  if (!road) {
    answerEl.hidden = true;
    answerEl.innerHTML = '';
    panelEl.classList.remove('is-road');
    return;
  }
  const answer: Answer = answerFor(asForecast(roadItems), url.mode, whenFor(now), { kind: 'road', name: road }, now);
  const sample = roadItems.find((f) => f.properties.roadType);
  answerEl.hidden = false;
  panelEl.classList.add('is-road');
  answerEl.innerHTML = renderAnswerCard({
    road,
    roadType: sample?.properties.roadType ?? null,
    whenLabel: whenLabel(),
    mode: url.mode,
    answer,
    total: roadItems.length,
  });
  answerEl.querySelector('[data-road-exit]')?.addEventListener('click', () => exitRoad());
}

function renderSummary(inView: readonly ItemFeature[], now: number, shown: number, total: number): void {
  const answer = answerFor(asForecast(inView), url.mode, whenFor(now), { kind: 'gebied', name: '' }, now);
  const text = url.road ? `${plural(total, 'melding', 'meldingen')} op de ${url.road} · ${whenLabel()}` : areaSentence(answer, url.mode, !hideNvt);
  summaryEl.textContent = text;
  summaryEl.title = shown < total ? `${text} — de eerste ${formatCount(shown)} staan in de lijst; zoom in of filter om te verfijnen.` : text;
  const hidden = answer.hidden.length;
  if (hideNvt && hidden > 0) {
    hiddenBtn.hidden = false;
    hiddenBtn.textContent = hiddenSentence(answer.hidden, url.mode);
    hiddenBtn.title = 'Toon deze meldingen toch (vervaagd op de kaart)';
  } else {
    hiddenBtn.hidden = true;
  }
}

/** Signature of the dataset handed to the map, so panning does not re-upload the GeoJSON. */
let lastMapKey = '';

function render(): void {
  const now = Date.now();
  const at = momentAt(now);
  const items = allItems();
  const cats = catSet();

  // 1. time (moment or window), 2. road mode, 3. free text.
  let base = items.filter((f) => inTime(f.properties, now));
  const roadAll = url.road ? items.filter((f) => matchesRoad(f.properties.road, url.road ?? '')) : items;
  if (url.road) base = base.filter((f) => matchesRoad(f.properties.road, url.road ?? ''));
  if (url.query) base = base.filter((f) => matchesQuery(f.properties, url.query));

  // 4. vehicle relevance (the verdict decides), 5. categories.
  const judged = judge(base, url.mode, at);
  const relevant = hideNvt ? judged.filter((j) => j.level !== 'nvt') : judged;
  chips.setCounts(countByCategory(relevant.map((j) => j.f)));
  const forMap = cats ? relevant.filter((j) => cats.has(j.f.properties.cat)) : relevant;

  const mapKey = `${at}|${url.time}|${url.cats?.join(',') ?? '*'}|${url.query}|${url.mode}|${hideNvt}|${url.road ?? ''}|${forMap.length}|${items.length}`;
  if (mapKey !== lastMapKey) {
    lastMapKey = mapKey;
    map?.setItems(forMap.map(withVerdict));
    map?.setSelected(selected?.properties.id ?? null);
  }

  // Outside road mode the list follows the viewport; in road mode it is the whole road.
  const bounds = url.road ? null : mapBounds();
  const inView = bounds ? forMap.filter((j) => bboxIntersects(bboxOf(j.f.geometry) ?? bounds, bounds)) : forMap;
  const ordered = sortItems(
    inView.map((j) => j.f),
    sort,
    map?.getCenter() ?? null,
    now,
  );
  // "Impact" answers the one question first: every "weg dicht" above every "doorrijden
  // mogelijk", whatever the DATEX severity says; within a level the impact score decides.
  if (sort === 'impact') {
    const levelOf = new Map(inView.map((j) => [j.f.properties.id, VERDICT_SEVERITY.indexOf(j.level)]));
    ordered.sort((a, b) => (levelOf.get(a.properties.id) ?? 9) - (levelOf.get(b.properties.id) ?? 9));
  }
  const models = ordered.slice(0, LIST_MAX).map((f) => modelFromProps(f.properties));
  list.setItems(models, now, selected?.properties.id ?? null, { mode: url.mode, at });

  // The sentence above the list counts what is in view including the items the relevance
  // switch hides, so it can say how many were hidden and for whom.
  const inViewAll = (cats ? judged.filter((j) => cats.has(j.f.properties.cat)) : judged).filter(
    (j) => !bounds || bboxIntersects(bboxOf(j.f.geometry) ?? bounds, bounds),
  );
  renderSummary(
    inViewAll.map((j) => j.f),
    now,
    models.length,
    ordered.length,
  );
  renderAnswer(cats ? roadAll.filter((f) => cats.has(f.properties.cat)) : roadAll, now);

  if (pendingRoadFit && map && url.road && forMap.length > 0) {
    pendingRoadFit = false;
    map.fitToFeatures(forMap.map((j) => j.f));
  }
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

/* ------------------------------------------------------------------ road mode */

function enterRoad(road: string, fit = true): void {
  const key = normalizeRoadParam(road) ?? road.trim().toUpperCase();
  if (!key) return;
  url = { ...url, road: key, query: '' };
  search.setQuery(key);
  if (selected) selectItem(null, false);
  pendingRoadFit = fit;
  render();
  panel.ensureAtLeast('half');
  syncUrl();
  answerEl.querySelector<HTMLElement>('.answer__headline')?.focus();
}

function exitRoad(): void {
  url = { ...url, road: null };
  search.setQuery('');
  pendingRoadFit = false;
  render();
  syncUrl();
  search.focus();
}

/* ------------------------------------------------------------------ detail view */

function showList(): void {
  detailEl.hidden = true;
  listEl.hidden = false;
}

/** The detour polyline of the open detail, when the wegbeheerder published one. */
function currentDetour(): [number, number][] | null {
  const g = detailData?.detourGeom;
  return g && g.length >= 2 ? g : null;
}

function paintDetail(): void {
  if (!selected) return;
  detailEl.hidden = false;
  listEl.hidden = true;
  const now = Date.now();
  renderDetail(
    detailEl,
    {
      props: selected.properties,
      center: midpointOf(selected.geometry),
      detail: detailData,
      loading: detailData === null && !detailError,
      error: detailError,
      mode: url.mode,
      at: momentAt(now),
    },
    now,
    {
      onBack: () => selectItem(null),
      onShare: () => void share(),
      onRetry: () => void loadDetailFor(selected),
      onRoad: (road) => enterRoad(road),
    },
  );
  detailEl.querySelector<HTMLElement>('[data-back]')?.focus();
  map?.setDetour(currentDetour());
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
    map?.setDetour(null);
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

const modeSelect = mountModeSelect(el<HTMLElement>('[data-mode]'), url.mode, (mode) => {
  url = { ...url, mode };
  storeMode(mode);
  relevance.setLabel(`Alleen relevant voor ${modeNoun(mode)}`);
  render();
  if (selected) paintDetail();
  syncUrl();
});

const list = mountList(listEl, {
  onSelect: (id) => selectItem(id),
  onHover: (id) => map?.setHover(id),
  onReset: () => {
    url = { ...url, cats: null, time: DEFAULT_TIME_WINDOW, moment: null, query: '', road: null };
    hideNvt = true;
    chips.setSelected(null);
    when.setSelected(DEFAULT_TIME_WINDOW);
    when.setMoment(null);
    relevance.set(true);
    search.setQuery('');
    render();
    syncUrl();
  },
  onRetry: () => void start(true),
  onRoad: (road) => enterRoad(road),
});

const chips = mountCategoryChips(el<HTMLElement>('[data-cats]'), (cats) => {
  url = { ...url, cats: cats ? [...cats] : null };
  render();
  syncUrl();
});

const when = mountWhenControl(
  el<HTMLElement>('[data-when]'),
  { time: url.time, moment: url.moment },
  {
    onChange: (id) => {
      url = { ...url, time: id, moment: null };
      if (needsGepland()) void ensureGepland();
      render();
      if (selected) paintDetail();
      syncUrl();
    },
    onMoment: (ms) => {
      url = { ...url, moment: ms };
      if (needsGepland()) void ensureGepland();
      render();
      if (selected) paintDetail();
      syncUrl();
    },
  },
);

const relevance = mountSwitch(el<HTMLElement>('[data-relevant]'), `Alleen relevant voor ${modeNoun(url.mode)}`, true, (on) => {
  hideNvt = on;
  render();
});

hiddenBtn.addEventListener('click', () => {
  hideNvt = false;
  relevance.set(false);
  render();
});

const sortSelect = mountSortSelect(el<HTMLElement>('[data-sort]'), sort, (id) => {
  sort = id;
  render();
});

mountLegend(el<HTMLElement>('[data-legend]'));

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
    if (url.road) exitRoad();
    if (loc.bbox) map?.fitBBox(loc.bbox, zoom);
    else map?.flyTo(loc.center, zoom);
    panel.snap('peek');
  },
  onPickRoad: (road) => enterRoad(road),
  onQuery: (q) => {
    if (url.road && q === '') {
      exitRoad();
      return;
    }
    url = { ...url, query: q };
    render();
    syncUrl();
  },
  onFocus: () => panel.ensureAtLeast('half'),
});

search.setQuery(url.road ?? url.query);
sortSelect.set(sort);
chips.setSelected(catSet());
modeSelect.set(url.mode);

/* ------------------------------------------------------------------ scroll to #uitleg */

function scrollToUitleg(): void {
  const target = document.getElementById('uitleg');
  if (!target) return;
  target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  target.querySelector<HTMLElement>('h2, h1')?.focus({ preventScroll: true });
}

document.querySelectorAll<HTMLElement>('[data-scroll-uitleg]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    scrollToUitleg();
  });
});

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
  const p = feature.properties;
  if (!inTime(p, now)) {
    // Show the moment the item starts, so the reader sees it in the state it will be in.
    const start = toMs(p.start);
    url = { ...url, moment: Number.isFinite(start) && start > now ? start : null, time: DEFAULT_TIME_WINDOW };
    when.setMoment(url.moment);
    when.setSelected(url.time);
  }
  const cats = catSet();
  if (cats && !cats.has(p.cat)) {
    url = { ...url, cats: null };
    chips.setSelected(null);
  }
  if (url.road && !matchesRoad(p.road, url.road)) exitRoad();
  if (hideNvt && verdictFor(p, url.mode, {}).level === 'nvt') {
    hideNvt = false;
    relevance.set(false);
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
    if (url.road) pendingRoadFit = true;
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
        if (!url.road) render();
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
  if (map && url.center === null && url.zoom === null && !url.road) {
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
    if (url.road) pendingRoadFit = true;
    render();
    if (selected) {
      // A deep link can have its detail loaded before the map existed: re-apply the detour.
      map.fitToFeature(selected);
      map.setDetour(currentDetour());
    }
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
  when.setSelected(url.time);
  when.setMoment(url.moment);
  chips.setSelected(catSet());
  modeSelect.set(url.mode);
  search.setQuery(url.road ?? url.query);
  if (needsGepland()) void ensureGepland();
  render();
  if (next.id) void resolveDeepLink(next.id);
  else if (selected) selectItem(null);
});

void boot();
