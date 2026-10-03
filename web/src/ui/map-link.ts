/**
 * Links between the big map and the road / place pages that carry the question along: the
 * vehicle mode (`?v=`) and the moment (`?t=`). A truck driver who picked "Vracht" and Saturday
 * 08:00 on /weg/a27/ must land on the map with the same question, and the other way round, or
 * the verdict on the next screen differs from the one he just read (zoek-10, zoek-6).
 *
 * `?t=` carries what url-state.ts already parses: an exact moment (`2026-10-03T08:00`) or the
 * windows `vandaag` / `morgen`. Other strip days have no map equivalent yet and only carry `v`.
 * Pure string building; no DOM.
 */
import { dayStrip, relativeDayLabel, type DayCell, type ForecastItem } from '../data/forecast';
import { slugify } from '../data/types';
import { formatLocalDateTime, type UrlState } from '../data/url-state';
import { DEFAULT_VEHICLE_MODE, type VehicleMode } from '../data/verdict';
import type { ForecastSelection } from './forecast-block';

/** The strip days the map has a window for. */
type DayWindow = 'vandaag' | 'morgen';

function dayWindowOf(cell: DayCell, now: number): DayWindow | null {
  const rel = relativeDayLabel(cell, now, '');
  return rel === 'vandaag' || rel === 'morgen' ? rel : null;
}

/** The `?t=` value of an entity-page selection; null when the map cannot ask the same question. */
export function timeParam(selection: ForecastSelection, now: number): string | null {
  if (selection.kind === 'moment') return formatLocalDateTime(selection.at);
  if (selection.kind === 'day') return dayWindowOf(selection.cell, now);
  return null;
}

/** `v=vracht&t=2026-10-03T08:00` — empty for auto and "nu". */
export function mapContextQuery(mode: VehicleMode, selection: ForecastSelection, now: number): string {
  const parts: string[] = [];
  if (mode !== DEFAULT_VEHICLE_MODE) parts.push(`v=${mode}`);
  const t = timeParam(selection, now);
  if (t) parts.push(`t=${t}`);
  return parts.join('&');
}

/** Appends query parts (each already `k=v[&k=v]`, empty ones skipped) to a path. */
export function withQuery(path: string, ...parts: readonly (string | undefined)[]): string {
  const q = parts.filter((p): p is string => typeof p === 'string' && p !== '').join('&');
  if (!q) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${q}`;
}

export type MapTarget = { kind: 'road'; slug: string } | { kind: 'woonplaats' | 'gemeente'; slug: string };

/**
 * "Op de grote kaart": road mode for a road, place mode for a place (`?plaats=` / `?gemeente=`,
 * read by the map's place mode). `extra` keeps the camera of the pre-rendered link (`c=…&z=…`)
 * so the map opens on the place even where place mode cannot resolve the slug.
 */
export function entityMapHref(target: MapTarget, context: string, extra = ''): string {
  const key = target.kind === 'road' ? 'weg' : target.kind === 'woonplaats' ? 'plaats' : 'gemeente';
  return withQuery(`/?${key}=${encodeURIComponent(target.slug)}`, extra, context);
}

/** `c=…&z=…` of a pre-rendered map link (`/?c=4.9,51.8&z=12`); empty when it has none. */
export function cameraParams(href: string | null | undefined): string {
  if (!href) return '';
  const i = href.indexOf('?');
  if (i < 0) return '';
  const params = new URLSearchParams(href.slice(i + 1));
  const out: string[] = [];
  for (const key of ['c', 'z']) {
    const v = params.get(key);
    if (v) out.push(`${key}=${v}`);
  }
  return out.join('&');
}

/** The part of the map's URL state a road-page link carries. */
export type MapQuestion = Pick<UrlState, 'mode' | 'time' | 'moment'>;

/**
 * Map road mode → /weg/<slug>/ with the same mode and moment: `?t=` for an exact moment, and
 * `vandaag` / `morgen`, which the road page opens as that strip day. Other windows (weekend)
 * have no single strip day and are left out rather than approximated.
 */
export function roadPageHref(road: string, q: MapQuestion): string {
  const parts: string[] = [];
  if (q.mode !== DEFAULT_VEHICLE_MODE) parts.push(`v=${q.mode}`);
  if (q.moment !== null && Number.isFinite(q.moment)) parts.push(`t=${formatLocalDateTime(q.moment)}`);
  else if (q.time === 'vandaag' || q.time === 'morgen') parts.push(`t=${q.time}`);
  return withQuery(`/weg/${slugify(road)}/`, parts.join('&'));
}

/**
 * The entity page's first selection from its URL: the exact moment, the strip day for
 * `?t=vandaag` / `?t=morgen`, otherwise everything ("nu").
 */
export function selectionFromUrl(url: Pick<UrlState, 'time' | 'moment'>, items: readonly ForecastItem[], mode: VehicleMode, now: number): ForecastSelection {
  if (url.moment !== null) return { kind: 'moment', at: url.moment };
  if (url.time !== 'vandaag' && url.time !== 'morgen') return { kind: 'all' };
  const cells = dayStrip(items, mode, now);
  const index = cells.findIndex((c) => dayWindowOf(c, now) === url.time);
  const cell = cells[index];
  return cell ? { kind: 'day', cell, index } : { kind: 'all' };
}
