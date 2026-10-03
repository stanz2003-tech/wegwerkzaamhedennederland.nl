/**
 * "Snelwegen dit weekend" at the top of /dit-weekend/ and /vandaag/ (overzicht-12): one line per
 * motorway with a closure in the window, with its worst verdict, where and when — so a reader
 * who wants to know about the A2 does not have to scroll past the streets of Venlo.
 *
 * Pure: the lines come from the same rows and the same verdict the list pills show. Only roads
 * with a "Weg dicht" or "Rijbaan dicht" row get a line; without any, the block is left out
 * rather than claiming that the motorways are open.
 */
import { roadKey } from '../data/entity';
import type { IndexItem } from '../data/index';
import { toMs } from '../data/time';
import { slugify } from '../data/types';
import { VERDICT_META, VERDICT_SEVERITY, type VerdictLevel } from '../data/verdict';
import { roadBadge } from './badge';
import { esc, fmtDayTime, fmtPeriodMs } from './format';
import { renderVerdictPill } from './verdict-pill';

export interface MotorwayLine {
  road: string;
  level: Extract<VerdictLevel, 'dicht' | 'rijbaan'>;
  /** "bij Vinkeveen", or '' when the row names no place. */
  place: string;
  /** "za 3 okt 22:00 – zo 4 okt 10:00" / "het hele weekend" / "tot zo 4 okt 18:00". */
  when: string;
  /** More closed rows on this road in the window than the one named. */
  more: boolean;
  href: string;
}

function isMotorway(it: IndexItem): boolean {
  if (it.roadType) return it.roadType === 'A';
  return (roadKey(it.road) ?? '').startsWith('A');
}

/**
 * When a row applies inside [from, to], clipped to the window. `whole` names the whole window
 * ("het hele weekend"). Recurring work gets "op bepaalde tijden": the index has no periods.
 */
export function whenInWindow(it: Pick<IndexItem, 'start' | 'end' | 'per'>, from: number, to: number, whole: string): string {
  const s = toMs(it.start);
  const endMs = toMs(it.end);
  const e = Number.isNaN(endMs) ? Number.POSITIVE_INFINITY : endMs;
  let text: string;
  if (s <= from && e >= to) text = whole;
  else if (s <= from) text = `tot ${fmtDayTime(e)}`;
  else if (e >= to) text = `vanaf ${fmtDayTime(s)}`;
  else text = fmtPeriodMs(s, e);
  return it.per ? `${text}, op bepaalde tijden` : text;
}

/** One line per motorway with a closure, "weg dicht" first, then by road number. */
export function motorwayLines(
  items: readonly IndexItem[],
  levelOf: (it: IndexItem) => VerdictLevel,
  window: { from: number; to: number },
  whole: string,
): MotorwayLine[] {
  const byRoad = new Map<string, { level: MotorwayLine['level']; rows: IndexItem[] }>();
  for (const it of items) {
    const level = levelOf(it);
    if (level !== 'dicht' && level !== 'rijbaan') continue;
    if (!isMotorway(it)) continue;
    const road = roadKey(it.road);
    if (!road) continue;
    const entry = byRoad.get(road);
    if (!entry) byRoad.set(road, { level, rows: [it] });
    else {
      entry.rows.push(it);
      if (VERDICT_SEVERITY.indexOf(level) < VERDICT_SEVERITY.indexOf(entry.level)) entry.level = level;
    }
  }
  const lines: MotorwayLine[] = [];
  for (const [road, { level, rows }] of byRoad) {
    // The row named is the first of the worst level to start: the one the reader meets first.
    const lead = rows.filter((it) => levelOf(it) === level).sort((a, b) => toMs(a.start) - toMs(b.start))[0] as IndexItem;
    const place = lead.woonplaats ?? lead.gemeente;
    lines.push({
      road,
      level,
      place: place ? `bij ${place}` : '',
      when: whenInWindow(lead, window.from, window.to, whole),
      more: rows.length > 1,
      href: `/weg/${slugify(road)}/`,
    });
  }
  const num = (r: string): number => Number(r.slice(1)) || 0;
  return lines.sort((a, b) => (a.level === b.level ? num(a.road) - num(b.road) : a.level === 'dicht' ? -1 : 1));
}

/** The block above the list; '' when no motorway has a closure. */
export function renderMotorwayBlock(title: string, lines: readonly MotorwayLine[]): string {
  if (lines.length === 0) return '';
  const rows = lines
    .map((l) => {
      const facts = [l.place, l.when, l.more ? 'en op meer plekken' : ''].filter((x) => x !== '').join(' · ');
      const pill = renderVerdictPill({ level: l.level, label: VERDICT_META[l.level].label }, { size: 'sm' });
      return `<li><a class="motorways__row" href="${esc(l.href)}">${roadBadge(l.road, 'A', { size: 'sm' })}<span class="motorways__text">${pill}<span class="motorways__facts">${esc(facts)}</span></span><span class="item__chevron" aria-hidden="true"></span></a></li>`;
    })
    .join('');
  return `<section class="motorways" aria-labelledby="motorways-title">
      <h2 class="entity-list__group-title" id="motorways-title">${esc(title)}</h2>
      <ul class="motorways__list">${rows}</ul>
    </section>`;
}
