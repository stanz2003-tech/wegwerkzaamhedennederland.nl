/**
 * Calendar maths in Amsterdam time for the daily report: local dates, local midnights (correct
 * across the DST switches), Monday-based weeks and ISO week numbers. Dates are YYYY-MM-DD strings.
 */
export const TIME_ZONE = 'Europe/Amsterdam';
export const DAY_MS = 86_400_000;
const WEEKDAYS_NL = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

/** Offset of Amsterdam from UTC at `date`, in ms (+1 h in winter, +2 h in summer). */
function amsterdamOffsetMs(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Calendar date in Amsterdam, as YYYY-MM-DD. */
export function amsterdamDate(date) {
  return new Date(date.getTime() + amsterdamOffsetMs(date)).toISOString().slice(0, 10);
}

/** The instant Amsterdam's day `ymd` starts, correct across the DST switches. */
export function amsterdamMidnight(ymd) {
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const guess = new Date(Date.parse(`${ymd}T00:00:00Z`) - amsterdamOffsetMs(noonUtc));
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - amsterdamOffsetMs(guess));
}

export function addDays(ymd, n) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 for Monday up to 6 for Sunday. */
export function weekdayIndex(ymd) {
  return (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export const weekdayName = (ymd) => WEEKDAYS_NL[weekdayIndex(ymd)];

/** The Monday that starts the week of `ymd`. */
export const mondayOf = (ymd) => addDays(ymd, -weekdayIndex(ymd));

/** ISO 8601 week number: week 1 is the week with the year's first Thursday. */
export function isoWeek(ymd) {
  const thursday = addDays(ymd, 3 - weekdayIndex(ymd));
  const yearStart = Date.parse(`${thursday.slice(0, 4)}-01-01T00:00:00Z`);
  return Math.floor((Date.parse(`${thursday}T00:00:00Z`) - yearStart) / DAY_MS / 7) + 1;
}

/** Every date from `from` to `to`, both included. */
export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whole-percent change; null when there is nothing to compare with. */
export function changePct(current, previous) {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}
