/**
 * URL state: `?cat=werk,afsluiting&t=7d&z=9.2&c=5.29,52.13&id=<id>&q=<search>&v=fiets`.
 *
 * `t` carries either a time window (`nu|vandaag|weekend|7d|30d`) or an exact moment as a
 * `datetime-local` value in Europe/Amsterdam (`t=2026-09-20T14:00`, the "Op datum…" chip).
 * `v` is the vehicle mode the verdicts are computed for (default `auto`, then not written).
 * Parsing/serialising are pure; reading/writing the address bar are thin wrappers.
 */
import type { Category } from './types';
import { CATEGORIES } from './types';
import { DEFAULT_TIME_WINDOW, isTimeWindowId, zonedParts, zonedToMs, type TimeWindowId } from './time';
import { DEFAULT_VEHICLE_MODE, isVehicleMode, type VehicleMode } from './verdict';

export interface UrlState {
  /** Selected categories; `null` = all (nothing written to the URL). */
  cats: Category[] | null;
  time: TimeWindowId;
  /** Exact moment (epoch ms) chosen with "Op datum…"; overrides `time` when set. */
  moment: number | null;
  zoom: number | null;
  center: [number, number] | null;
  id: string | null;
  query: string;
  mode: VehicleMode;
  /** Road mode (`?weg=a27`): only that road's items, with the answer card on top. */
  road: string | null;
}

export const DEFAULT_URL_STATE: UrlState = {
  cats: null,
  time: DEFAULT_TIME_WINDOW,
  moment: null,
  zoom: null,
  center: null,
  id: null,
  query: '',
  mode: DEFAULT_VEHICLE_MODE,
  road: null,
};

const ROAD_RE = /^([ANSE])\s*0*(\d{1,3})$/i;

/** "a27" / "A 27" / "A027" → "A27"; null when it is not a road number. */
export function normalizeRoadParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = ROAD_RE.exec(raw.trim());
  if (!m) return null;
  return `${(m[1] ?? '').toUpperCase()}${Number(m[2])}`;
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
  return {
    cats: parseCats(params.get('cat')),
    time: t && isTimeWindowId(t) ? t : DEFAULT_TIME_WINDOW,
    moment: parseLocalDateTime(t),
    zoom,
    center,
    id: id && id.length <= 200 ? id : null,
    query: (params.get('q') ?? '').slice(0, 100),
    mode: isVehicleMode(v) ? v : DEFAULT_VEHICLE_MODE,
    road: normalizeRoadParam(params.get('weg')),
  };
}

/** Serialises to a query string without the leading "?" (empty when everything is default). */
export function serializeUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.cats && state.cats.length > 0 && state.cats.length < CATEGORIES.length) {
    params.set('cat', [...state.cats].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)).join(','));
  }
  if (state.moment !== null && Number.isFinite(state.moment)) params.set('t', formatLocalDateTime(state.moment));
  else if (state.time !== DEFAULT_TIME_WINDOW) params.set('t', state.time);
  if (state.zoom !== null && Number.isFinite(state.zoom)) params.set('z', state.zoom.toFixed(1));
  if (state.center) params.set('c', `${state.center[0].toFixed(3)},${state.center[1].toFixed(3)}`);
  if (state.id) params.set('id', state.id);
  if (state.query) params.set('q', state.query);
  if (state.mode !== DEFAULT_VEHICLE_MODE) params.set('v', state.mode);
  if (state.road) params.set('weg', state.road.toLowerCase());
  // Keep commas and colons readable in the address bar.
  return params.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
}

export function readUrlState(): UrlState {
  if (typeof window === 'undefined') return DEFAULT_URL_STATE;
  return parseUrlState(window.location.search);
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Writes the state with history.replaceState, debounced so map moves do not spam the history. */
export function writeUrlState(state: UrlState, delayMs = 300): void {
  if (typeof window === 'undefined') return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    const qs = serializeUrlState(state);
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, '', next);
  }, delayMs);
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
