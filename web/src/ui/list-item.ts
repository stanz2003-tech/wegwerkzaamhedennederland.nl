/**
 * Shared list-item component: used as <button> in the app panel and as <a href="/?id=…"> on the
 * generated pages. Badge · title · status line · tags (category with icon, place, hindrance).
 */
import type { IndexItem } from '../data/index';
import type { Category, Hindrance, ItemProperties, RoadType } from '../data/types';
import { roadBadge } from './badge';
import { CATEGORY_META } from './categories';
import { isLongRunning } from '../data/time';
import { LONG_RUNNING_LABEL_LOWER, LONG_RUNNING_TAG, esc, hindLabel, statusLine, subLabel } from './format';

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
  };
}

export interface ListItemOptions {
  /** Render as a link to this href instead of a button. */
  href?: string;
  selected?: boolean;
  /** Stagger index for the entrance animation (only the first few get one). */
  index?: number;
}

/** Place shown in the tags: woonplaats when it adds information beyond the title, else gemeente. */
export function placeTag(m: Pick<ListItemModel, 'title' | 'gemeente' | 'woonplaats'>): string | null {
  const t = m.title.toLowerCase();
  if (m.woonplaats && !t.includes(m.woonplaats.toLowerCase())) return m.woonplaats;
  if (m.gemeente && !t.includes(m.gemeente.toLowerCase())) return m.gemeente;
  return null;
}

export function renderListItem(m: ListItemModel, now: number, opts: ListItemOptions = {}): string {
  const meta = CATEGORY_META[m.cat];
  const span = { start: m.start, end: m.end };
  const status = statusLine(span, now);
  const tags: string[] = [];
  const sub = subLabel(m.sub);
  tags.push(
    `<span class="tag tag--cat" style="--tag-color: var(${meta.color})">${meta.icon}<span>${esc(sub && m.cat !== 'file' && m.cat !== 'incident' ? `${meta.label} · ${sub}` : sub ?? meta.label)}</span></span>`,
  );
  const place = placeTag(m);
  if (place) tags.push(`<span class="tag">${esc(place)}</span>`);
  const hind = hindLabel(m.hind);
  if (hind) tags.push(`<span class="tag tag--hind tag--hind-${m.hind}">${esc(hind)}</span>`);
  if (m.closed && m.cat !== 'afsluiting') tags.push(`<span class="tag tag--closed">dicht</span>`);
  // Explains why a high-severity item can rank low: it has been standing for months. Skipped
  // when the status line already says so in words, so the row never repeats itself.
  if (isLongRunning(span, now) && !status.text.toLowerCase().includes(LONG_RUNNING_LABEL_LOWER)) {
    tags.push(`<span class="tag tag--long" title="Deze maatregel loopt langer dan 90 dagen">${LONG_RUNNING_TAG}</span>`);
  }

  const tag = opts.href ? 'a' : 'button';
  const attrs = opts.href
    ? `href="${esc(opts.href)}"`
    : `type="button" aria-pressed="${opts.selected ? 'true' : 'false'}"`;
  const style = opts.index !== undefined && opts.index < 8 ? ` style="--i:${opts.index}"` : '';
  return `<${tag} class="item${opts.selected ? ' is-selected' : ''}" data-id="${esc(m.id)}" data-cat="${m.cat}" ${attrs}${style}>
    ${roadBadge(m.road, m.roadType, { place: m.woonplaats ?? m.gemeente })}
    <span class="item__body">
      <span class="item__title">${esc(m.title)}</span>
      <span class="item__status item__status--${status.kind}">${esc(status.text)}</span>
      <span class="item__tags">${tags.join('')}</span>
    </span>
    <span class="item__chevron" aria-hidden="true"></span>
  </${tag}>`;
}
