/**
 * Shared list-item component: used as <button> in the app panel and as <a href="/?id=…"> on the
 * generated pages. Verdict-first:
 *   line 1  verdict pill + specifics ("Doorrijden mogelijk · 1 rijstrook dicht · tot 10 min")
 *   line 2  road badge + place/section + when ("nog 2 u 15 min" / "start za 13 sep 22:00")
 *   line 3  (muted) category icon + label + wegbeheerder
 */
import type { IndexItem } from '../data/index';
import type { Category, Hindrance, Impact, ItemProperties, RoadType, Vehicle } from '../data/types';
import { cleanVehicles, isImpact, verdictFor, type VehicleMode } from '../data/verdict';
import { roadBadge } from './badge';
import { CATEGORY_META } from './categories';
import { isLongRunning } from '../data/time';
import { LONG_RUNNING_TAG, esc, statusLine, subLabel, whenLabel } from './format';
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

export function renderListItem(m: ListItemModel, now: number, opts: ListItemOptions = {}): string {
  const meta = CATEGORY_META[m.cat];
  const span = { start: m.start, end: m.end };
  const status = statusLine(span, now);
  const at = opts.at ?? now;
  const verdict = verdictFor(m, opts.mode ?? 'auto', {
    periods: opts.periods ?? null,
    ...(opts.tl ? { tl: opts.tl } : {}),
    ...(opts.tlTo ? { tlTo: opts.tlTo } : {}),
    ...(opts.window ? { window: opts.window } : { now: at }),
    ...(opts.to ? { to: opts.to } : {}),
  });

  const where: string[] = [];
  if (opts.from && opts.to) where.push(`${opts.from} → ${opts.to}`);
  else where.push(sectionOf(m));
  const place = placeTag(m);
  if (place && !where.join(' ').toLowerCase().includes(place.toLowerCase())) where.push(place);

  const line3: string[] = [];
  const sub = subLabel(m.sub);
  line3.push(esc(sub && m.cat !== 'file' && m.cat !== 'incident' ? `${meta.label} · ${sub}` : (sub ?? meta.label)));
  if (m.src) line3.push(esc(m.src));
  if (isLongRunning(span, now)) line3.push(`<span class="tag tag--long" title="Deze maatregel loopt langer dan 90 dagen">${LONG_RUNNING_TAG}</span>`);

  const tag = opts.href ? 'a' : 'button';
  const attrs = opts.href
    ? `href="${esc(opts.href)}"`
    : `type="button" aria-pressed="${opts.selected ? 'true' : 'false'}"`;
  const style = opts.index !== undefined && opts.index < 8 ? ` style="--i:${opts.index}"` : '';
  const badge = m.road
    ? `<span class="item__badge" data-road="${esc(m.road)}" title="Alleen de ${esc(m.road)} tonen">${roadBadge(m.road, m.roadType, { size: 'sm', place: m.woonplaats ?? m.gemeente })}</span>`
    : roadBadge(null, m.roadType, { size: 'sm', place: m.woonplaats ?? m.gemeente });
  return `<${tag} class="item${opts.selected ? ' is-selected' : ''}" data-id="${esc(m.id)}" data-cat="${m.cat}" data-verdict="${verdict.level}" ${attrs}${style}>
    <span class="item__body">
      <span class="item__verdict">${renderVerdictPill(verdict, { size: 'sm' })}${verdict.detail ? `<span class="item__verdict-detail">${esc(verdict.detail)}</span>` : ''}</span>
      <span class="item__where">${badge}<span class="item__title">${esc(where.join(' · '))}</span><span class="item__when item__when--${status.kind}">${esc(whenLabel(span, now))}</span></span>
      <span class="item__meta" style="--tag-color: var(${meta.color})">${meta.icon}<span>${line3.join(' <span aria-hidden="true">·</span> ')}</span></span>
    </span>
    <span class="item__chevron" aria-hidden="true"></span>
  </${tag}>`;
}
