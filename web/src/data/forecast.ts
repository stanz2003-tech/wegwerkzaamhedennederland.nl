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
import { DAY_PARTS, MS, dayWindow, isActiveAt, localDateKey, overlapsWindow, startOfDay, type DayPart, type TimeSpan } from './time';
import type { Category, ItemDetail, ItemFeature } from './types';
import { VERDICT_SEVERITY, countLevels, verdictFor, worseLevel, type VehicleMode, type Verdict, type VerdictLevel } from './verdict';

export interface ForecastItem {
  f: ItemFeature;
  d?: ItemDetail | null;
}

export const STRIP_DAYS = 7;
/** The strip on road and place pages: two weeks, so "volgende week dinsdag" is in it (owner decision 4). */
export const PAGE_STRIP_DAYS = 14;

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

/* ---------------------------------- day parts --------------------------------- */
/*
 * What makes the cells of the strip differ from each other. Every helper below only calls
 * selectInWindow: no new verdict rule, no level of its own. The cell headline stays `cell.worst`
 * over ALL items; these helpers decide what is drawn beside it.
 */

export interface DayPartCell {
  part: DayPart;
  /** Nominal bounds of the part ("06:00–12:00"), for labels. */
  from: number;
  to: number;
  /** False for a part of today that is already over: it is not judged and drawn as past. */
  ahead: boolean;
  /** Heaviest verdict inside the part (from `now` on for today), without the excluded items. */
  worst: VerdictLevel | null;
}

interface PartWindow {
  part: DayPart;
  from: number;
  to: number;
  /** The judged window, from `now` on; null for a part that is over. */
  judged: { from: number; to: number } | null;
}

/** The four part windows of a strip cell (DST-safe: from the calendar date, not from +6 h steps). */
function partWindows(cell: Pick<DayCell, 'from'>, now: number): PartWindow[] {
  const date = localDateKey(cell.from);
  return DAY_PARTS.map((p) => {
    const w = dayWindow(date, p.id) ?? { from: cell.from, to: cell.from };
    return { part: p.id, from: w.from, to: w.to, judged: w.to < now ? null : { from: Math.max(w.from, now), to: w.to } };
  });
}

/**
 * Night (00–06), morning, afternoon and evening of a strip cell, each with the heaviest verdict of
 * the items in it — `selectInWindow` over the part, so the same rules as the cell itself. Items in
 * `excludeIds` (the closures that are there every day, see `constantIds`) are left out, so the bar
 * shows what differs between days; the cell keeps them in its headline and in its top edge.
 */
export function dayParts(
  items: readonly ForecastItem[],
  mode: VehicleMode,
  cell: Pick<DayCell, 'from'>,
  now: number,
  excludeIds: ReadonlySet<string> = new Set(),
): DayPartCell[] {
  const kept = excludeIds.size > 0 ? items.filter((it) => !excludeIds.has(it.f.properties.id)) : items;
  return partWindows(cell, now).map((w) => ({
    part: w.part,
    from: w.from,
    to: w.to,
    ahead: w.judged !== null,
    worst: w.judged ? selectInWindow(kept, mode, w.judged.from, w.judged.to, now).worst : null,
  }));
}

export interface ConstantItem {
  id: string;
  /** The level it has in every part of every day of the strip. */
  level: VerdictLevel;
}

/** Levels worth lifting out of the comparison; a constant "geen hinder" is no news either way. */
const CONSTANT_LEVELS: ReadonlySet<VerdictLevel> = new Set<VerdictLevel>(['dicht', 'rijbaan', 'hinder', 'onbekend']);

/** The one level `item` has in every window, or null as soon as two windows differ or one is empty. */
function sameLevelIn(item: ForecastItem, mode: VehicleMode, windows: readonly { from: number; to: number }[], now: number): VerdictLevel | null {
  let level: VerdictLevel | null = null;
  for (const w of windows) {
    const l = selectInWindow([item], mode, w.from, w.to, now).worst;
    if (l === null || (level !== null && l !== level)) return null;
    level = l;
  }
  return level;
}

/**
 * The items that are the same on every day of the strip: in every cell's `ids`, with the same
 * level in every cell AND in every part of every cell that is still ahead. The part condition is
 * stricter than "same level per day": it is what makes "Elke dag, de hele dag" true, and what
 * makes leaving them out of the part bars safe — wherever a bar is drawn, the constant item
 * applies there at exactly its level, and the cell's top edge shows that level.
 * Heaviest first. Empty for a strip of fewer than two days.
 */
export function constantIds(cells: readonly DayCell[], items: readonly ForecastItem[], mode: VehicleMode, now: number): ConstantItem[] {
  const first = cells[0];
  if (!first || cells.length < 2) return [];
  const byId = new Map(items.map((it) => [it.f.properties.id, it]));
  const dayWindows = cells.map((c) => ({ from: Math.max(c.from, now), to: c.to }));
  const partWins = cells.flatMap((c) => partWindows(c, now).flatMap((w) => (w.judged ? [w.judged] : [])));
  const out: ConstantItem[] = [];
  for (const id of first.ids) {
    const item = byId.get(id);
    if (!item || !cells.every((c) => c.ids.includes(id))) continue;
    // Per day first (cheap), then per part.
    const level = sameLevelIn(item, mode, dayWindows, now);
    if (level === null || !CONSTANT_LEVELS.has(level)) continue;
    if (sameLevelIn(item, mode, partWins, now) === level) out.push({ id, level });
  }
  return out.sort((a, b) => VERDICT_SEVERITY.indexOf(a.level) - VERDICT_SEVERITY.indexOf(b.level));
}

/**
 * The hours of the heaviest part level of a cell: "hele dag", "18:00–06:00" (evening and night,
 * read round the clock), "06:00–18:00", or two stretches joined with "en". Only part bounds — the
 * exact "22:00–05:00" would need the item's own segments, and a guess there could understate.
 * Null when no part has a verdict.
 */
export function heaviestSpan(parts: readonly DayPartCell[]): string | null {
  let worst: VerdictLevel | null = null;
  for (const p of parts) if (p.ahead && p.worst !== null) worst = worseLevel(worst, p.worst);
  if (worst === null) return null;
  const on = parts.map((p) => p.ahead && p.worst === worst);
  if (on.every(Boolean)) return 'hele dag';
  const hour = (h: number): string => `${String(h).padStart(2, '0')}:00`;
  const n = on.length;
  const runs: string[] = [];
  // A run starts at a part that is on while the one before it (round the clock) is off.
  for (let i = 0; i < n; i++) {
    if (!on[i] || on[(i - 1 + n) % n]) continue;
    let j = i;
    while (on[(j + 1) % n]) j += 1;
    const start = DAY_PARTS[i];
    const end = DAY_PARTS[j % n];
    if (start && end) runs.push(`${hour(start.fromHour)}–${hour(end.toHour)}`);
  }
  return runs.join(' en ');
}
