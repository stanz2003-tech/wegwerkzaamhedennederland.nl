/**
 * App entry: wires the map, the panel (vehicle mode, search, filters, "Wanneer?", answer card,
 * list, detail) and the top bar around ONE question: "Kan ik erdoor?"
 *
 * Every filter is strict and shared — whatever the list shows is exactly what the map shows:
 * category chips, vehicle relevance, road mode (`?weg=a27`) or place mode (`?plaats=almkerk`) and
 * the chosen moment. Outside road and place mode the list follows the map viewport. The verdict
 * for the chosen vehicle mode colours the map, leads every list row and the detail, and is
 * summarised in one sentence above the list (in road and place mode: the answer card).
 *
 * Flow: URL state → map (PDOK basemap with fallbacks) → meta + werk-actueel + live → layers →
 * filters/list → detail on select. `werk-gepland.geojson` is loaded lazily the first time a
 * window beyond "Nu" or a future moment is chosen; `live.geojson` + `meta.json` refresh every
 * 90 s while the document is visible. URL state is written back debounced (replaceState); a
 * road, a place (ui/place-controller.ts) or an opened item gets its own history entry, so the
 * phone's back gesture undoes that step instead of leaving the site.
 */
import './styles/base.css';
import './styles/components.css';
import './styles/place-search.css';
import './styles/chrome.css';
// map.css + the MapLibre stylesheet come in via src/map/map.ts.
import './styles/panel.css';
import './styles/panel-controls.css';
import './styles/app.css';

import site from '../site.config.json';
import { clearDetailCache, loadDetail } from './data/detail';
import { matchesRoad } from './data/entity';
import { bboxIntersects, bboxOf, countByCategory, dedupeById, matchesQuery, midpointOf, sortItems, type BBox, type SortId } from './data/filter';
import { liveAppliesAt } from './data/forecast';
import { loadIndexAll, rowsToItems, type IndexItem } from './data/index';
import { entityPagesNow } from './data/entity-pages';
import { DataLoadError, loadGepland, loadLiveRefresh, loadStartData } from './data/load';
import { DEFAULT_TIME_WINDOW, isActiveAt, matchesTimeWindow, overlapsWindow, toMs } from './data/time';
import type { Category, ItemDetail, ItemFeature, Meta } from './data/types';
import {
  detailStepBackAllowed,
  itemDeepLink,
  normalizeRoadParam,
  readStoredMode,
  readUrlState,
  storeMode,
  writeUrlState,
  type HistoryMarker,
  type UrlState,
} from './data/url-state';
import { VERDICT_SEVERITY, modeNoun, verdictFor, type VehicleMode, type VerdictLevel } from './data/verdict';
import { AppMap, NL_CENTER, NL_LAND_BOUNDS, NL_ZOOM } from './map/map';
import { wireCmpLinks } from './ui/ads';
import { announce } from './ui/announce';
import { mountAnalytics } from './ui/analytics';
import { mountCategoryChips } from './ui/chips';
import { mountSortSelect, mountSwitch } from './ui/controls';
import { renderDetail } from './ui/detail';
import { mountLegend } from './ui/legend';
import { mountList } from './ui/list';
import { clearMapNotice, copyLink, renderHomeCounts, showMapNotice, wireUitlegLinks } from './ui/map-page';
import { modelFromProps } from './ui/list-item';
import { mountModeSelect } from './ui/mode-select';
import { mountPanel } from './ui/panel';
import { mountPanelLayout } from './ui/panel-layout';
import { dayWindowOf, renderPanelSummary, renderRoadAnswer, type PanelAnswerEls } from './ui/panel-answer';
import { pickOfUrl } from './ui/date-pick';
import { mountSearch } from './ui/search';
import { QUIETLY, createPlaceController, type LeaveOptions } from './ui/place-controller';
import { clearPlaceAnswer, hasPlacePage, placeMatcher, placePageHref, placePrefix, renderPlaceAnswer, resolvePlace } from './ui/place-mode';
import { currentTheme, onThemeChange, prefersReducedMotion } from './ui/theme';
import { showToast } from './ui/toast';
import { renderStaleBanner } from './ui/stale-banner';
import { liveStatusFromMeta, mountTopbar, staleDataLabel, type LiveStatus } from './ui/topbar';
import { mountWhenControl } from './ui/when-control';
import { horizonMs } from './data/horizon';

const REFRESH_MS = 90_000;
/** Upper bound on list models; the list itself renders in batches of 40. */
const LIST_MAX = 800;
const DESKTOP_PANEL_PAD = 420;
/** Phone only: low enough that the whole country fits above the half-open sheet (mobiel-11). */
const MOBILE_MIN_ZOOM = 5.4;
/** Below this viewport height the half sheet cannot show the answer under the sticky header. */
const SHORT_VIEWPORT_PX = 620;

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
let geplandLoaded = false;
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
/** Set when a text filter was typed (or came in the URL): fit the map to its matches once. */
let pendingQueryFit = url.query !== '';
let liveStatus: LiveStatus = { kind: 'loading' };

/* ------------------------------------------------------------------ chrome */

const topbar = mountTopbar();
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
const staleEl = el<HTMLElement>('[data-stale]');
const hiddenBtn = el<HTMLButtonElement>('[data-hidden]');
const listHeading = el<HTMLElement>('#list-heading');
const answerEls: PanelAnswerEls = { panel: panelEl, answer: answerEl, summary: summaryEl, hiddenBtn };

/** The data state everywhere it shows: the topbar pill, the banner above the answer, the card. */
function setLive(status: LiveStatus): void {
  liveStatus = status;
  topbar.setLive(status);
  renderStaleBanner(staleEl, status);
}
setLive({ kind: 'loading' });

/* ------------------------------------------------------------------ helpers */

function catSet(): Set<Category> | null {
  return url.cats ? new Set(url.cats) : null;
}

function needsGepland(now = Date.now()): boolean {
  if (url.moment !== null) return url.moment > now;
  if (url.day !== null) return (dayWindowOf(url, now)?.to ?? now) > now;
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

/**
 * A picked date (`?dag=`) is a window: what touches it counts, judged as selectInWindow does for
 * an item without detail (overlap, plus the live-snapshot rule) — so the list holds exactly the
 * items the answer card weighed.
 */
function inTime(p: ItemFeature['properties'], now: number): boolean {
  if (url.moment !== null) return isActiveAt(p, url.moment) && liveAppliesAt(p, url.moment, now);
  const day = dayWindowOf(url, now);
  if (day) return overlapsWindow(p, day.from, day.to) && liveAppliesAt(p, day.from, now);
  return matchesTimeWindow(p, url.time, now);
}

const STEP: HistoryMarker = { wegwerk: true };

/**
 * Writes the state to the address bar. `push`: this was a step the back button should undo
 * (a road, a place, an opened item; mobiel-5); everything else replaces the current entry.
 */
function syncUrl(push: HistoryMarker | false = false): void {
  if (map) {
    url = { ...url, zoom: map.getZoom(), center: map.getCenter() };
  }
  writeUrlState(url, push ? { push: true, marker: push } : {});
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

/**
 * Verdict level per feature for the current mode and moment (no detail loaded here). For a picked
 * date the window form is used, the one the answer card's selectInWindow uses, so the pills under
 * the card never read lighter than the card. (The Vandaag/Morgen/Weekend chips still judge the
 * pills at `at` = now while the card judges the window; reported, not changed here.)
 */
function judge(features: readonly ItemFeature[], mode: VehicleMode, at: number, window?: { from: number; to: number } | null): Judged[] {
  return features.map((f) => ({ f, level: verdictFor(f.properties, mode, window ? { window } : { now: at }).level }));
}

/** The feature the map draws: the item plus its verdict level (`v`) for the paint expressions. */
function withVerdict(j: Judged): ItemFeature {
  return { ...j.f, properties: { ...j.f.properties, v: j.level } as ItemFeature['properties'] };
}

/** Signature of the dataset handed to the map, so panning does not re-upload the GeoJSON. */
let lastMapKey = '';
/** What the last render put on screen, in the form a screen reader should hear it. */
let lastAnswerText = '';

function render(): void {
  const now = Date.now();
  const at = momentAt(now);
  const dayWin = dayWindowOf(url, now);
  const items = allItems();
  const cats = catSet();

  // 1. time (moment or window), 2. road or place mode, 3. free text.
  const place = places.active();
  const inPlace = place ? placeMatcher(place, entityPagesNow()) : null;
  let base = items.filter((f) => inTime(f.properties, now));
  const roadAll = url.road ? items.filter((f) => matchesRoad(f.properties.road, url.road ?? '')) : items;
  const placeAll = inPlace ? items.filter((f) => inPlace(f.properties)) : [];
  if (url.road) base = base.filter((f) => matchesRoad(f.properties.road, url.road ?? ''));
  if (inPlace) base = base.filter((f) => inPlace(f.properties));
  if (url.query) base = base.filter((f) => matchesQuery(f.properties, url.query));

  // 4. vehicle relevance (the verdict decides), 5. categories.
  const judged = judge(base, url.mode, at, dayWin);
  const relevant = hideNvt ? judged.filter((j) => j.level !== 'nvt') : judged;
  chips.setCounts(countByCategory(relevant.map((j) => j.f)));
  const forMap = cats ? relevant.filter((j) => cats.has(j.f.properties.cat)) : relevant;

  const mapKey = `${at}|${url.time}|${url.day ?? ''}|${url.part ?? ''}|${url.cats?.join(',') ?? '*'}|${url.query}|${url.mode}|${hideNvt}|${url.road ?? ''}|${place?.slug ?? ''}|${forMap.length}|${items.length}`;
  if (mapKey !== lastMapKey) {
    lastMapKey = mapKey;
    map?.setItems(forMap.map(withVerdict));
    map?.setSelected(selected?.properties.id ?? null);
  }

  // Outside road mode the list follows the viewport; in road mode it is the whole road, and with
  // a text filter it is every match: "Almkerk" typed with the camera on Amsterdam must not answer
  // "In beeld: geen meldingen" while Almkerk has a closure (zoek-3).
  const bounds = url.road || url.query || place ? null : mapBounds();
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
  list.setItems(models, now, selected?.properties.id ?? null, {
    mode: url.mode,
    at,
    ...(dayWin ? { window: dayWin } : {}),
    total: ordered.length,
    ...(url.query ? { emptyQuery: url.query, ...(ordered.length === 0 ? places.didYouMeanOpt(url.query) : {}) } : {}),
  });

  // The sentence above the list counts what is in view including the items the relevance
  // switch hides, so it can say how many were hidden and for whom.
  const inViewAll = (cats ? judged.filter((j) => cats.has(j.f.properties.cat)) : judged).filter(
    (j) => !bounds || bboxIntersects(bboxOf(j.f.geometry) ?? bounds, bounds),
  );
  const summary = renderPanelSummary(answerEls, url, inViewAll.map((j) => j.f), now, { total: ordered.length }, hideNvt, place ? placePrefix(place) : undefined);
  layout.setFilters({ cats, hideNvt, hidden: summary.hidden });
  const dataAsOf = staleDataLabel(liveStatus, now);
  const roadText = renderRoadAnswer(answerEls, url, cats ? roadAll.filter((f) => cats.has(f.properties.cat)) : roadAll, now, {
    ...(dataAsOf ? { dataAsOf } : {}),
    hasRoadPage: (slug) => entityPagesNow()?.hasRoadPage(slug) ?? false,
    onExit: () => exitRoad(),
    onNow: () => backToNow(),
  });
  let placeText: string | null = null;
  if (place) {
    const pageHref = hasPlacePage(place, entityPagesNow()) ? placePageHref(place, url) : null;
    placeText = renderPlaceAnswer(answerEls, url, place, cats ? placeAll.filter((f) => cats.has(f.properties.cat)) : placeAll, now, {
      ...(dataAsOf ? { dataAsOf } : {}),
      pageHref,
      onExit: () => places.exit(),
      onNow: () => backToNow(),
    });
  } else clearPlaceAnswer(answerEls);
  lastAnswerText = roadText ?? placeText ?? summary.text;

  if (pendingRoadFit && map && url.road && forMap.length > 0) {
    pendingRoadFit = false;
    map.fitToFeatures(forMap.map((j) => j.f));
  }
  if (map && place && forMap.length > 0 && places.takeFit()) {
    map.fitToFeatures(forMap.map((j) => j.f));
  }
  if (pendingQueryFit && map && url.query && forMap.length > 0) {
    pendingQueryFit = false;
    map.fitToFeatures(forMap.map((j) => j.f));
  }
}

function showFatal(message: string): void {
  showMapNotice(mapErrorEl, message, () => void start(true));
  list.setError(message);
  setLive({ kind: 'error' });
}

/* ------------------------------------------------------------------ announcements */

/**
 * Speaks the answer on screen after a user action (never from moveend or the refresh; see
 * ui/announce.ts). When the choice needs the planned works that are still loading, the answer
 * on screen is not complete yet: "morgen: Geen hinder gemeld" spoken before werk-gepland arrived
 * would be a false all-clear, so we wait for it — and say nothing if it fails (the toast does).
 */
function announceAnswer(): void {
  if (!dataOk) return;
  if (needsGepland() && !geplandLoaded && geplandLoad) {
    void geplandLoad.then(() => {
      if (geplandLoaded) announce(lastAnswerText);
    });
    return;
  }
  announce(lastAnswerText);
}

/* ------------------------------------------------------------------ road and place mode */

/**
 * After entering a road or place: the answer in view, its headline focused and spoken. `withMap`
 * (place mode, owner decision 3): on a phone the sheet goes back to half, also from the full
 * sheet the search box opened, so the place shows on the map above the answer.
 */
function showAnswer(withMap = false): void {
  // On a short phone the half sheet is all sticky header: open it fully so the answer shows.
  const short = panel.isMobile() && window.innerHeight < SHORT_VIEWPORT_PX;
  if (withMap && panel.isMobile() && !short) panel.snap('half');
  else panel.ensureAtLeast(short ? 'full' : 'half');
  answerEl.querySelector<HTMLElement>('.answer__headline')?.focus({ preventScroll: true });
  panel.scrollTo(answerEl);
  announceAnswer();
}

function enterRoad(road: string, fit = true, push = true): void {
  const key = normalizeRoadParam(road) ?? road.trim().toUpperCase();
  if (!key) return;
  url = { ...url, road: key, place: null, query: '' };
  pendingQueryFit = false;
  search.setQuery(key);
  if (selected) selectItem(null, false);
  pendingRoadFit = fit;
  render();
  syncUrl(push ? STEP : false);
  showAnswer();
}

/** `push` (default): "Alle wegen" is a step of its own; not when the caller moves on to something else. */
function exitRoad(o: LeaveOptions = {}): void {
  url = { ...url, road: null };
  search.setQuery('');
  pendingRoadFit = false;
  render();
  syncUrl(o.push === false ? false : STEP);
  afterLeave(o);
}

function afterLeave(o: LeaveOptions): void {
  // On a phone a focused input brings up the keyboard and the full sheet, while "Alle wegen"
  // asks for the map: there the focus goes to the list heading instead.
  if (o.focus !== false) {
    if (panel.isMobile()) listHeading.focus({ preventScroll: true });
    else search.focus();
  }
  if (!o.quiet) announceAnswer();
}

const places = createPlaceController({
  url: () => url,
  setUrl: (next) => (url = next),
  dataOk: () => dataOk,
  render,
  syncUrl,
  map: () => map,
  setQuery: (q) => search.setQuery(q),
  pickInSearch: (hit) => search.pickPlace(hit),
  deselect: () => selected && selectItem(null, false),
  leaveRoad: exitRoad,
  showAnswer,
  afterLeave,
  repaintDetail: () => selected && paintDetail(),
  peek: () => panel.snap('peek'),
});

/* ------------------------------------------------------------------ detail view */

function showList(): void {
  detailEl.hidden = true;
  listEl.hidden = false;
  layout.setDetail(false);
}

/** The detour polyline of the open detail, when the wegbeheerder published one. */
function currentDetour(): [number, number][] | null {
  const g = detailData?.detourGeom;
  return g && g.length >= 2 ? g : null;
}

/**
 * `open`: the detail was just opened, so "Terug" gets the focus. A repaint (mode, moment, the
 * loaded shard) keeps the focus where it is — the date field must stay editable in detail view —
 * unless it sat inside the re-rendered detail.
 */
function paintDetail(open = false): void {
  if (!selected) return;
  const refocus = open || detailEl.contains(document.activeElement);
  detailEl.hidden = false;
  listEl.hidden = true;
  layout.setDetail(true);
  const now = Date.now();
  const dayWin = dayWindowOf(url, now);
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
      ...(dayWin ? { window: dayWin } : {}),
      roadMode: url.road,
    },
    now,
    {
      onBack: () => closeDetail(),
      onShare: () => void share(),
      onRetry: () => void loadDetailFor(selected),
      onRoad: (road) => enterRoad(road),
    },
  );
  if (refocus) layout.focusBack();
  map?.setDetour(currentDetour());
}

async function share(): Promise<void> {
  if (selected) await copyLink(itemDeepLink(selected.properties.id));
}

async function loadDetailFor(feature: ItemFeature | null, open = false): Promise<void> {
  if (!feature) return;
  const id = feature.properties.id;
  detailData = null;
  detailError = false;
  paintDetail(open);
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

/**
 * "Terug" in the detail: when this page view pushed the entry of the open item, step back in the
 * history (the back gesture and the button then agree); after a deep link or a reload there is
 * no such entry, and the detail just closes — "Terug" never leaves the site.
 */
function closeDetail(): void {
  if (selected && detailStepBackAllowed()) {
    window.history.back();
    return;
  }
  selectItem(null);
}

/**
 * Selects an item (or clears the selection) and updates map, URL and panel. `push` (default:
 * opening an item while none was open) gives the item its own history entry; switching from one
 * item to the next replaces it, so the back button does not walk through every row.
 */
function selectItem(id: string | null, fly = true, push?: boolean): void {
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
  void loadDetailFor(feature, true);
  syncUrl((push ?? previous === null) ? { wegwerk: true, detail: true } : false);
}

/* ------------------------------------------------------------------ UI mounts */

const panel = mountPanel(panelEl, handleEl, stageEl);
panel.onChange(() => {
  updatePadding();
  map?.resize();
});

const layout = mountPanelLayout(
  {
    panel: panelEl,
    filters: el<HTMLDetailsElement>('[data-filters]'),
    filtersSummary: el<HTMLElement>('[data-filters-summary]'),
    detailBar: el<HTMLElement>('[data-detail-bar]'),
    detail: detailEl,
  },
  panel,
  { onBack: () => closeDetail(), onShare: () => void share() },
);

const modeSelect = mountModeSelect(el<HTMLElement>('[data-mode]'), url.mode, (mode) => {
  url = { ...url, mode };
  storeMode(mode);
  relevance.setLabel(`Alleen relevant voor ${modeNoun(mode)}`);
  render();
  if (selected) paintDetail();
  syncUrl();
  announceAnswer();
});

const list = mountList(listEl, {
  onSelect: (id) => selectItem(id),
  onHover: (id) => map?.setHover(id),
  onReset: () => {
    url = { ...url, cats: null, time: DEFAULT_TIME_WINDOW, moment: null, day: null, part: null, query: '', road: null, place: null };
    hideNvt = true;
    chips.setSelected(null);
    when.setSelected(DEFAULT_TIME_WINDOW);
    when.setPick(null);
    relevance.set(true);
    search.setQuery('');
    render();
    syncUrl();
    announceAnswer();
  },
  onRetry: () => void start(true),
  onRoad: (road) => enterRoad(road),
  reveal: (row) => panel.scrollTo(row, 'nearest'),
  onClearQuery: () => {
    url = { ...url, query: '' };
    pendingQueryFit = false;
    search.setQuery('');
    render();
    syncUrl();
    search.focus();
  },
});

const chips = mountCategoryChips(el<HTMLElement>('[data-cats]'), (cats) => {
  url = { ...url, cats: cats ? [...cats] : null };
  render();
  syncUrl();
  announceAnswer();
});

/** "Terug naar nu" in the answer card: the question goes back to this moment. */
function backToNow(): void {
  url = { ...url, time: DEFAULT_TIME_WINDOW, moment: null, day: null, part: null };
  when.setSelected(DEFAULT_TIME_WINDOW);
  when.setPick(null);
  render();
  if (selected) paintDetail();
  syncUrl();
  announceAnswer();
}

const when = mountWhenControl(
  el<HTMLElement>('[data-when]'),
  { time: url.time, pick: pickOfUrl(url) },
  {
    onChange: (id) => {
      url = { ...url, time: id, moment: null, day: null, part: null };
      if (needsGepland()) void ensureGepland();
      render();
      if (selected) paintDetail();
      syncUrl();
      announceAnswer();
    },
    onPick: (pick) => {
      url = {
        ...url,
        moment: pick?.kind === 'moment' ? pick.at : null,
        day: pick?.kind === 'day' ? pick.date : null,
        part: pick?.kind === 'day' ? pick.part : null,
      };
      if (needsGepland()) void ensureGepland();
      render();
      if (selected) paintDetail();
      syncUrl();
      announceAnswer();
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
    void resolveDeepLink(hit.id, true);
  },
  onPickPlace: (loc, zoom, hit) => places.pick(loc, zoom, hit),
  onPickRoad: (road) => enterRoad(road),
  onQuery: (q) => {
    if (url.road && q === '') {
      exitRoad();
      return;
    }
    if (url.place && q === '') {
      places.exit();
      return;
    }
    // A typed text filter replaces place mode: one subject at a time.
    url = { ...url, query: q, place: q ? null : url.place };
    pendingQueryFit = q !== '';
    render();
    syncUrl();
  },
  // On a phone the keyboard takes the lower half of the screen: open the sheet fully so the
  // search box sits at the top and the suggestions above the keyboard (mobiel-4).
  onFocus: () => (panel.isMobile() ? panel.snap('full') : panel.ensureAtLeast('half')),
  // The suggestions show the verdict the list row shows: same vehicle, same moment.
  context: () => ({ mode: url.mode, at: momentAt(Date.now()) }),
});

search.setQuery(url.road ?? url.query);
sortSelect.set(sort);
chips.setSelected(catSet());
modeSelect.set(url.mode);

wireUitlegLinks(reducedMotion);

/* ------------------------------------------------------------------ data */

async function ensureGepland(): Promise<void> {
  if (geplandLoad) return geplandLoad;
  geplandLoad = loadGepland()
    .then((items) => {
      gepland = items;
      geplandLoaded = true;
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

/** Loads the item behind `?id=` even when it is not in the active set. `push`: picked by the user. */
async function resolveDeepLink(id: string, push = false): Promise<void> {
  if (!byId.has(id) && !geplandLoad) await ensureGepland();
  const feature = byId.get(id);
  if (!feature) {
    showToast('Deze melding staat niet meer in de actuele gegevens.', 'error');
    url = { ...url, id: null };
    syncUrl();
    return;
  }
  ensureItemVisible(feature);
  selectItem(id, true, push && !selected);
}

/** Relaxes the filters so a deep-linked item is actually on the map. */
function ensureItemVisible(feature: ItemFeature): void {
  const now = Date.now();
  const p = feature.properties;
  if (!inTime(p, now)) {
    // Show the moment the item starts, so the reader sees it in the state it will be in.
    const start = toMs(p.start);
    url = { ...url, moment: Number.isFinite(start) && start > now ? start : null, day: null, part: null, time: DEFAULT_TIME_WINDOW };
    when.setSelected(url.time);
    when.setPick(pickOfUrl(url));
  }
  const cats = catSet();
  if (cats && !cats.has(p.cat)) {
    url = { ...url, cats: null };
    chips.setSelected(null);
  }
  if (url.road && !matchesRoad(p.road, url.road)) exitRoad(QUIETLY);
  const place = places.active();
  if (place && !placeMatcher(place, entityPagesNow())(p)) places.exit(QUIETLY);
  if (hideNvt && verdictFor(p, url.mode, {}).level === 'nvt') {
    hideNvt = false;
    relevance.set(false);
  }
  render();
}

async function start(retry = false): Promise<void> {
  if (retry) {
    clearMapNotice(mapErrorEl);
    list.setLoading();
    setLive({ kind: 'loading' });
  }
  try {
    const data = await loadStartData();
    dataOk = true;
    meta = data.meta;
    actueel = data.actueel;
    live = data.live;
    lastRefresh = Date.now();
    index();
    clearMapNotice(mapErrorEl);
    setLive(liveStatusFromMeta(data.meta));
    when.setHorizon(horizonMs());
    renderHomeCounts(data.meta);
    if (needsGepland()) void ensureGepland();
    if (url.road) pendingRoadFit = true;
    if (url.place) places.wantFit();
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
    setLive(liveStatusFromMeta(next.meta));
    when.setHorizon(horizonMs());
    when.refresh();
    renderHomeCounts(next.meta);
    render();
    if (selected && !byId.has(selected.properties.id)) selectItem(null);
  } catch {
    // One failed refresh is not stale data: judge the age of what we have, so the warning appears
    // once it is really older than STALE_AFTER_MINUTES (owner decision: 30 minutes).
    if (meta) {
      setLive(liveStatusFromMeta(meta));
      render();
    }
  }
}

/* ------------------------------------------------------------------ boot */

/** Fits Cadzand to Vaals above the sheet: top padding 8, bottom exactly what the sheet covers. */
function frameCountry(): void {
  if (!map || map.userMoved || !panel.isMobile()) return;
  map.resize();
  map.fitBBox(NL_LAND_BOUNDS, 9, { top: 8, right: 16, bottom: panel.coveredPx() + 8, left: 16 });
}

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
        // Road mode and a text filter list everything they match, wherever the camera is.
        if (!url.road && !url.query && !places.active()) render();
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
  if (map && url.center === null && url.zoom === null && !url.road && !url.place) {
    if (panel.isMobile()) {
      map.setMinZoom(MOBILE_MIN_ZOOM);
      frameCountry();
      // A turned phone gets the same frame again, until the user moved the map himself.
      window.addEventListener('orientationchange', () => window.setTimeout(frameCountry, 300));
    } else map.flyTo(NL_CENTER, NL_ZOOM);
  }
  onThemeChange((theme) => void map?.setTheme(theme));
  await data;
  // Only re-render when the data actually arrived: after a failure the list must keep the
  // error banner with its retry button instead of falling back to the empty state.
  if (map && dataOk) {
    // The first render may have run without a map; push the data into the new sources.
    lastMapKey = '';
    if (url.road) pendingRoadFit = true;
    if (url.place) places.wantFit();
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
    closeDetail();
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
/**
 * The back (and forward) button: restores the subject (road or place), the text filter and the
 * open item of that entry. Vehicle, moment, filters and camera stay as they are now — closing an
 * item with the back gesture must not also undo the vehicle chosen while it was open.
 */
window.addEventListener('popstate', () => {
  const next = readUrlState();
  const before = { road: url.road, place: url.place };
  const samePlace = next.place && before.place?.kind === next.place.kind && before.place.slug === next.place.slug;
  const place = next.place ? (samePlace ? before.place : resolvePlace(next.place, entityPagesNow())) : null;
  url = { ...url, road: next.road, place, query: next.query, id: next.id };
  search.setQuery(url.road ?? place?.name ?? url.query);
  pendingRoadFit = url.road !== null && url.road !== before.road;
  if (place !== null && !samePlace) places.wantFit();
  render();
  if (next.id) {
    if (next.id !== selected?.properties.id) void resolveDeepLink(next.id);
  } else if (selected) selectItem(null);
  else syncUrl();
  if (panel.isMobile()) panel.snap('half');
});

void boot();
