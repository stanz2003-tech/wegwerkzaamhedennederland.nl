/**
 * The planned openings of a bridge page, grouped per day with their times. The page script
 * (pages/bridge.ts) and the build (scripts/lib/snapshot.mjs) render the list with the same
 * function, so the HTML holds the openings themselves and not only their count: on 2026-10-30 a
 * bridge page without script said "20 geplande openingen" and then mostly template text.
 * Pure, no DOM.
 */
import { MS, startOfDay, toMs } from '../data/time';
import type { BridgeEntry } from '../data/types';
import { esc, fmtDay, fmtDuration, fmtTime, plural } from './format';

export interface Opening {
  start: number;
  end: number;
}

/** The openings that are not over yet, sorted; with `days`, only those starting within that many days. */
export function parseOpenings(entry: Pick<BridgeEntry, 'openings'>, now: number, days?: number): Opening[] {
  const until = days === undefined ? Infinity : now + days * MS.day;
  const out: Opening[] = [];
  for (const pair of entry.openings ?? []) {
    const start = toMs(pair[0]);
    const end = toMs(pair[1]);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    if (end < now || start > until) continue;
    out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Vandaag", "Morgen" or "Za 13 sep"; only the date when the text must outlive the day. */
function dayLabel(ms: number, now: number, relative: boolean): string {
  const day = startOfDay(ms);
  if (relative && day === startOfDay(now)) return 'Vandaag';
  if (relative && day === startOfDay(now, 1)) return 'Morgen';
  return capitalise(fmtDay(ms));
}

export interface OpeningsHtmlOptions {
  /**
   * "Vandaag"/"Morgen" and the "nu open" mark (the page script). The build passes false: its HTML
   * is read for hours after it was made.
   */
  relativeDays?: boolean;
}

/** `<li>` per day for `#bridge-openings`; '' without openings. */
export function openingsHtml(openings: readonly Opening[], now: number, opts: OpeningsHtmlOptions = {}): string {
  const relative = opts.relativeDays !== false;
  const groups = new Map<number, Opening[]>();
  for (const o of openings) {
    const day = startOfDay(o.start);
    const list = groups.get(day);
    if (list) list.push(o);
    else groups.set(day, [o]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, list]) => {
      const rows = list
        .map((o) => {
          const duration = fmtDuration(o.end - o.start);
          const running = relative && o.start <= now && o.end >= now;
          return `<li class="bridge-openings__slot${running ? ' is-now' : ''}">
            <time datetime="${esc(new Date(o.start).toISOString())}">${esc(fmtTime(o.start))}</time>–<time datetime="${esc(new Date(o.end).toISOString())}">${esc(fmtTime(o.end))}</time>
            ${duration ? `<span class="bridge-openings__duration">${esc(duration)}</span>` : ''}
            ${running ? '<span class="bridge-openings__now">nu open</span>' : ''}
          </li>`;
        })
        .join('');
      return `<li class="bridge-openings__day">
        <h3 class="bridge-openings__day-title">${esc(dayLabel(day, now, relative))} <span class="bridge-openings__count">${esc(plural(list.length, 'opening', 'openingen'))}</span></h3>
        <ul class="bridge-openings__slots">${rows}</ul>
      </li>`;
    })
    .join('');
}
