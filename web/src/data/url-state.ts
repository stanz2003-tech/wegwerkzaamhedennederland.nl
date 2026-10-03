/**
 * URL state: `?cat=werk,afsluiting&t=7d&z=9.2&c=5.29,52.13&id=<id>&q=<search>&v=fiets`, plus
 * one subject: `weg=a27`, or `plaats=almkerk` / `gemeente=altena`.
 *
 * `t` carries either a time window (`nu|vandaag|weekend|7d|30d`) or an exact moment as a
 * `datetime-local` value in Europe/Amsterdam (`t=2026-09-20T14:00`, the "Op datum…" chip).
 * `dag` (+ optional `deel`) asks about a whole calendar day or a part of it as a window
 * (`?dag=2026-10-06&deel=ochtend`): a date without a time gets the heaviest verdict of that day,
 * not the verdict of one guessed hour. `t` with a moment wins over `dag`.
 * `v` is the vehicle mode the verdicts are computed for (default `auto`, then not written).
 * Parsing/serialising are pure; reading/writing the address bar are thin wrappers.
 */
import type { Category } from './types';
import { CATEGORIES } from './types';
import { DEFAULT_TIME_WINDOW, isDateKey, isDayPart, isTimeWindowId, zonedParts, zonedToMs, type DayPart, type TimeWindowId } from './time';
import { DEFAULT_VEHICLE_MODE, isVehicleMode, type VehicleMode } from './verdict';

export interface UrlState {
  /** Selected categories; `null` = all (nothing written to the URL). */
  cats: Category[] | null;
  time: TimeWindowId;
  /** Exact moment (epoch ms) chosen with "Op datum…"; overrides `time` when set. */
  moment: number | null;
  /** A calendar day (`YYYY-MM-DD`, Europe/Amsterdam) asked about as a window; null without `?dag=`. */
  day: string | null;
  /** Narrows `day` to a day part; null = the whole day. */
  part: DayPart | null;
  zoom: number | null;
  center: [number, number] | null;
  id: string | null;
  query: string;
  mode: VehicleMode;
  /** Road mode (`?weg=a27`): only that road's items, with the answer card on top. */
  road: string | null;
  /**
   * Place mode (`?plaats=almkerk` / `?gemeente=altena`): only that place's items, with the answer
   * card "Kan ik door Almkerk?". Never together with `road`. Parsing only knows the slug; the
   * name comes from the entity-page manifest (data/entity-pages.ts), so `name` is '' until then.
   */
  place: PlaceRef | null;
}

export interface PlaceRef {
  kind: 'woonplaats' | 'gemeente';
  slug: string;
  name: string;
  /** The gemeente of a woonplaats, when known: it tells two places with one name apart. */
  gemeente?: string | null;
}

export const DEFAULT_URL_STATE: UrlState = {
  cats: null,
  time: DEFAULT_TIME_WINDOW,
  moment: null,
  day: null,
  part: null,
  zoom: null,
  center: null,
  id: null,
  query: '',
  mode: DEFAULT_VEHICLE_MODE,
  road: null,
  place: null,
};

const ROAD_RE = /^([ANSE])\s*0*(\d{1,3})$/i;

/** "a27" / "A 27" / "A027" → "A27"; null when it is not a road number. */
export function normalizeRoadParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = ROAD_RE.exec(raw.trim());
  if (!m) return null;
  return `${(m[1] ?? '').toUpperCase()}${Number(m[2])}`;
}

/** Slugs as gen-pages writes them (types.ts `slugify`): lower-case ASCII words joined by "-". */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `?plaats=` / `?gemeente=` → a place reference without a name yet (the manifest supplies it). */
export function parsePlaceParam(params: URLSearchParams): PlaceRef | null {
  const plaats = params.get('plaats')?.trim().toLowerCase() ?? '';
  if (plaats && plaats.length <= 80 && SLUG_RE.test(plaats)) return { kind: 'woonplaats', slug: plaats, name: '' };
  const gemeente = params.get('gemeente')?.trim().toLowerCase() ?? '';
  if (gemeente && gemeente.length <= 80 && SLUG_RE.test(gemeente)) return { kind: 'gemeente', slug: gemeente, name: '' };
  return null;
}

const CATEGORY_SET = new Set<string>(CATEGORIES);
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseCats(raw: string | null): Category[] | null {
  if (raw === null || raw.trim() === '') return null;
  const cats = raw
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is Category => CATEGORY_SET.has(c));
  if (cats.length === 0 || cats.length === CATEGORIES.length) return null;
  return Array.from(new Set(cats));
}

function parseNumber(raw: string | null, min: number, max: number): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** `2026-09-20T14:00` (Europe/Amsterdam wall clock) → epoch ms; null when malformed. */
export function parseLocalDateTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = LOCAL_DATETIME.exec(raw.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if ([year, month, day, hour, minute].some((n) => n === undefined || Number.isNaN(n))) return null;
  if ((month ?? 0) < 1 || (month ?? 0) > 12 || (day ?? 0) < 1 || (day ?? 0) > 31 || (hour ?? 0) > 23 || (minute ?? 0) > 59) return null;
  const ms = zonedToMs(year ?? 0, month ?? 1, day ?? 1, hour ?? 0, minute ?? 0);
  return Number.isFinite(ms) ? ms : null;
}

/** Epoch ms → `2026-09-20T14:00` in Europe/Amsterdam (the value of a `datetime-local` input). */
export function formatLocalDateTime(ms: number): string {
  const p = zonedParts(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const zoom = parseNumber(params.get('z'), 0, 22);
  let center: [number, number] | null = null;
  const c = params.get('c');
  if (c) {
    const [lonRaw, latRaw] = c.split(',');
    const lon = parseNumber(lonRaw ?? null, -180, 180);
    const lat = parseNumber(latRaw ?? null, -90, 90);
    if (lon !== null && lat !== null) center = [lon, lat];
  }
  const t = params.get('t');
  const id = params.get('id');
  const v = params.get('v');
  const road = normalizeRoadParam(params.get('weg'));
  const moment = parseLocalDateTime(t);
  const dag = params.get('dag');
  const day = moment === null && isDateKey(dag) ? dag : null;
  const deel = params.get('deel');
  return {
    cats: parseCats(params.get('cat')),
    time: t && isTimeWindowId(t) ? t : DEFAULT_TIME_WINDOW,
    moment,
    day,
    part: day !== null && isDayPart(deel) ? deel : null,
    zoom,
    center,
    id: id && id.length <= 200 ? id : null,
    query: (params.get('q') ?? '').slice(0, 100),
    mode: isVehicleMode(v) ? v : DEFAULT_VEHICLE_MODE,
    road,
    // Road mode wins: one answer card, one subject.
    place: road ? null : parsePlaceParam(params),
  };
}

/** Serialises to a query string without the leading "?" (empty when everything is default). */
export function serializeUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.cats && state.cats.length > 0 && state.cats.length < CATEGORIES.length) {
    params.set('cat', [...state.cats].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)).join(','));
  }
  setWhenParams(params, state);
  if (state.zoom !== null && Number.isFinite(state.zoom)) params.set('z', state.zoom.toFixed(1));
  if (state.center) params.set('c', `${state.center[0].toFixed(3)},${state.center[1].toFixed(3)}`);
  if (state.id) params.set('id', state.id);
  if (state.query) params.set('q', state.query);
  if (state.mode !== DEFAULT_VEHICLE_MODE) params.set('v', state.mode);
  if (state.road) params.set('weg', state.road.toLowerCase());
  else if (state.place) params.set(state.place.kind === 'gemeente' ? 'gemeente' : 'plaats', state.place.slug);
  // Keep commas and colons readable in the address bar.
  return params.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
}

/** The part of the state that says WHEN: a moment, a day (+ part) or a time window. */
export type WhenParams = Pick<UrlState, 'moment' | 'day' | 'part'> & { time?: TimeWindowId };

/**
 * Writes `t` / `dag` / `deel` into `params` and removes the ones that do not apply. Shared by the
 * map URL, the entity pages (`syncPageUrl`) and the links from a page to the map, so all of them
 * write a chosen day the same way.
 */
export function setWhenParams(params: URLSearchParams, s: WhenParams): void {
  params.delete('t');
  params.delete('dag');
  params.delete('deel');
  if (s.moment !== null && Number.isFinite(s.moment)) params.set('t', formatLocalDateTime(s.moment));
  else if (s.day !== null) {
    params.set('dag', s.day);
    if (s.part) params.set('deel', s.part);
  } else if (s.time !== undefined && s.time !== DEFAULT_TIME_WINDOW) params.set('t', s.time);
}

export function readUrlState(): UrlState {
  if (typeof window === 'undefined') return DEFAULT_URL_STATE;
  return parseUrlState(window.location.search);
}

let pending: ReturnType<typeof setTimeout> | null = null;
let pendingState: UrlState | null = null;
/** Entries this page view pushed; after a reload or a deep link it is 0. */
let pushes = 0;

/** Marks the history entries this app pushed, so "Terug" knows the previous entry is ours. */
export interface HistoryMarker {
  wegwerk: true;
  /** The entry was pushed by opening an item (main.ts `selectItem`). */
  detail?: boolean;
}

export function isHistoryMarker(v: unknown): v is HistoryMarker {
  return !!v && typeof v === 'object' && (v as { wegwerk?: unknown }).wegwerk === true;
}

export interface WriteUrlOptions {
  delayMs?: number;
  /**
   * A new history entry instead of replacing the current one, written at once: entering a road
   * or place, opening an item. The phone's back gesture then undoes that step instead of
   * leaving the site (mobiel-5). Camera, mode and time stay on the debounced replace.
   */
  push?: boolean;
  /** Stored as the entry's `history.state` with a push (default `{ wegwerk: true }`). */
  marker?: HistoryMarker;
}

function urlFor(state: UrlState): string {
  const qs = serializeUrlState(state);
  return `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** Replaces the current entry and keeps its marker: a camera move must not unmark a pushed entry. */
function replaceNow(state: UrlState): void {
  const next = urlFor(state);
  if (next !== currentUrl()) window.history.replaceState(window.history.state, '', next);
}

/**
 * Writes the state to the address bar. By default with history.replaceState, debounced so map
 * moves do not spam the history; `{ push: true }` adds an entry at once. A pending replace is
 * written first, so the entry we leave keeps its last camera. Returns whether an entry was
 * pushed (not when the address would stay the same). A plain number is read as `delayMs`.
 */
export function writeUrlState(state: UrlState, opts: number | WriteUrlOptions = {}): boolean {
  if (typeof window === 'undefined') return false;
  const o: WriteUrlOptions = typeof opts === 'number' ? { delayMs: opts } : opts;
  if (pending) clearTimeout(pending);
  pending = null;
  if (o.push) {
    if (pendingState) replaceNow(pendingState);
    pendingState = null;
    const next = urlFor(state);
    if (next === currentUrl()) return false;
    window.history.pushState(o.marker ?? { wegwerk: true }, '', next);
    pushes += 1;
    return true;
  }
  pendingState = state;
  pending = setTimeout(() => {
    pending = null;
    const s = pendingState;
    pendingState = null;
    if (s) replaceNow(s);
  }, o.delayMs ?? 300);
  return false;
}

/**
 * Whether "Terug" in the detail may step back in the history: only when this page view pushed
 * the entry of the open item. Its previous entry is then this site's list; after a reload or a
 * deep link "Terug" must close the detail in place instead, never leave the site.
 */
export function detailStepBackAllowed(): boolean {
  if (typeof window === 'undefined' || pushes === 0) return false;
  const st: unknown = window.history.state;
  return isHistoryMarker(st) && st.detail === true;
}

/** Absolute deep link for one item (used by "Deel"). */
export function itemDeepLink(id: string, origin = typeof window === 'undefined' ? '' : window.location.origin): string {
  return `${origin}/?id=${encodeURIComponent(id)}`;
}

/* ------------------------------ vehicle mode store ------------------------------ */

const MODE_KEY = 'wegwerk:mode';

/** Stored vehicle mode (localStorage); null when none or unavailable. */
export function readStoredMode(): VehicleMode | null {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return isVehicleMode(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeMode(mode: VehicleMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private mode / storage disabled: the choice still applies to this page view.
  }
}
