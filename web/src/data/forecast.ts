/**
 * Vooruitkijken: which items apply at a moment or touch a window, period-aware — a nightly
 * work is only "dicht" inside one of its `periods` — plus the 7-day strip of an entity page
 * (worst verdict per day with counts). Pure functions; unit-tested in web/test/forecast.test.mjs.
 *
 * Items are `{ f, d }` pairs as in an EntityFile; `d` may be null when the page only has the
 * index or the GeoJSON (v2 data, the map panel), in which case `per` items get the
 * "op bepaalde tijden" hint instead of a false certainty. The wording of the answer lives in
 * data/answer.ts.
 */
import { parsePeriods, type Period } from './periods';
import { parseTimeline, periodsFromTimeline } from './timeline';
import { MS, isActiveAt, overlapsWindow, startOfDay, type TimeSpan } from './time';
import type { Category, ItemDetail, ItemFeature } from './types';
import { VERDICT_SEVERITY, countLevels, verdictFor, worseLevel, type VehicleMode, type Verdict, type VerdictLevel } from './verdict';

export interface ForecastItem {
  f: ItemFeature;
  d?: ItemDetail | null;
}

export const STRIP_DAYS = 7;

/** Categories that are a snapshot of the traffic situation right now (live.geojson). */
export const LIVE_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['file', 'incident', 'brug']);
/** How far ahead a live snapshot still counts as "there": a file at 14:00 says nothing about 10:00 tomorrow. */
export const LIVE_HORIZON_MS = MS.hour;

/**
 * False for an open-ended file, incident or bridge opening when the asked moment lies more
 * than an hour past `now`: the pipeline publishes them as "happening now", not as a forecast.
 * Everything with an end date, and every planned measure, is judged on its span alone.
 */
export function liveAppliesAt(p: { cat: Category; end?: string | null }, at: number, now: number): boolean {
  if (!LIVE_CATEGORIES.has(p.cat) || p.end) return true;
  return at <= now + LIVE_HORIZON_MS;
}

/**
 * When the item applies. Contract v4: taken from the timeline when there is one — it is built
 * from every record's own validity, whereas `periods` in v3 data came from the main record only.
 */
export function periodsOf(item: ForecastItem): Period[] {
  if (item.f.properties.per !== true) return [];
  const segments = parseTimeline(item.d?.tl);
  if (segments.length > 0) return parsePeriods(periodsFromTimeline(segments));
  return item.d?.periods ? parsePeriods(item.d.periods) : [];
}

/** Past this moment the item's working times are not known (contract v4 `tlTo`); NaN if unknown. */
function knownUntil(item: ForecastItem): number {
  return item.d?.tlTo ? Date.parse(item.d.tlTo) : Number.NaN;
}

/** Active at `at`: inside [start, end] and, when recurring periods are known, inside one of them. */
export function isActiveAtMoment(span: TimeSpan, periods: readonly Period[], at: number): boolean {
  if (!isActiveAt(span, at)) return false;
  if (periods.length === 0) return true;
  return periods.some((p) => p.start <= at && at <= p.end);
}

/**
 * Touches the window [from, to]: overlaps it and, when periods are known, one period does too —
 * or the window reaches past `knownUntil`, where the item may still apply and the verdict will
 * say "nog niet bekend" rather than the item silently dropping out.
 */
export function touchesWindow(span: TimeSpan, periods: readonly Period[], from: number, to: number, knownUntilMs = Number.NaN): boolean {
  if (!overlapsWindow(span, from, to)) return false;
  if (periods.length === 0) return true;
  if (Number.isFinite(knownUntilMs) && to > knownUntilMs) return true;
  return periods.some((p) => p.start <= to && p.end >= from);
}

/**
 * The verdict of an item for a mode, using whatever detail is available. `at` asks about one
 * moment; `window` about a stretch of time (a day in the strip) — then the heaviest phase inside
 * the window decides, not the heaviest phase of the whole measure.
 */
export function itemVerdict(item: ForecastItem, mode: VehicleMode, at?: number, window?: { from: number; to: number }): Verdict {
  const d = item.d ?? null;
  return verdictFor(item.f.properties, mode, {
    ...(d?.to ? { to: d.to } : {}),
    ...(d?.delay ? { delay: d.delay } : {}),
    ...(typeof d?.delaySec === 'number' ? { delaySec: d.delaySec } : {}),
    ...(typeof d?.queueM === 'number' ? { queueM: d.queueM } : {}),
    periods: d?.periods ?? null,
    ...(d?.tl ? { tl: d.tl } : {}),
    ...(d?.tlTo ? { tlTo: d.tlTo } : {}),
    ...(at !== undefined ? { now: at } : {}),
    ...(at === undefined && window ? { window } : {}),
  });
}

/* ------------------------------ moment / window ------------------------------ */

export interface AnsweredItem {
  item: ForecastItem;
  verdict: Verdict;
}

export interface Selection {
  /** Relevant items (not `nvt`), worst verdict first. */
  items: AnsweredItem[];
  worst: VerdictLevel | null;
  /** Items that applied in time but not to the mode. */
  hidden: AnsweredItem[];
}

/** Either one exact moment or a calendar window (the "Wanneer?" chips). */
export type When = { kind: 'moment'; at: number } | { kind: 'window'; from: number; to: number };

function collect(
  items: readonly ForecastItem[],
  mode: VehicleMode,
  inTime: (item: ForecastItem) => boolean,
  at?: number,
  window?: { from: number; to: number },
): Selection {
  const out: AnsweredItem[] = [];
  const hidden: AnsweredItem[] = [];
  let worst: VerdictLevel | null = null;
  for (const item of items) {
    if (!inTime(item)) continue;
    const verdict = itemVerdict(item, mode, at, window);
    if (verdict.level === 'nvt') {
      hidden.push({ item, verdict });
      continue;
    }
    out.push({ item, verdict });
    worst = worseLevel(worst, verdict.level);
  }
  out.sort((a, b) => VERDICT_SEVERITY.indexOf(a.verdict.level) - VERDICT_SEVERITY.indexOf(b.verdict.level));
  return { items: out, worst, hidden };
}

/**
 * What applies at one exact moment (the datetime-local input). Inclusion is by the item's span
 * only: a nightly work between two of its periods stays listed, and the verdict says
 * "Geen hinder · buiten werktijden (ma–vr 21:00–05:00)" — the driver learns the work exists
 * and when it bites, instead of it silently vanishing at noon.
 */
export function selectAtMoment(items: readonly ForecastItem[], mode: VehicleMode, at: number, now = at): Selection {
  return collect(items, mode, (item) => isActiveAt(item.f.properties, at) && liveAppliesAt(item.f.properties, at, now), at);
}

/** What touches a window ("vandaag", "dit weekend"). */
export function selectInWindow(items: readonly ForecastItem[], mode: VehicleMode, from: number, to: number, now = from): Selection {
  return collect(
    items,
    mode,
    (item) => touchesWindow(item.f.properties, periodsOf(item), from, to, knownUntil(item)) && liveAppliesAt(item.f.properties, from, now),
    undefined,
    { from, to },
  );
}

/** `now` lets the live snapshot rule work; omitted, it equals the asked moment (no exclusion). */
export function selectWhen(items: readonly ForecastItem[], mode: VehicleMode, when: When, now?: number): Selection {
  return when.kind === 'moment' ? selectAtMoment(items, mode, when.at, now ?? when.at) : selectInWindow(items, mode, when.from, when.to, now ?? when.from);
}

/* --------------------------------- day strip --------------------------------- */

export interface DayCell {
  /** Calendar bounds of the day in Europe/Amsterdam. */
  from: number;
  to: number;
  /** Worst verdict among the relevant items, null when nothing touches the day. */
  worst: VerdictLevel | null;
  counts: Record<VerdictLevel, number>;
  /** Ids of the items that touch the day and are relevant for the mode. */
  ids: string[];
}

/**
 * One cell per day from today (`now`) for `days` days. Items that do not apply to the mode
 * (`nvt`) are left out entirely: a car driver must not see a red day because of a cycle path.
 * Today's cell is judged from `now` on: a night closure that ended at 05:00 must not colour the
 * afternoon red. The cell keeps its calendar bounds for the label.
 */
export function dayStrip(items: readonly ForecastItem[], mode: VehicleMode, now: number, days = STRIP_DAYS): DayCell[] {
  const cells: DayCell[] = [];
  for (let i = 0; i < days; i++) {
    const from = startOfDay(now, i);
    const to = startOfDay(now, i + 1) - 1;
    const sel = selectInWindow(items, mode, Math.max(from, now), to, now);
    cells.push({
      from,
      to,
      worst: sel.worst,
      counts: countLevels(sel.items.map((x) => x.verdict.level)),
      ids: sel.items.map((x) => x.item.f.properties.id),
    });
  }
  return cells;
}

/** Items of a strip cell, in the order of the input list. */
export function itemsForCell(items: readonly ForecastItem[], cell: DayCell): ForecastItem[] {
  const ids = new Set(cell.ids);
  return items.filter((it) => ids.has(it.f.properties.id));
}

/** Day label for a strip cell: "vandaag", "morgen", else the caller's short weekday+day. */
export function relativeDayLabel(cell: DayCell, now: number, fallback: string): string {
  if (cell.from === startOfDay(now)) return 'vandaag';
  if (cell.from === startOfDay(now, 1)) return 'morgen';
  return fallback;
}
