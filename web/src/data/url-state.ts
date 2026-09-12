/**
 * URL state: `?cat=werk,afsluiting&t=7d&z=9.2&c=5.29,52.13&id=<id>&q=<search>`.
 * Parsing/serialising are pure; reading/writing the address bar are thin wrappers.
 */
import type { Category } from './types';
import { CATEGORIES } from './types';
import { DEFAULT_TIME_WINDOW, isTimeWindowId, type TimeWindowId } from './time';

export interface UrlState {
  /** Selected categories; `null` = all (nothing written to the URL). */
  cats: Category[] | null;
  time: TimeWindowId;
  zoom: number | null;
  center: [number, number] | null;
  id: string | null;
  query: string;
}

export const DEFAULT_URL_STATE: UrlState = {
  cats: null,
  time: DEFAULT_TIME_WINDOW,
  zoom: null,
  center: null,
  id: null,
  query: '',
};

const CATEGORY_SET = new Set<string>(CATEGORIES);

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
  return {
    cats: parseCats(params.get('cat')),
    time: t && isTimeWindowId(t) ? t : DEFAULT_TIME_WINDOW,
    zoom,
    center,
    id: id && id.length <= 200 ? id : null,
    query: (params.get('q') ?? '').slice(0, 100),
  };
}

/** Serialises to a query string without the leading "?" (empty when everything is default). */
export function serializeUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.cats && state.cats.length > 0 && state.cats.length < CATEGORIES.length) {
    params.set('cat', [...state.cats].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)).join(','));
  }
  if (state.time !== DEFAULT_TIME_WINDOW) params.set('t', state.time);
  if (state.zoom !== null && Number.isFinite(state.zoom)) params.set('z', state.zoom.toFixed(1));
  if (state.center) params.set('c', `${state.center[0].toFixed(3)},${state.center[1].toFixed(3)}`);
  if (state.id) params.set('id', state.id);
  if (state.query) params.set('q', state.query);
  // Keep commas readable in the address bar.
  return params.toString().replace(/%2C/g, ',');
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
