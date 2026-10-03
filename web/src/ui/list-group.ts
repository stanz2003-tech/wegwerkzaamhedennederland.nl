/**
 * Folds the rows of a list that say the same thing into one row (overzicht-3):
 *   - a series: the same stretch, direction and verdict at the same clock times on several days
 *     ("Houten | start ma 28 sep 20:00", di 29, wo 30, do 1 okt → one row "ma 28 sep – do 1 okt,
 *     4 nachten · 20:00–05:00");
 *   - parts: one street published in pieces with the same title, verdict and end, lying next to
 *     each other ("Olivier van Noortweg, Venlo" three times → "3 delen van deze straat").
 *
 * Pure (no DOM). Safety rules, pinned by web/test/list-group.test.mjs:
 *   - the verdict level of the current mode and moment is part of every key, so rows with a
 *     different verdict are never folded together, and a group's level is its worst member's;
 *   - a series never mixes clock windows, and lists its real dates instead of "elke nacht", so a
 *     night without work is not implied;
 *   - every member stays in the group (`members`), in input order, so every id stays reachable.
 */
import { haversineKm } from '../data/filter';
import { MS, toMs, wallClockKey, zonedParts } from '../data/time';
import { VERDICT_SEVERITY, type VerdictLevel } from '../data/verdict';
import { fmtDay } from './format';

/** The fields grouping looks at; callers map their own row type onto it. */
export interface GroupFields {
  id: string;
  road: string | null;
  title: string;
  start: string;
  end: string | null;
  /** Section from the detail, when known: "Lunetten" → "Nieuwegein". */
  from?: string | undefined;
  to?: string | undefined;
  /** Representative point [lon, lat], when known. Rows without one are never folded as parts. */
  pos?: readonly [number, number] | null | undefined;
}

export type ListGroupKind = 'single' | 'series' | 'parts';

export interface ListGroup<T> {
  kind: ListGroupKind;
  /** Every member, in input order; a single row has one. */
  members: T[];
  /** The worst verdict level among the members. */
  level: VerdictLevel;
  /** The first member with that level: the row the group shows. */
  lead: T;
}

/** Parts of one street further apart than this are two places, not one street in pieces. */
export const PARTS_KM = 1.5;
/** A series member is one working block: shorter than a day, with a known end. */
const MAX_BLOCK_MS = MS.day;
/** Up to this many dates are listed one by one when a series has a gap. */
const MAX_LISTED_DATES = 5;

function worst(levels: readonly VerdictLevel[]): VerdictLevel {
  return levels.reduce((a, b) => (VERDICT_SEVERITY.indexOf(b) < VERDICT_SEVERITY.indexOf(a) ? b : a));
}

/** "Lunetten → Nieuwegein" from the detail, else the title without its "A27 · " prefix. */
function sectionKey(f: GroupFields): string {
  if (f.from && f.to) return `${f.from}→${f.to}`;
  if (f.road) {
    const prefix = `${f.road} · `.toLowerCase();
    if (f.title.toLowerCase().startsWith(prefix)) return f.title.slice(prefix.length).trim().toLowerCase();
  }
  return f.title.trim().toLowerCase();
}

/** Calendar day number of a moment in Europe/Amsterdam (consecutive days differ by 1). */
function dayNumber(ms: number): number {
  const p = zonedParts(ms);
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / MS.day);
}

/** The series key, or null when the row is not one short block with a known end. */
function seriesKey(f: GroupFields, level: VerdictLevel): string | null {
  const start = toMs(f.start);
  const end = toMs(f.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start >= MAX_BLOCK_MS) return null;
  return [(f.road ?? '').toUpperCase(), sectionKey(f), f.to ?? '', level, `${wallClockKey(start)}-${wallClockKey(end)}`].join('|');
}

function partsKey(f: GroupFields, level: VerdictLevel): string | null {
  if (!f.pos) return null;
  // The direction is part of the key: two directions are two carriageways, not one street in pieces.
  return [f.title.trim().toLowerCase(), f.to ?? '', level, f.end ?? ''].join('|');
}

/** Single-link clusters of points within PARTS_KM of each other ("adjacent or overlapping"). */
function clusters(indices: readonly number[], posOf: (i: number) => readonly [number, number]): number[][] {
  const out: number[][] = [];
  const seen = new Set<number>();
  for (const i of indices) {
    if (seen.has(i)) continue;
    const cluster = [i];
    seen.add(i);
    for (let k = 0; k < cluster.length; k++) {
      const a = posOf(cluster[k] as number);
      for (const j of indices) {
        if (seen.has(j)) continue;
        const b = posOf(j);
        if (haversineKm([a[0], a[1]], [b[0], b[1]]) <= PARTS_KM) {
          seen.add(j);
          cluster.push(j);
        }
      }
    }
    out.push(cluster.sort((x, y) => x - y));
  }
  return out;
}

/** Buckets of row indices by key, in order of first appearance. */
function bucket(indices: readonly number[], keyOf: (i: number) => string | null): number[][] {
  const map = new Map<string, number[]>();
  for (const i of indices) {
    const key = keyOf(i);
    if (key === null) continue;
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  }
  return [...map.values()];
}

/**
 * Groups `rows` (kept in their order: a group stands where its first member stood).
 * @param verdictOf  The level the row's pill shows for the current mode and moment.
 * @param fieldsOf   Maps a row onto the fields grouping reads.
 */
export function groupSeries<T>(rows: readonly T[], verdictOf: (row: T) => VerdictLevel, fieldsOf: (row: T) => GroupFields): ListGroup<T>[] {
  const fields = rows.map(fieldsOf);
  const levels = rows.map(verdictOf);
  const groupOf = new Array<number[] | null>(rows.length).fill(null);
  const kindOf = new Map<number[], ListGroupKind>();
  const all = rows.map((_, i) => i);

  for (const members of bucket(all, (i) => seriesKey(fields[i] as GroupFields, levels[i] as VerdictLevel))) {
    if (members.length < 2) continue;
    // Two blocks on the same day are two places or two directions, not a series: leave them.
    const days = new Set(members.map((i) => dayNumber(toMs((fields[i] as GroupFields).start))));
    if (days.size !== members.length) continue;
    kindOf.set(members, 'series');
    for (const i of members) groupOf[i] = members;
  }

  const rest = all.filter((i) => groupOf[i] === null);
  for (const candidates of bucket(rest, (i) => partsKey(fields[i] as GroupFields, levels[i] as VerdictLevel))) {
    if (candidates.length < 2) continue;
    for (const members of clusters(candidates, (i) => (fields[i] as GroupFields).pos as readonly [number, number])) {
      if (members.length < 2) continue;
      kindOf.set(members, 'parts');
      for (const i of members) groupOf[i] = members;
    }
  }

  const out: ListGroup<T>[] = [];
  const emitted = new Set<number[]>();
  rows.forEach((row, i) => {
    const members = groupOf[i];
    if (!members) {
      out.push({ kind: 'single', members: [row], level: levels[i] as VerdictLevel, lead: row });
      return;
    }
    if (emitted.has(members)) return;
    emitted.add(members);
    const level = worst(members.map((m) => levels[m] as VerdictLevel));
    const leadIndex = members.find((m) => levels[m] === level) ?? (members[0] as number);
    out.push({ kind: kindOf.get(members) ?? 'single', members: members.map((m) => rows[m] as T), level, lead: rows[leadIndex] as T });
  });
  return out;
}

/** Number of rows a list of groups holds (all members). */
export function memberCount<T>(groups: readonly ListGroup<T>[]): number {
  return groups.reduce((n, g) => n + g.members.length, 0);
}

/* --------------------------------- wording --------------------------------- */

/** True when the block runs past midnight: "20:00–05:00". */
function isNight(start: number, end: number): boolean {
  return wallClockKey(end) < wallClockKey(start);
}

/** "ma 28, di 29 sep, do 1 okt": the month only where it changes and at the end. */
function dateList(starts: readonly number[]): string {
  const labels = starts.map((ms) => fmtDay(ms));
  return labels
    .map((label, i) => {
      const month = label.split(' ').pop() ?? '';
      const nextMonth = (labels[i + 1] ?? '').split(' ').pop();
      return i < labels.length - 1 && nextMonth === month ? label.slice(0, label.length - month.length).trim() : label;
    })
    .join(', ');
}

/**
 * The when text of a series row. Consecutive days: "ma 28 sep – do 1 okt, 4 nachten · 20:00–05:00".
 * With a gap the real dates ("ma 28, di 29 sep, do 1 okt · nachts 20:00–05:00"), or for a long
 * series "…, 12 nachten, niet elke nacht · …": a night off is never hidden behind "elke nacht".
 */
export function seriesWhen(spans: readonly { start: string; end: string | null }[]): string {
  const blocks = spans
    .map((s) => ({ start: toMs(s.start), end: toMs(s.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end))
    .sort((a, b) => a.start - b.start);
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) return '';
  const night = isNight(first.start, first.end);
  const clock = `${wallClockKey(first.start)}–${wallClockKey(first.end)}`;
  const n = blocks.length;
  const noun = night ? (n === 1 ? 'nacht' : 'nachten') : n === 1 ? 'dag' : 'dagen';
  const days = blocks.map((b) => dayNumber(b.start));
  const consecutive = days.every((d, i) => i === 0 || d === (days[i - 1] as number) + 1);
  if (consecutive) return `${fmtDay(first.start)} – ${fmtDay(last.start)}, ${n} ${noun} · ${clock}`;
  const at = `${night ? 'nachts ' : ''}${clock}`;
  if (n <= MAX_LISTED_DATES) return `${dateList(blocks.map((b) => b.start))} · ${at}`;
  return `${fmtDay(first.start)} – ${fmtDay(last.start)}, ${n} ${noun}, niet elke ${night ? 'nacht' : 'dag'} · ${at}`;
}

/** The summary of the disclosure under a group row: "Alle 4 nachten" / "Alle 3 delen". */
export function groupToggleLabel<T>(group: ListGroup<T>, spanOf: (row: T) => { start: string; end: string | null }): string {
  const n = group.members.length;
  if (group.kind === 'parts') return `Alle ${n} delen`;
  const s = spanOf(group.lead);
  const start = toMs(s.start);
  const end = toMs(s.end);
  return `Alle ${n} ${Number.isFinite(start) && Number.isFinite(end) && isNight(start, end) ? 'nachten' : 'dagen'}`;
}

/** The note on a parts row: "3 delen van deze straat" (or "weg" when it has a road number). */
export function partsNote(n: number, hasRoad: boolean): string {
  return `${n} delen van deze ${hasRoad ? 'weg' : 'straat'}`;
}
