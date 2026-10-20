/**
 * The content of the data-driven list pages (/afsluitingen/, /files/, /vandaag/, /dit-weekend/)
 * for a set of index rows: the summary line, the sections and the motorway block. Shared by the
 * page script (pages/list.ts) and the build, which writes the first rows into the HTML
 * (scripts/lib/snapshot.mjs). Pure, no DOM.
 */
import { compareImpact, compareStart } from '../data/entity';
import { groupByWindow } from '../data/filter';
import type { IndexItem } from '../data/index';
import { MEDIUM_RUN_MS, timeWindowBounds, toMs } from '../data/time';
import type { VerdictLevel } from '../data/verdict';
import { rowVerdict, type EntitySection } from './entity-list';
import { BACKGROUND_TITLE, LIST_TITLES, LIST_WINDOW, MOTORWAY_TITLES, listSummary, windowOrder, type DataList, type ListCounts } from './list-summary';
import { motorwayLines, renderMotorwayBlock } from './motorway-block';

/** Which items a list page shows. */
export const LIST_MATCH: Record<DataList, (it: IndexItem) => boolean> = {
  afsluitingen: (it) => it.cat === 'afsluiting' || it.closed,
  files: (it) => it.cat === 'file',
  vandaag: () => true,
  weekend: () => true,
};

export interface ListView {
  counts: ListCounts;
  summary: string;
  sections: EntitySection[];
  /** The motorway block above the list on /vandaag/ and /dit-weekend/; '' elsewhere. */
  motorwayHtml: string;
  /** Extra query on every row link (`cat=file` on /files/). */
  linkQuery?: string;
}

export function listView(id: DataList, rows: readonly IndexItem[], now: number): ListView {
  const matched = rows.filter((it) => {
    if (!LIST_MATCH[id](it)) return false;
    const end = toMs(it.end);
    // Anything that is already over is not news for any window.
    return Number.isNaN(end) || end >= now;
  });

  // What actually happens inside the window, separated from the semi-permanent measures that
  // merely overlap it. Without this split every years-long width restriction that happens to
  // cross Friday 20:00 was reported as "nu actief" — 4.544 of them for one weekend.
  // "Vandaag" and "dit weekend" answer "what happens then", so a measure that has already stood
  // for a month belongs in the collapsed background group rather than at the top of the page.
  // The broader 7-day and "nu" lists keep the 90-day default.
  const longRunMs = id === 'vandaag' || id === 'weekend' ? MEDIUM_RUN_MS : undefined;
  const groups = groupByWindow(matched, LIST_WINDOW[id], now, { longRunMs });
  const active = groups.changes.filter((it) => it.active).sort((a, b) => compareImpact(a, b, now));
  const upcoming = groups.changes.filter((it) => !it.active).sort(compareStart);
  const background = [...groups.background].sort((a, b) => compareImpact(a, b, now));
  // Today and the weekend lead with the closures, motorways first, as their intro promises
  // (overzicht-12); the pill each row shows decides, so the order can never disagree with it.
  const motorway = MOTORWAY_TITLES[id];
  const levelOf = (it: IndexItem): VerdictLevel => rowVerdict(it, now).level;
  const activeRows = motorway ? windowOrder(active, levelOf) : active;
  const upcomingRows = motorway ? windowOrder(upcoming, levelOf) : upcoming;

  const counts: ListCounts = {
    changes: groups.changes.length,
    active: active.length,
    upcoming: upcoming.length,
    background: background.length,
  };
  const titles = LIST_TITLES[id];
  const sections: EntitySection[] = [{ title: titles.active, items: activeRows }];
  if (titles.upcoming) sections.push({ title: titles.upcoming, items: upcomingRows });
  sections.push({ title: BACKGROUND_TITLE, items: background, collapsed: true, note: titles.backgroundNote });
  const motorwayHtml = motorway
    ? renderMotorwayBlock(motorway.title, motorwayLines([...activeRows, ...upcomingRows, ...background], levelOf, timeWindowBounds(LIST_WINDOW[id], now), motorway.whole, now))
    : '';
  return { counts, summary: listSummary(id, counts), sections, motorwayHtml, ...(id === 'files' ? { linkQuery: 'cat=file' } : {}) };
}
