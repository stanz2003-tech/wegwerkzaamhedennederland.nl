/**
 * The moment of a question in words, for the answer card's question ("Kan ik woensdag
 * 30 september over de A27?"), the strip cells' aria-labels and the "Wanneer?" hint. One module
 * for the map panel and the entity pages, so both ask the same question the same way (vooruit-10).
 * Pure; unit-tested in web/test/when-words.test.mjs.
 */
import { DAY_PARTS, TIME_ZONE, dayWindow, startOfDay, timeWindowBounds, timeWindowRange, type DayPart, type TimeWindowId } from '../data/time';
import { fmtTime } from './format';

const LOCALE = 'nl-NL';
const dayLongFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' });
const weekdayShortFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'short' });

/** "woensdag 30 september" */
export function dayLong(ms: number): string {
  return dayLongFmt.format(ms).replace(',', '');
}

/** "zaterdag 3 oktober om 08:00" */
export function momentLong(ms: number): string {
  return `${dayLong(ms)} om ${fmtTime(ms)}`;
}

/** "vandaag" / "morgen" / "woensdag 30 september" for the day that starts at `dayStart`. */
export function relativeDayLong(dayStart: number, now: number): string {
  if (dayStart === startOfDay(now)) return 'vandaag';
  if (dayStart === startOfDay(now, 1)) return 'morgen';
  return dayLong(dayStart);
}

/** "ochtend (06:00–12:00)" */
export function partWords(part: DayPart): string {
  const p = DAY_PARTS.find((x) => x.id === part);
  if (!p) return part;
  const h = (n: number): string => `${String(n).padStart(2, '0')}:00`;
  return `${p.label.toLowerCase()} (${h(p.fromHour)}–${h(p.toHour)})`;
}

/** "woensdag 30 september" or "woensdag 30 september in de ochtend (06:00–12:00)"; '' for a bad date. */
export function dayQuestionWords(date: string, part: DayPart | null, now: number): string {
  const w = dayWindow(date);
  if (!w) return '';
  const day = relativeDayLong(w.from, now);
  return part ? `${day} in de ${partWords(part)}` : day;
}

function weekdayTime(ms: number): string {
  return `${weekdayShortFmt.format(ms).replace('.', '')} ${fmtTime(ms)}`;
}

/** "nu" / "vandaag" / "morgen" / "dit weekend (vr 20:00 – ma 06:00)" for a "Wanneer?" chip. */
export function windowQuestionWords(id: TimeWindowId, now: number): string {
  switch (id) {
    case 'nu':
      return 'nu';
    case 'vandaag':
      return 'vandaag';
    case 'morgen':
      return 'morgen';
    case 'weekend': {
      const { from, to } = timeWindowRange(id, now);
      const started = from > timeWindowBounds(id, now).from;
      return `dit weekend (${started ? 'nu' : weekdayTime(from)} – ${weekdayTime(to)})`;
    }
    default:
      return id === '7d' ? 'de komende 7 dagen' : 'de komende 30 dagen';
  }
}

/** The question itself: "Kan ik zaterdag 3 oktober om 08:00 over de A27?" (`when` from the helpers above). */
export function questionText(subject: { road?: string | null; subject?: string }, mode: 'auto' | 'vracht' | 'fiets', when: string): string {
  const at = when ? ` ${when}` : '';
  return subject.road ? `Kan ik${at} ${mode === 'fiets' ? 'langs' : 'over'} de ${subject.road}?` : `Kan ik${at} door ${subject.subject ?? 'dit gebied'}?`;
}
