/**
 * Shared list-item component: used as <button> in the app panel and as <a href="/?id=…"> on the
 * generated pages. Verdict-first:
 *   line 1  verdict pill + specifics ("Doorrijden mogelijk · 1 rijstrook dicht · tot 10 min")
 *   line 2  road badge + place/section + when ("tot di 29 sep 05:00" / "begint za 13 sep 22:00"),
 *           from the chosen moment or day when the reader looks ahead (data/time-phrase.ts)
 *   line 3  (muted) category icon + label + wegbeheerder
 */
import type { ForecastItem } from '../data/forecast';
import type { IndexItem } from '../data/index';
import { phraseAt, phraseIn } from '../data/time-phrase';
import type { Category, Hindrance, Impact, ItemDetail, ItemProperties, RoadType, Vehicle } from '../data/types';
import { cleanVehicles, isImpact, verdictFor, type Verdict, type VehicleMode } from '../data/verdict';
import { roadBadge } from './badge';
import { CATEGORY_META } from './categories';
import { isLongRunning } from '../data/time';
import { LONG_RUNNING_TAG, esc, kindLabel, statusLine, whenLabel } from './format';
import { renderVerdictPill } from './verdict-pill';

export interface ListItemModel {
  id: string;
  cat: Category;
  sub: string | null;
  sev: number;
  title: string;
  road: string | null;
  roadType: RoadType | null;
  gemeente: string | null;
  woonplaats: string | null;
  start: string;
  end: string | null;
  closed: boolean;
  hind: Hindrance | null;
  src: string | null;
  /** Contract v3 impact data (v2: `onbekend`, nulls). */
  imp: Impact;
  veh: Vehicle[] | null;
  per: boolean;
  spd: number | null;
  lc: number | null;
}

export function modelFromProps(p: ItemProperties): ListItemModel {
  return {
    id: p.id,
    cat: p.cat,
    sub: p.sub ?? null,
    sev: p.sev,
    title: p.title,
    road: p.road ?? null,
    roadType: p.roadType ?? null,
    gemeente: p.gemeente ?? null,
    woonplaats: p.woonplaats ?? null,
    start: p.start,
    end: p.end ?? null,
    closed: p.closed === true,
    hind: p.hind ?? null,
    src: p.src,
    imp: isImpact(p.imp) ? p.imp : 'onbekend',
    veh: cleanVehicles(p.veh),
    per: p.per === true,
    spd: typeof p.spd === 'number' ? p.spd : null,
    lc: typeof p.lc === 'number' ? p.lc : null,
  };
}

export function modelFromIndexItem(it: IndexItem): ListItemModel {
  return {
    id: it.id,
    cat: it.cat,
    sub: it.sub,
    sev: it.sev,
    title: it.title,
    road: it.road,
    roadType: it.roadType,
    gemeente: it.gemeente,
    woonplaats: it.woonplaats,
    start: it.start,
    end: it.end,
    closed: it.closed,
    hind: it.hind,
    src: null,
    imp: it.imp,
    veh: it.veh,
    per: it.per,
    spd: it.spd,
    lc: it.lc,
  };
}

export interface ListItemOptions {
  /** Render as a link to this href instead of a button. */
  href?: string;
  selected?: boolean;
  /** Stagger index for the entrance animation (only the first few get one). */
  index?: number;
  /** Vehicle mode the verdict pill is computed for (default: auto). */
  mode?: VehicleMode;
  /** Recurring periods when the caller has them (EntityFile / detail shard). */
  periods?: readonly (readonly [string, string])[] | null;
  /** Direction / section from the detail, when known. */
  to?: string;
  from?: string;
  /** The moment the verdict is asked for (period check); defaults to `now`. */
  at?: number;
  /** A window instead of a moment (a day picked in the strip); wins over `at`. */
  window?: { from: number; to: number };
  /** Contract v4 timeline and its horizon, when the caller has the detail. */
  tl?: unknown;
  tlTo?: string;
  /**
   * The "when" text, when the caller has worded it already. Without it the row words it itself:
   * from the chosen moment or day (`at` / `window`) when that is not now, else from now.
   */
  whenText?: string;
}

/** Place shown next to the section: woonplaats when it adds information beyond the title, else gemeente. */
export function placeTag(m: Pick<ListItemModel, 'title' | 'gemeente' | 'woonplaats'>): string | null {
  const t = m.title.toLowerCase();
  if (m.woonplaats && !t.includes(m.woonplaats.toLowerCase())) return m.woonplaats;
  if (m.gemeente && !t.includes(m.gemeente.toLowerCase())) return m.gemeente;
  return null;
}

/** "Vinkeveen → Holendrecht" from "A2 · Vinkeveen → Holendrecht"; the full title otherwise. */
export function sectionOf(m: Pick<ListItemModel, 'title' | 'road'>): string {
  if (m.road) {
    const prefix = `${m.road} · `;
    if (m.title.toLowerCase().startsWith(prefix.toLowerCase())) return m.title.slice(prefix.length).trim();
  }
  return m.title;
}

/**
 * The verdict a row's pill shows. Exported so a list can order or batch its rows by exactly the
 * pill the reader will see, never by a verdict computed some other way.
 */
export function listItemVerdict(m: ListItemModel, now: number, opts: ListItemOptions = {}): Verdict {
  return verdictFor(m, opts.mode ?? 'auto', {
    periods: opts.periods ?? null,
    ...(opts.tl ? { tl: opts.tl } : {}),
    ...(opts.tlTo ? { tlTo: opts.tlTo } : {}),
    ...(opts.window ? { window: opts.window } : { now: opts.at ?? now }),
    ...(opts.to ? { to: opts.to } : {}),
  });
}

/** The row as the time-phrase module reads it: the same inputs the pill's verdict uses. */
function forecastItemOf(m: ListItemModel, opts: ListItemOptions): ForecastItem {
  const d = {
    ...(opts.periods ? { periods: opts.periods } : {}),
    ...(opts.tl ? { tl: opts.tl } : {}),
    ...(opts.tlTo ? { tlTo: opts.tlTo } : {}),
    ...(opts.to ? { to: opts.to } : {}),
  };
  const properties = { ...m, sub: m.sub ?? undefined, end: m.end ?? undefined } as unknown as ItemProperties;
  return { f: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties }, d: Object.keys(d).length > 0 ? (d as ItemDetail) : null };
}

/** Within a minute of now counts as now (the panel passes `at = now` for "Nu"). */
const SAME_MOMENT_MS = 60_000;

/**
 * The row's "when" (vooruit-3, taal-3): with a day picked, the stretches of that day ("wo 30 sep
 * 20:00–05:00", "hele dag"); at a chosen moment, how long what applies then lasts ("tot za 3 okt
 * 10:00"); otherwise the clock-time label from now. Falls back to the span label from the chosen
 * moment when the phrase has nothing to say.
 */
function rowWhen(m: ListItemModel, now: number, opts: ListItemOptions): { text: string; ref: number } {
  const span = { start: m.start, end: m.end };
  const mode = opts.mode ?? 'auto';
  if (opts.window) {
    const text = opts.whenText ?? phraseIn(forecastItemOf(m, opts), mode, opts.window.from, opts.window.to);
    return { text: text || whenLabel(span, opts.window.from), ref: opts.window.from };
  }
  const at = opts.at ?? now;
  if (opts.whenText !== undefined) return { text: opts.whenText, ref: at };
  if (Math.abs(at - now) < SAME_MOMENT_MS) return { text: whenLabel(span, now), ref: now };
  return { text: phraseAt(forecastItemOf(m, opts), mode, at) || whenLabel(span, at), ref: at };
}

export function renderListItem(m: ListItemModel, now: number, opts: ListItemOptions = {}): string {
  const meta = CATEGORY_META[m.cat];
  const span = { start: m.start, end: m.end };
  const when = rowWhen(m, now, opts);
  const status = statusLine(span, when.ref);
  const verdict = listItemVerdict(m, now, opts);

  const where: string[] = [];
  if (opts.from && opts.to) where.push(`${opts.from} → ${opts.to}`);
  else where.push(sectionOf(m));
  const place = placeTag(m);
  if (place && !where.join(' ').toLowerCase().includes(place.toLowerCase())) where.push(place);

  const line3: string[] = [];
  line3.push(esc(kindLabel(m.cat, m.sub, { spd: m.spd })));
  if (m.src) line3.push(esc(m.src));
  if (isLongRunning(span, now)) line3.push(`<span class="tag tag--long" title="Deze maatregel loopt langer dan 90 dagen">${LONG_RUNNING_TAG}</span>`);

  const tag = opts.href ? 'a' : 'button';
  // A row opens the details; it is not a toggle, so no aria-pressed ("schakelknop, niet
  // ingedrukt" on every row). The open row is marked current instead (toeg-13).
  const attrs = opts.href ? `href="${esc(opts.href)}"` : `type="button"${opts.selected ? ' aria-current="true"' : ''}`;
  const style = opts.index !== undefined && opts.index < 8 ? ` style="--i:${opts.index}"` : '';
  const badge = m.road
    ? `<span class="item__badge" data-road="${esc(m.road)}" title="Alleen de ${esc(m.road)} tonen">${roadBadge(m.road, m.roadType, { size: 'sm', place: m.woonplaats ?? m.gemeente })}</span>`
    : roadBadge(null, m.roadType, { size: 'sm', place: m.woonplaats ?? m.gemeente });
  return `<${tag} class="item${opts.selected ? ' is-selected' : ''}" data-id="${esc(m.id)}" data-cat="${m.cat}" data-verdict="${verdict.level}" ${attrs}${style}>
    <span class="item__body">
      <span class="item__verdict">${renderVerdictPill(verdict, { size: 'sm' })}${verdict.detail ? `<span class="item__verdict-detail">${esc(verdict.detail)}</span>` : ''}</span>
      <span class="item__where">${badge}<span class="item__title">${esc(where.join(' · '))}</span><span class="item__when item__when--${status.kind}">${esc(when.text)}</span></span>
      <span class="item__meta">${meta.icon}<span>${line3.join(' <span aria-hidden="true">·</span> ')}</span></span>
    </span>
    <span class="item__chevron" aria-hidden="true"></span>
  </${tag}>`;
}
