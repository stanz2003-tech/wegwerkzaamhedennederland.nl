/**
 * Window semantics and Dutch wording of the four data-driven list pages (/afsluitingen/,
 * /files/, /vandaag/, /dit-weekend/). Pure: no DOM, no fetch, so `web/test/` can assert on the
 * exact sentences a reader gets.
 *
 * Every one of these pages answers "what happens in this window?", and the honest answer has
 * two halves. `changes` are the measures that start, end or have a sub-period inside the window
 * — the news. `background` are the semi-permanent measures (longer than 90 days) that were
 * already there before the window and are still there after it. Reporting them together is what
 * made /dit-weekend/ claim 4.544 meldingen "nu actief" for a weekend, so they are counted, named
 * and shown separately.
 */
import type { TimeWindowId } from '../data/time';
import { backgroundPhrase, formatCount, plural, windowSummary } from './format';

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
    active: 'Nu actief',
    upcoming: 'Dit weekend gepland',
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

/**
 * The one line under the heading. It names every number it prints, so "34 meldingen dit weekend"
 * can never again be read as "34 things are happening right now".
 */
export function listSummary(id: DataList, counts: ListCounts): string {
  switch (id) {
    case 'afsluitingen':
      return closuresSummary(counts);
    case 'files':
      return filesSummary(counts);
    case 'vandaag':
      return windowSummary(counts, 'vandaag');
    case 'weekend':
      return windowSummary(counts, 'dit weekend');
  }
}
