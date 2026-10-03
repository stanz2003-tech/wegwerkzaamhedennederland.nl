/**
 * Window semantics and Dutch wording of the four data-driven list pages (/afsluitingen/,
 * /files/, /vandaag/, /dit-weekend/). Pure: no DOM, no fetch, so `web/test/` can assert on the
 * exact sentences a reader gets.
 *
 * Every one of these pages answers "what happens in this window?", and the honest answer has
 * two halves. `changes` are the measures that start, end or have a sub-period inside the window
 * — the news. `background` are the semi-permanent measures (longer than 90 days) that were
 * already there before the window and are still there after it. Reporting them together is what
 * made /dit-weekend/ claim 4.544 meldingen "nu actief" for a weekend, so they are shown
 * separately. /vandaag/ and /dit-weekend/ no longer count at all ("1.727 meldingen dit weekend ·
 * 1.129 nu al actief · 3.906 langdurige …" told a driver nothing, taal-11): their line says what
 * the list is, and the list leads with the closures, motorways first (overzicht-12).
 */
import type { RoadType } from '../data/types';
import type { TimeWindowId } from '../data/time';
import { VERDICT_SEVERITY, type VerdictLevel } from '../data/verdict';
import { windowListIntro } from './copy';
import { backgroundPhrase, formatCount, plural } from './format';

export type DataList = 'afsluitingen' | 'files' | 'vandaag' | 'weekend';

/** Horizon of the closures page, in days (matches the bounds of the `7d` window). */
export const SOON_DAYS = 7;

/** Heading of the collapsed group that holds the background measures. */
export const BACKGROUND_TITLE = 'Loopt al langer';

/** What a page counted after the window split. `changes` = `active` + `upcoming`. */
export interface ListCounts {
  changes: number;
  active: number;
  upcoming: number;
  background: number;
}

/**
 * The window whose *calendar* bounds decide what counts as a change on each page.
 * `nu` has the bounds [now, now]: for /files/ everything that runs right now is news, unless it
 * has been standing for over 90 days — that is a stale record, not a traffic jam.
 */
export const LIST_WINDOW: Record<DataList, TimeWindowId> = {
  afsluitingen: '7d',
  files: 'nu',
  vandaag: 'vandaag',
  weekend: 'weekend',
};

export interface ListTitles {
  active: string;
  /** Empty when the page has no "upcoming" group (files are never planned). */
  upcoming: string;
  /** One sentence explaining the collapsed background group. */
  backgroundNote: string;
}

export const LIST_TITLES: Record<DataList, ListTitles> = {
  afsluitingen: {
    active: 'Nu afgesloten',
    upcoming: `Binnenkort afgesloten (komende ${SOON_DAYS} dagen)`,
    backgroundNote: `Deze afsluitingen liggen er al langer dan drie maanden en veranderen de komende ${SOON_DAYS} dagen niet.`,
  },
  files: {
    active: 'Files op dit moment',
    upcoming: '',
    backgroundNote: 'Deze meldingen staan al langer dan drie maanden open; dat is geen actuele file.',
  },
  vandaag: {
    active: 'Nu actief',
    upcoming: 'Start later vandaag',
    backgroundNote: 'Deze maatregelen liepen vandaag al voor het eerste uur en lopen morgen door.',
  },
  weekend: {
    active: 'Loopt al en duurt dit weekend door',
    upcoming: 'Begint dit weekend',
    backgroundNote: 'Deze maatregelen liepen al voor vrijdagavond 20:00 en lopen na maandagochtend 06:00 door.',
  },
};

function closuresSummary({ active, upcoming, background }: ListCounts): string {
  if (active === 0 && upcoming === 0 && background === 0) return 'Op dit moment zijn er geen afsluitingen gemeld';
  const parts: string[] = [active > 0 ? `${plural(active, 'afsluiting', 'afsluitingen')} nu dicht` : 'Nu niets afgesloten'];
  if (upcoming > 0) parts.push(`${formatCount(upcoming)} start binnen ${SOON_DAYS} dagen`);
  if (background > 0) parts.push(backgroundPhrase(background));
  return parts.join(' · ');
}

function filesSummary({ active, background }: ListCounts): string {
  if (active === 0 && background === 0) return 'Op dit moment zijn er geen files gemeld';
  const parts: string[] = [active > 0 ? `${plural(active, 'file', 'files')} op dit moment` : 'Op dit moment geen files'];
  if (background > 0) parts.push(backgroundPhrase(background));
  return parts.join(' · ');
}

/** "Hieronder wat dit weekend dicht of beperkt is, …", or that nothing has been announced yet. */
function windowLine({ changes, background }: ListCounts, label: string): string {
  if (changes === 0 && background === 0) return `Er is nog niets aangemeld voor ${label}`;
  return windowListIntro(label);
}

/**
 * The one line under the heading. The closures and files pages name every number they print, so
 * "34 afsluitingen" can never be read as something else; the window pages print no numbers.
 */
export function listSummary(id: DataList, counts: ListCounts): string {
  switch (id) {
    case 'afsluitingen':
      return closuresSummary(counts);
    case 'files':
      return filesSummary(counts);
    case 'vandaag':
      return windowLine(counts, 'vandaag');
    case 'weekend':
      return windowLine(counts, 'dit weekend');
  }
}

/** Title of the motorway block on the window pages. */
export const MOTORWAY_TITLES: Partial<Record<DataList, { title: string; whole: string }>> = {
  vandaag: { title: 'Snelwegen vandaag', whole: 'de hele dag' },
  weekend: { title: 'Snelwegen dit weekend', whole: 'het hele weekend' },
};

/** A > E > N > S > local: the bigger the road, the more readers it concerns. */
const ROAD_RANK: Record<RoadType, number> = { A: 0, E: 1, N: 2, S: 3, lokaal: 4 };

function roadRank(t: RoadType | null): number {
  return t ? ROAD_RANK[t] : ROAD_RANK.lokaal;
}

/**
 * Order of the window pages: the closures first ("Weg dicht" and "Rijbaan dicht" together, so a
 * closed motorway is not pushed below a hundred closed side streets), then every lighter level in
 * severity order; inside each, the bigger road first, then the heavier level, then the start.
 * Only the order changes: every row keeps the pill `levelOf` gives it.
 */
export function windowOrder<T extends { id: string; roadType: RoadType | null; start: string }>(
  items: readonly T[],
  levelOf: (it: T) => VerdictLevel,
): T[] {
  const level = new Map(items.map((it) => [it.id, VERDICT_SEVERITY.indexOf(levelOf(it))]));
  const closedRank = VERDICT_SEVERITY.indexOf('rijbaan');
  const tier = (it: T): number => Math.max(level.get(it.id) ?? VERDICT_SEVERITY.length, closedRank);
  const start = (it: T): number => {
    const ms = Date.parse(it.start);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return [...items].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      roadRank(a.roadType) - roadRank(b.roadType) ||
      (level.get(a.id) ?? 0) - (level.get(b.id) ?? 0) ||
      start(a) - start(b) ||
      a.id.localeCompare(b.id),
  );
}
