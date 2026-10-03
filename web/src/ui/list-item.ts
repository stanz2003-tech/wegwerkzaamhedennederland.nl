/**
 * Shared list-item component: used as <button> in the app panel and as <a href="/?id=…"> on the
 * generated pages. Verdict-first, two lines so a list of dozens can be scanned (overzicht-8):
 *   line 1  verdict pill + road badge + section ("Rijbaan dicht [A27] Lunetten → Nieuwegein · Houten")
 *   line 2  category icon (named for screen readers) + when + "richting X" + the verdict detail
 *           ("nog 2 u 15 min · richting Utrecht · 1 rijstrook dicht · max 70 km/u")
 * The wegbeheerder is in the detail only; the category no longer repeats the pill in words.
 */
import type { IndexItem } from '../data/index';
import { midpointOf } from '../data/filter';
import type { Category, Hindrance, Impact, ItemFeature, ItemProperties, RoadType, Vehicle } from '../data/types';
import { cleanVehicles, isImpact, verdictFor, type Verdict, type VehicleMode } from '../data/verdict';
import { roadBadge } from './badge';
import { CATEGORY_META } from './categories';
import { esc, statusLine, subLabel, whenLabel } from './format';
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
  /** Representative point [lon, lat] when known: lets the list fold one street's parts (ui/list-group.ts). */
  pos?: readonly [number, number] | null;
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
    pos: it.lon === 0 && it.lat === 0 ? null : [it.lon, it.lat],
  };
}

/** The model of a map feature, with the midpoint of its geometry as its position. */
export function modelFromFeature(f: ItemFeature): ListItemModel {
  return { ...modelFromProps(f.properties), pos: midpointOf(f.geometry) };
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
  /** Replaces the when text (a grouped row lists the dates of its members, ui/list-group.ts). */
  whenText?: string;
  /** A short extra on line 2 ("3 delen van deze straat"). */
  note?: string;
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

/** "Afsluiting · rijbaan afgesloten": what the category icon stands for, for its title and screen readers. */
export function categoryName(m: Pick<ListItemModel, 'cat' | 'sub'>): string {
  const label = CATEGORY_META[m.cat].label;
  const sub = subLabel(m.sub);
  if (!sub) return label;
  return m.cat === 'file' || m.cat === 'incident' ? sub.charAt(0).toUpperCase() + sub.slice(1) : `${label} · ${sub}`;
}

/** "richting Utrecht" when the detail names a direction that neither the section nor the verdict already says. */
function directionText(verdict: Verdict, opts: ListItemOptions): string | null {
  if (!opts.to || opts.from) return null;
  const text = `richting ${opts.to}`;
  return (verdict.detail ?? '').includes(text) ? null : text;
}

export function renderListItem(m: ListItemModel, now: number, opts: ListItemOptions = {}): string {
  const meta = CATEGORY_META[m.cat];
  const span = { start: m.start, end: m.end };
  const status = statusLine(span, now);
  const verdict = listItemVerdict(m, now, opts);

  const where: string[] = [];
  if (opts.from && opts.to) where.push(`${opts.from} → ${opts.to}`);
  else where.push(sectionOf(m));
  const place = placeTag(m);
  if (place && !where.join(' ').toLowerCase().includes(place.toLowerCase())) where.push(place);
  const whereText = where.join(' · ');

  const sep = ' <span aria-hidden="true">·</span> ';
  const line2: string[] = [`<span class="item__when item__when--${status.kind}">${esc(opts.whenText ?? whenLabel(span, now))}</span>`];
  const dir = directionText(verdict, opts);
  if (dir) line2.push(`<span>${esc(dir)}</span>`);
  if (verdict.detail) line2.push(`<span class="item__verdict-detail">${esc(verdict.detail)}</span>`);
  if (opts.note) line2.push(`<span class="item__note">${esc(opts.note)}</span>`);
  const cat = categoryName(m);

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
      <span class="item__where">${renderVerdictPill(verdict, { size: 'sm' })}${badge}<span class="item__title" title="${esc(whereText)}">${esc(whereText)}</span></span>
      <span class="item__meta"><span class="item__cat" title="${esc(cat)}">${meta.icon}<span class="sr-only">${esc(cat)}</span></span><span class="item__facts">${line2.join(sep)}</span></span>
    </span>
    <span class="item__chevron" aria-hidden="true"></span>
  </${tag}>`;
}
