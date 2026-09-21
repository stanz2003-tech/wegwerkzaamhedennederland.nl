/**
 * Time-window logic (docs/onderzoek.md §2.3 "periods" and build-contracts.md).
 *
 * - active   = now inside one of the `validPeriod`s when the item has periods,
 *              else start ≤ now ≤ end (missing end = open ended).
 * - ended    = end (or the last period end) more than 1 h ago → excluded.
 * - upcoming = not active, not ended, start within 30 days.
 * - future   = starts later than 30 days → excluded.
 */

export const UPCOMING_DAYS = 30;
export const ENDED_GRACE_MS = 60 * 60 * 1000;
export const MAX_PERIODS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The published period list is trimmed to whole days in Europe/Amsterdam rather than to the exact
 * moment of the run. Filtering on the run clock made the output non-deterministic in a way that
 * cost real money: a period that ended an hour ago dropped out of the list at the next run, so 31
 * of the 32 detail shards changed within 24 hours without a single measure having changed, and
 * every one of them was re-uploaded. Quantising to the local day means the list changes once a
 * day, at midnight, and any other change is a real change — which is also what makes the effect
 * of every later fix measurable.
 *
 * Amsterdam rather than UTC because that is the clock the periods themselves are written in: a
 * night closure ending at 06:00 local must not survive or vanish an hour early in winter.
 */
const DAY_BOUNDARY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Local midnight (Europe/Amsterdam) of the day `ms` falls in, as epoch ms.
 * @param {number} ms
 */
export function startOfLocalDay(ms) {
  const parts = DAY_BOUNDARY.formatToParts(new Date(ms));
  const get = (/** @type {string} */ type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get('hour') % 24;
  const minute = get('minute');
  // Subtracting the local wall-clock time of day lands on local midnight without needing to know
  // the offset, and stays correct across both daylight-saving switches.
  return ms - (hour * 60 + minute) * 60 * 1000 - (ms % 60000);
}

/** @typedef {'active'|'upcoming'|'ended'|'future'|'invalid'} WindowState */

/**
 * Parse an ISO timestamp to epoch ms; undefined when missing or unparseable.
 * @param {string | undefined} iso
 */
export function toMs(iso) {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * ISO 8601 UTC at minute precision: "2026-09-07T19:11:00Z".
 * @param {string | number | undefined} value
 */
export function toMinuteIso(value) {
  const ms = typeof value === 'number' ? value : toMs(value);
  if (ms === undefined) return undefined;
  return new Date(Math.floor(ms / 60000) * 60000).toISOString().replace('.000Z', 'Z');
}

/**
 * @param {{ start?: string, end?: string, periods?: [string, string|undefined][] }} item
 * @param {number} nowMs
 * @returns {WindowState}
 */
export function windowState(item, nowMs) {
  const start = toMs(item.start);
  const end = toMs(item.end);
  if (start === undefined && end === undefined) return 'invalid';
  const periods = usablePeriods(item.periods);

  const lastEnd = periods.length > 0 ? maxPeriodEnd(periods, end) : end;
  if (lastEnd !== undefined && lastEnd < nowMs - ENDED_GRACE_MS) return 'ended';
  if (end !== undefined && end < nowMs - ENDED_GRACE_MS) return 'ended';

  if (periods.length > 0) {
    if (periods.some(([s, e]) => s <= nowMs && (e === undefined || e >= nowMs))) return 'active';
  } else if ((start === undefined || start <= nowMs) && (end === undefined || end >= nowMs)) {
    return 'active';
  }

  const nextStart = periods.length > 0 ? nextPeriodStart(periods, nowMs) ?? start : start;
  // Nothing lies ahead any more, so we are inside the one hour grace window
  // after the end: keep the item active instead of filing it as "planned"
  // with a start in the past (publishers are often late closing a measure).
  if (nextStart === undefined || nextStart <= nowMs) return 'active';
  if (nextStart > nowMs + UPCOMING_DAYS * DAY_MS) return 'future';
  return 'upcoming';
}

/**
 * Periods still relevant (end not more than 1 h ago), sorted, minute precision,
 * at most MAX_PERIODS. Open-ended periods keep an empty end.
 * @param {[string, string|undefined][] | undefined} periods
 * @param {number} nowMs
 * @returns {[string, string][] | undefined}
 */
export function upcomingPeriods(periods, nowMs) {
  // See DAY_BOUNDARY: the cut-off is local midnight, not the run clock, so the list only changes
  // when the calendar day changes. ENDED_GRACE_MS is no longer needed — a whole day of slack
  // subsumes it.
  const floor = startOfLocalDay(nowMs);
  const usable = usablePeriods(periods).filter(([, e]) => e === undefined || e >= floor);
  if (usable.length === 0) return undefined;
  return usable
    .slice(0, MAX_PERIODS)
    .map(([s, e]) => /** @type {[string, string]} */ ([toMinuteIso(s), e === undefined ? '' : toMinuteIso(e)]));
}

/**
 * @param {[string, string|undefined][] | undefined} periods
 * @returns {[number, number|undefined][]}
 */
function usablePeriods(periods) {
  if (!periods) return [];
  /** @type {[number, number|undefined][]} */
  const out = [];
  for (const [s, e] of periods) {
    const sMs = toMs(s);
    if (sMs === undefined) continue;
    const eMs = toMs(e);
    out.push([sMs, eMs]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** @param {[number, number|undefined][]} periods @param {number | undefined} fallback */
function maxPeriodEnd(periods, fallback) {
  let max;
  for (const [, e] of periods) {
    if (e === undefined) return undefined; // open ended period → never "ended" by periods
    if (max === undefined || e > max) max = e;
  }
  return max ?? fallback;
}

/** @param {[number, number|undefined][]} periods @param {number} nowMs */
function nextPeriodStart(periods, nowMs) {
  for (const [s] of periods) if (s > nowMs) return s;
  return undefined;
}

/**
 * Bridge openings: [start, end] pairs that end after now and start within `days`.
 * @param {{ start?: string, end?: string }[]} openings
 * @param {number} nowMs
 * @param {number} days
 * @param {number} max
 * @returns {[string, string][]}
 */
export function openingsWithin(openings, nowMs, days, max) {
  const horizon = nowMs + days * DAY_MS;
  /** @type {[number, number][]} */
  const rows = [];
  for (const o of openings) {
    const s = toMs(o.start);
    if (s === undefined) continue;
    const e = toMs(o.end) ?? s + 10 * 60 * 1000;
    if (e < nowMs || s > horizon) continue;
    rows.push([s, e]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  // The bridge control systems publish one swing several times, once per sensor or per shipping
  // registration, each with a slightly shifted timestamp and its own situation id. Measured on the
  // live feed of 19 September 2026: 137 of 1.282 openings (10,7%) start before the previous one of
  // the same bridge has ended — the Alkmaar cycle bridge alone showed 09:13-09:19, 09:15-09:21 and
  // 09:17-09:23, which a reader takes for three separate swings. Overlapping or near-touching
  // rows are therefore merged into the span they really describe; only byte-identical pairs were
  // dropped before. The slack covers the gap that rounding to whole minutes can leave behind.
  const MERGE_SLACK_MS = 60 * 1000;
  /** @type {[number, number][]} */
  const unique = [];
  for (const [s, e] of rows) {
    const prev = unique[unique.length - 1];
    if (prev && s <= prev[1] + MERGE_SLACK_MS) {
      if (e > prev[1]) prev[1] = e;
      continue;
    }
    unique.push([s, e]);
  }
  return unique.slice(0, max).map(([s, e]) => [toMinuteIso(s), toMinuteIso(e)]);
}
