/**
 * Summarising recurring sub-periods of an item ("ma–vr 22:00–05:00") or listing the next few.
 * Pure; unit-tested.
 */
import { MS, toMs, wallClockKey, zonedParts } from './time';

export interface Period {
  start: number;
  end: number;
}

export type PeriodSummary =
  | { kind: 'none' }
  | {
      kind: 'pattern';
      /** e.g. "ma–vr" or "vr, za" */
      days: string;
      /** e.g. "22:00" */
      from: string;
      /** e.g. "05:00" */
      to: string;
      /** First start and last end of the whole series. */
      first: number;
      last: number;
      count: number;
    }
  | { kind: 'list'; items: Period[]; more: number };

const DAY_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'] as const;
/** Monday-first order used for ranges. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function parsePeriods(periods: readonly (readonly [string, string])[] | undefined): Period[] {
  if (!periods) return [];
  const out: Period[] = [];
  for (const [s, e] of periods) {
    const start = toMs(s);
    const end = toMs(e);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Formats a set of weekdays (0 = Sunday) as "ma–vr", "za, zo" or "dagelijks". */
export function formatWeekdaySet(days: ReadonlySet<number>): string {
  if (days.size === 7) return 'dagelijks';
  const ordered = DAY_ORDER.filter((d) => days.has(d));
  if (ordered.length === 0) return '';
  const idx = ordered.map((d) => DAY_ORDER.indexOf(d));
  const contiguous = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? -1) + 1);
  if (contiguous && ordered.length >= 3) {
    const first = ordered[0] ?? 0;
    const last = ordered[ordered.length - 1] ?? 0;
    return `${DAY_SHORT[first]}–${DAY_SHORT[last]}`;
  }
  return ordered.map((d) => DAY_SHORT[d]).join(', ');
}

/**
 * Detects a regular pattern: ≥ 3 periods that all start and end at the same wall-clock times
 * and each last less than 24 h. Otherwise lists the first `maxList` periods not yet ended.
 */
export function summarizePeriods(
  periods: readonly (readonly [string, string])[] | undefined,
  now: number,
  maxList = 5,
): PeriodSummary {
  const all = parsePeriods(periods);
  if (all.length === 0) return { kind: 'none' };
  const relevant = all.filter((p) => p.end >= now);
  const source = relevant.length > 0 ? relevant : all;

  if (source.length >= 3) {
    const startKey = wallClockKey(source[0]?.start ?? 0);
    const endKey = wallClockKey(source[0]?.end ?? 0);
    const regular = source.every(
      (p) => p.end - p.start < MS.day && wallClockKey(p.start) === startKey && wallClockKey(p.end) === endKey,
    );
    if (regular) {
      const days = new Set<number>(source.map((p) => zonedParts(p.start).weekday));
      return {
        kind: 'pattern',
        days: formatWeekdaySet(days),
        from: startKey,
        to: endKey,
        first: source[0]?.start ?? 0,
        last: source[source.length - 1]?.end ?? 0,
        count: source.length,
      };
    }
  }
  return { kind: 'list', items: source.slice(0, maxList), more: Math.max(0, source.length - maxList) };
}
