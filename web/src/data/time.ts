/**
 * Time logic: activity, time-window filtering and Europe/Amsterdam calendar helpers.
 * Pure functions only (no DOM, no fetch) so they can be unit-tested with node:test.
 *
 * v2 contract: the GeoJSON properties carry only `start`/`end`; the pipeline already decides
 * which items are active now (werk-actueel / live) and which are upcoming (werk-gepland).
 * Recurring sub-periods live in the detail shard and are only used for display.
 */

export const TIME_ZONE = 'Europe/Amsterdam';

export type TimeWindowId = 'nu' | 'vandaag' | 'weekend' | '7d' | '30d';

export const TIME_WINDOWS: readonly { id: TimeWindowId; label: string; title: string }[] = [
  { id: 'nu', label: 'Nu', title: 'Alleen wat op dit moment actief is' },
  { id: 'vandaag', label: 'Vandaag', title: 'Actief of startend voor het einde van vandaag' },
  { id: 'weekend', label: 'Dit weekend', title: 'Van vrijdag 20:00 tot maandag 06:00' },
  { id: '7d', label: '7 dagen', title: 'De komende zeven dagen' },
  { id: '30d', label: '30 dagen', title: 'De komende dertig dagen' },
];

export const DEFAULT_TIME_WINDOW: TimeWindowId = 'nu';

export function isTimeWindowId(value: string): value is TimeWindowId {
  return TIME_WINDOWS.some((w) => w.id === value);
}

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

export const MS = { minute: MS_MINUTE, hour: MS_HOUR, day: MS_DAY } as const;

/** Weekend window as agreed in the build contract: Friday 20:00 → Monday 06:00. */
export const WEEKEND_START_HOUR = 20;
export const WEEKEND_END_HOUR = 6;

/** Parses an ISO timestamp; returns NaN for absent/invalid values. */
export function toMs(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
}

export interface Interval {
  start: number;
  /** +Infinity when open ended. */
  end: number;
}

export interface TimeSpan {
  start: string;
  end?: string | null;
}

/** Returns the [start,end] interval of an item; end is +Infinity when absent. */
export function itemInterval(p: TimeSpan): Interval {
  const start = toMs(p.start);
  const endMs = toMs(p.end);
  return {
    start: Number.isNaN(start) ? Number.NEGATIVE_INFINITY : start,
    end: Number.isNaN(endMs) ? Number.POSITIVE_INFINITY : endMs,
  };
}

/** Active = start <= now && (end == null || end >= now). */
export function isActiveAt(p: TimeSpan, now: number): boolean {
  const { start, end } = itemInterval(p);
  return start <= now && end >= now;
}

/** True when the item overlaps the window [from, to]. */
export function overlapsWindow(p: TimeSpan, from: number, to: number): boolean {
  const { start, end } = itemInterval(p);
  return start <= to && end >= from;
}

/** Start when it lies at/after `now`, else null. */
export function nextStartAfter(p: TimeSpan, now: number): number | null {
  const s = toMs(p.start);
  return !Number.isNaN(s) && s >= now ? s : null;
}

/* ------------------------------------------------------------------------ */
/* Europe/Amsterdam calendar helpers                                        */
/* ------------------------------------------------------------------------ */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(ms: number): ZonedParts {
  const parts = partsFormatter.formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Milliseconds since epoch for a wall-clock time in Europe/Amsterdam. */
export function zonedToMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two-pass correction handles DST transitions (offset is +1h or +2h).
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(ms);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    ms += guess - asUtc;
  }
  return ms;
}

/** Local midnight (start of the day) in Europe/Amsterdam for the given instant plus `dayOffset` days. */
export function startOfDay(ms: number, dayOffset = 0): number {
  const p = zonedParts(ms);
  return zonedToMs(p.year, p.month, p.day + dayOffset);
}

/** "HH:MM" wall-clock key in Europe/Amsterdam (used to detect recurring patterns). */
export function wallClockKey(ms: number): string {
  const p = zonedParts(ms);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * Calendar bounds [from, to] of a time window, *without* the "nothing in the past" clamp that
 * `timeWindowRange` applies. Use these to decide what actually starts or ends inside the window
 * (see `windowRelevance`): on Saturday the clamped window would start at "now", which would make
 * a closure that started on Friday evening look like a background measure.
 */
export function timeWindowBounds(id: TimeWindowId, now: number): { from: number; to: number } {
  switch (id) {
    case 'nu':
      return { from: now, to: now };
    case 'vandaag':
      return { from: startOfDay(now), to: startOfDay(now, 1) - 1 };
    case '7d':
      return { from: now, to: now + 7 * MS_DAY };
    case '30d':
      return { from: now, to: now + 30 * MS_DAY };
    case 'weekend': {
      const p = zonedParts(now);
      // Offset (in days) from today to the Friday that anchors the relevant weekend:
      // Sat/Sun/early-Monday look back to the weekend in progress, other days look ahead.
      let fridayOffset: number;
      if (p.weekday === 6) fridayOffset = -1;
      else if (p.weekday === 0) fridayOffset = -2;
      else if (p.weekday === 1 && p.hour < WEEKEND_END_HOUR) fridayOffset = -3;
      else fridayOffset = (5 - p.weekday + 7) % 7;
      return {
        from: zonedToMs(p.year, p.month, p.day + fridayOffset, WEEKEND_START_HOUR),
        to: zonedToMs(p.year, p.month, p.day + fridayOffset + 3, WEEKEND_END_HOUR),
      };
    }
    default:
      return { from: now, to: now };
  }
}

/**
 * Window [from, to] for a time chip, clamped so nothing in the past is reported.
 * "weekend" covers Friday 20:00 → Monday 06:00 of the current weekend when we are inside it,
 * otherwise the coming one.
 */
export function timeWindowRange(id: TimeWindowId, now: number): { from: number; to: number } {
  const { from, to } = timeWindowBounds(id, now);
  return { from: Math.max(from, now), to };
}

/** Does the item match the selected time chip at `now`? */
export function matchesTimeWindow(p: TimeSpan, id: TimeWindowId, now: number): boolean {
  if (id === 'nu') return isActiveAt(p, now);
  const { from, to } = timeWindowRange(id, now);
  return overlapsWindow(p, from, to);
}

/* ------------------------------------------------------------------------ */
/* How long does a measure run? (semi-permanent vs. real-time)              */
/* ------------------------------------------------------------------------ */

/** Everything that changes within a week gets a precise duration ("nog 3 dagen"). */
export const SHORT_HORIZON_MS = 7 * MS_DAY;
/** Beyond a month a measure is no longer planned work but a standing situation. */
export const MEDIUM_RUN_MS = 30 * MS_DAY;
/** Beyond three months we call it a long-running (semi-permanent) measure. */
export const LONG_RUN_MS = 90 * MS_DAY;

/**
 * Length of the measure in ms. With a known end that is `end - start`; when the end is open all
 * we honestly know is how long it has been running already, so an open-ended item that started
 * ten minutes ago counts as short (a traffic jam) and one from 2019 as long-running.
 */
export function measureLengthMs(p: TimeSpan, now: number): number {
  const { start, end } = itemInterval(p);
  if (!Number.isFinite(start)) return 0;
  if (Number.isFinite(end)) return Math.max(0, end - start);
  return Math.max(0, now - start);
}

/**
 * True for semi-permanent measures (width restrictions, multi-year closures).
 *
 * `threshold` lets a caller be stricter than the 90-day default. The "vandaag" and "dit weekend"
 * pages use `MEDIUM_RUN_MS`: someone asking what happens this weekend wants the works that start,
 * end or change then, not the width restriction that has stood since spring. Those measures are
 * not hidden — the page shows them in a counted, collapsed group.
 */
export function isLongRunning(p: TimeSpan, now: number, threshold: number = LONG_RUN_MS): boolean {
  return measureLengthMs(p, now) >= threshold;
}

/** Distance in ms to the nearest moment the item changes (its start or its end). */
export function msToNearestChange(p: TimeSpan, now: number): number {
  const { start, end } = itemInterval(p);
  let best = Number.POSITIVE_INFINITY;
  if (Number.isFinite(start)) best = Math.min(best, Math.abs(start - now));
  if (Number.isFinite(end)) best = Math.min(best, Math.abs(end - now));
  return best;
}

/* ------------------------------------------------------------------------ */
/* What actually changes inside a window? ("vandaag", "dit weekend")         */
/* ------------------------------------------------------------------------ */

/**
 * - `changes`     the item starts, ends or has a sub-period inside the window — news;
 * - `background`  it is active across the whole window without changing — a measure that was
 *                 already there before the window and is still there after it;
 * - `outside`     no overlap at all.
 */
export type WindowRelevance = 'changes' | 'background' | 'outside';

export interface WindowRelevanceOptions {
  /** Recurring sub-periods from the detail shard as ISO pairs, when known. */
  periods?: readonly (readonly [string, string])[] | null;
}

function insideWindow(ms: number, from: number, to: number): boolean {
  return Number.isFinite(ms) && ms >= from && ms <= to;
}

/** Classifies an item against the calendar bounds of a window (use `timeWindowBounds`). */
export function windowRelevance(
  p: TimeSpan,
  from: number,
  to: number,
  opts: WindowRelevanceOptions = {},
): WindowRelevance {
  if (!overlapsWindow(p, from, to)) return 'outside';
  const { start, end } = itemInterval(p);
  if (insideWindow(start, from, to) || insideWindow(end, from, to)) return 'changes';
  for (const period of opts.periods ?? []) {
    if (insideWindow(toMs(period[0]), from, to) || insideWindow(toMs(period[1]), from, to)) return 'changes';
  }
  return 'background';
}

/** Age of the data in minutes (NaN when unparsable). */
export function ageMinutes(generatedIso: string, now: number): number {
  const g = toMs(generatedIso);
  return Number.isNaN(g) ? Number.NaN : (now - g) / MS_MINUTE;
}
