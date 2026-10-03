/**
 * Time phrases: "tot za 3 okt 10:00", "begint vr 2 okt 22:00", "wo 30 sep 20:00–05:00" — when a
 * measure bites, said from the moment or the window the reader asked about, never from "now".
 * The answer card, the list rows and the detail banner all take their time words from here, so
 * they cannot contradict each other.
 *
 * Safety: a phrase that names an end can suggest a reopening. So
 *   - for a closure the end is the end of the run of back-to-back stretches that are as heavy as
 *     the asked one or heavier ("dicht, then dicht again" ends where the second one ends);
 *   - a lighter verdict never reaches past a heavier stretch: "doorrijden mogelijk tot vr 22:00,
 *     daarna weg dicht", not "tot zo 06:00" with the closure hidden inside;
 *   - nothing past `tlTo` (where the working times stop being known) is stated as an end;
 *   - without a timeline or periods the end is the end of the whole item: the latest possible
 *     end, so the map (which has no detail, `d: null`) errs on the late side.
 * An end that is not known is said as unknown; nothing is guessed.
 *
 * Labels only: every level comes from `itemVerdict`, unchanged. Pure; unit-tested in
 * web/test/time-phrase.test.mjs.
 */
import { itemVerdict, periodsOf, type ForecastItem } from './forecast';
import { itemInterval, toMs, zonedParts } from './time';
import { parseTimeline, segmentAt, segmentsIn, type TimeSegment } from './timeline';
import { VERDICT_SEVERITY, type VehicleMode, type VerdictLevel } from './verdict';

/** Said when the wegbeheerder gave no end. */
export const OPEN_END_PHRASE = 'einde niet opgegeven';

/** Two stretches closer than this are back-to-back (the pipeline cuts at whole minutes). */
const TOUCH_MS = 60_000;
const DAY_MS = 86_400_000;
/** A window up to this long is "a day" (a day cell, "vandaag"); 25 h covers the DST day. */
const DAY_WINDOW_MS = 25 * 3_600_000;

// Kept local: data/ modules do not import from ui/ (verdict.ts and answer.ts do the same).
// The output matches ui/format.ts fmtDayTime / fmtDay / fmtTime.
const TZ = 'Europe/Amsterdam';
const DAY_TIME_FMT = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const DAY_FMT = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const TIME_FMT = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

function clean(s: string): string {
  return s.replace(/\./g, '').replace(/,\s*/g, ' ').replace(' om ', ' ').trim();
}

/** "za 3 okt 10:00" */
export function dayTimeLabel(ms: number): string {
  return clean(DAY_TIME_FMT.format(ms));
}

function dayLabel(ms: number): string {
  return clean(DAY_FMT.format(ms));
}

function clockLabel(ms: number): string {
  return TIME_FMT.format(ms);
}

function severity(level: VerdictLevel): number {
  return VERDICT_SEVERITY.indexOf(level);
}

function isClosure(level: VerdictLevel): boolean {
  return level === 'dicht' || level === 'rijbaan';
}

/**
 * What holds from a moment on, before it is worded:
 *   until    the run ends at `end` (before `tlTo`); `after` names what follows back-to-back
 *   atLeast  the run reaches `tlTo`: closed at least until then, unknown after it
 *   open     the run has no end
 *   starts   the measure does not bite at the moment; it begins at `at`
 * null when nothing true can be said (over, or past what the timeline knows).
 */
export type TimeFact =
  | { kind: 'until'; end: number; after: string | null }
  | { kind: 'atLeast'; until: number }
  | { kind: 'open' }
  | { kind: 'starts'; at: number }
  | null;

function endFact(end: number, knownUntil: number, after: string | null): TimeFact {
  if (!Number.isFinite(end)) return { kind: 'open' };
  if (Number.isFinite(knownUntil) && end >= knownUntil) return { kind: 'atLeast', until: knownUntil };
  return { kind: 'until', end, after };
}

/** The stretch that starts where `end` is, if any (never one that ends before it). */
function touching(segments: readonly TimeSegment[], end: number): TimeSegment | undefined {
  return segments.find((s) => Math.abs(s.start - end) < TOUCH_MS && s.end > end);
}

function timelineAt(item: ForecastItem, mode: VehicleMode, at: number, segments: readonly TimeSegment[], knownUntil: number): TimeFact {
  // Past tlTo the verdict itself says "Nog niet bekend · de werktijden zijn bekend tot …".
  if (Number.isFinite(knownUntil) && at >= knownUntil) return null;
  const seg = segmentAt(segments, at);
  if (!seg) {
    // In a gap: the next stretch that concerns this mode, else simply the next one.
    const later = segments.filter((s) => s.start >= at);
    const next = later.find((s) => itemVerdict(item, mode, s.start).level !== 'nvt') ?? later[0];
    return next ? { kind: 'starts', at: next.start } : null;
  }
  const level = itemVerdict(item, mode, at).level;
  let end = seg.end;
  let after: string | null = null;
  while (Number.isFinite(end) && !(Number.isFinite(knownUntil) && end >= knownUntil)) {
    const next = touching(segments, end);
    if (!next) break;
    const v = itemVerdict(item, mode, Math.max(next.start, end));
    // Same level: one run. Heavier after a closure: still closed, so the run goes on (saying
    // "tot X" there would suggest a reopening). Anything else ends the run and is named; a
    // heavier stretch after a lighter one is never swallowed by it.
    const merge = v.level === level || (isClosure(level) && severity(v.level) < severity(level));
    if (!merge) {
      after = v.label.toLowerCase();
      break;
    }
    end = next.end;
  }
  return endFact(end, knownUntil, after);
}

function spanAt(item: ForecastItem, at: number, knownUntil: number): TimeFact {
  const { start, end } = itemInterval(item.f.properties);
  if (at < start) return { kind: 'starts', at: start };
  if (at > end) return null;
  const periods = periodsOf(item);
  if (periods.length === 0) return endFact(end, knownUntil, null);
  const inside = periods.find((p) => p.start <= at && at <= p.end);
  if (!inside) {
    const next = periods.find((p) => p.start > at);
    return next ? { kind: 'starts', at: next.start } : null;
  }
  const following = (stop: number): (typeof periods)[number] | undefined => periods.find((x) => Math.abs(x.start - stop) < TOUCH_MS && x.end > stop);
  let stop = inside.end;
  for (let p = following(stop); p; p = following(stop)) stop = p.end;
  return endFact(stop, knownUntil, null);
}

/** What holds at `at` for this mode; see `TimeFact`. */
export function factAt(item: ForecastItem, mode: VehicleMode, at: number): TimeFact {
  const segments = parseTimeline(item.d?.tl);
  const knownUntil = toMs(item.d?.tlTo ?? null);
  return segments.length > 0 ? timelineAt(item, mode, at, segments, knownUntil) : spanAt(item, at, knownUntil);
}

/** The words for a `TimeFact`; '' for null. */
export function factPhrase(fact: TimeFact): string {
  if (!fact) return '';
  switch (fact.kind) {
    case 'open':
      return OPEN_END_PHRASE;
    case 'starts':
      return `begint ${dayTimeLabel(fact.at)}`;
    case 'atLeast':
      return `tot minstens ${dayTimeLabel(fact.until)}, daarna nog niet bekend`;
    default:
      return `tot ${dayTimeLabel(fact.end)}${fact.after ? `, daarna ${fact.after}` : ''}`;
  }
}

/**
 * How long what applies at `at` lasts: "tot za 3 okt 10:00", "tot za 3 okt 10:00, daarna
 * doorrijden mogelijk", "tot minstens …, daarna nog niet bekend", "einde niet opgegeven", or
 * "begint vr 2 okt 22:00" when the measure does not bite at `at` yet. '' when nothing true can
 * be said (over, or past what the timeline knows).
 */
export function phraseAt(item: ForecastItem, mode: VehicleMode, at: number): string {
  return factPhrase(factAt(item, mode, at));
}

/* ---------------------------------- windows ---------------------------------- */

interface Stretch {
  start: number;
  end: number;
}

function mergeStretches(list: readonly Stretch[]): Stretch[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Stretch[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start - last.end < TOUCH_MS) out[out.length - 1] = { start: last.start, end: Math.max(last.end, s.end) };
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** "hele dag", "het hele weekend" (a window that ends on a Monday), else "de hele periode". */
function wholeWindowLabel(from: number, to: number): string {
  if (to - from <= DAY_WINDOW_MS) return 'hele dag';
  return zonedParts(to).weekday === 1 ? 'het hele weekend' : 'de hele periode';
}

/** "wo 30 sep 20:00–05:00", "vr 2 okt 22:00 – ma 5 okt 05:00", "tot …", "vanaf …". */
function stretchLabel(s: Stretch, from: number, to: number): string {
  const startsBefore = s.start < from - TOUCH_MS;
  const endsAfter = !Number.isFinite(s.end) || s.end > to + TOUCH_MS;
  const short = Number.isFinite(s.end) && s.end - s.start < DAY_MS;
  if (startsBefore && !endsAfter) return `tot ${dayTimeLabel(s.end)}`;
  if (!Number.isFinite(s.end) || (endsAfter && !short)) return `vanaf ${dayTimeLabel(s.start)}`;
  return short ? `${dayLabel(s.start)} ${clockLabel(s.start)}–${clockLabel(s.end)}` : `${dayTimeLabel(s.start)} – ${dayTimeLabel(s.end)}`;
}

/** The stretches inside the window that carry the window's verdict level or a heavier one. */
function windowStretches(item: ForecastItem, mode: VehicleMode, from: number, to: number, level: VerdictLevel): Stretch[] {
  const segments = parseTimeline(item.d?.tl);
  if (segments.length > 0) {
    return segmentsIn(segments, from, to).filter((s) => {
      const l = itemVerdict(item, mode, Math.max(s.start, from)).level;
      return l !== 'nvt' && l !== 'geen' && severity(l) <= severity(level);
    });
  }
  const periods = periodsOf(item);
  if (periods.length > 0) return periods.filter((p) => p.start <= to && p.end >= from);
  const span = itemInterval(item.f.properties);
  return span.start <= to && span.end >= from ? [span] : [];
}

/**
 * When the measure bites inside the window [from, to]: "hele dag" / "het hele weekend" when it
 * covers the window, else up to two stretches ("wo 30 sep 20:00–05:00"), "o.a. …" when there
 * are more. Only the stretches with the window's verdict level or a heavier one count, so the
 * phrase belongs to the pill next to it. '' when nothing applies (outside the working times,
 * or not for this mode).
 */
export function phraseIn(item: ForecastItem, mode: VehicleMode, from: number, to: number): string {
  const level = itemVerdict(item, mode, undefined, { from, to }).level;
  if (level === 'nvt' || level === 'geen') return '';
  const knownUntil = toMs(item.d?.tlTo ?? null);
  const unknownTail = Number.isFinite(knownUntil) && knownUntil < to;
  const merged = mergeStretches(windowStretches(item, mode, from, to, level));
  if (merged.length === 0) return unknownTail ? `na ${dayTimeLabel(knownUntil)} nog niet bekend` : '';
  if (merged.some((s) => s.start <= from + TOUCH_MS && s.end >= to - TOUCH_MS)) return wholeWindowLabel(from, to);
  const parts = merged.map((s) => stretchLabel(s, from, to));
  const text = parts.length > 2 ? `o.a. ${parts.slice(0, 2).join(', ')}` : parts.join(', ');
  return unknownTail ? `${text}, daarna nog niet bekend` : text;
}
