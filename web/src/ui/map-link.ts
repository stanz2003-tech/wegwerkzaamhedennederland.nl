/**
 * Links between the big map and the road / place pages that carry the question along: the
 * vehicle mode (`?v=`) and the moment or day (`?t=` / `?dag=` + `&deel=`). A truck driver who
 * picked "Vracht" and Saturday 08:00 on /weg/a27/ must land on the map with the same question,
 * and the other way round, or the verdict on the next screen differs from the one he just read
 * (zoek-10, zoek-6).
 *
 * An exact moment travels as `?t=2026-10-03T08:00`, a strip day or a date (+ part) as
 * `?dag=2026-10-06&deel=ochtend` (url-state.ts `setWhenParams`, the same writer the map and the
 * pages use). The map's `?t=vandaag` / `?t=morgen` open the page on that strip day.
 * Pure string building; no DOM.
 */
import { localDateKey, startOfDay } from '../data/time';
import { slugify } from '../data/types';
import { formatLocalDateTime, setWhenParams, type UrlState, type WhenParams } from '../data/url-state';
import { DEFAULT_VEHICLE_MODE, type VehicleMode } from '../data/verdict';
import type { ForecastSelection } from './forecast-block';

/** The "Wanneer?" choice of an entity page as URL parameters: `t` for a moment, `dag` (+ `deel`) for a day. */
export function whenParamsOf(selection: ForecastSelection): WhenParams {
  if (selection.kind === 'moment') return { moment: selection.at, day: null, part: null };
  if (selection.kind === 'day') return { moment: null, day: localDateKey(selection.cell.from), part: null };
  if (selection.kind === 'window') return { moment: null, day: selection.date, part: selection.part };
  return { moment: null, day: null, part: null };
}

/** `v=vracht&t=2026-10-03T08:00` / `v=fiets&dag=2026-10-06` — empty for auto and "nu". */
export function mapContextQuery(mode: VehicleMode, selection: ForecastSelection): string {
  const params = new URLSearchParams();
  if (mode !== DEFAULT_VEHICLE_MODE) params.set('v', mode);
  setWhenParams(params, whenParamsOf(selection));
  return params.toString().replace(/%3A/g, ':');
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
export type MapQuestion = Pick<UrlState, 'mode' | 'time' | 'moment' | 'day' | 'part'>;

/**
 * Map road mode → /weg/<slug>/ with the same mode and moment or day: `?t=` for an exact moment,
 * `?dag=` (+ `&deel=`) for a picked date, and `vandaag` / `morgen`, which the road page opens as
 * that strip day. Other windows (weekend) have no single strip day and are left out rather than
 * approximated.
 */
export function roadPageHref(road: string, q: MapQuestion): string {
  const parts: string[] = [];
  if (q.mode !== DEFAULT_VEHICLE_MODE) parts.push(`v=${q.mode}`);
  if (q.moment !== null && Number.isFinite(q.moment)) parts.push(`t=${formatLocalDateTime(q.moment)}`);
  else if (q.day) parts.push(q.part ? `dag=${q.day}&deel=${q.part}` : `dag=${q.day}`);
  else if (q.time === 'vandaag' || q.time === 'morgen') parts.push(`t=${q.time}`);
  return withQuery(`/weg/${slugify(road)}/`, parts.join('&'));
}

/**
 * The day an entity page opens on: `?dag=` (+ `&deel=`), or the strip day of the map's
 * `?t=vandaag` / `?t=morgen`; null for "nu" and an exact moment (the block reads `moment` itself).
 */
export function dayFromUrl(url: Pick<UrlState, 'time' | 'moment' | 'day' | 'part'>, now: number): { date: string; part: UrlState['part'] } | null {
  if (url.moment !== null) return null;
  if (url.day) return { date: url.day, part: url.part };
  if (url.time !== 'vandaag' && url.time !== 'morgen') return null;
  return { date: localDateKey(startOfDay(now, url.time === 'morgen' ? 1 : 0)), part: null };
}
