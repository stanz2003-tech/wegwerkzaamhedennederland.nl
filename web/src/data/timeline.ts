/**
 * Reading `ItemDetail.tl` (contract v4): what a measure does when.
 *
 * The pipeline cuts time at every boundary of every DATEX record and gives each stretch the
 * verdict of the records that apply during it (pipeline/src/timeline.js). This module turns that
 * list back into numbers and answers "which stretch covers this moment / touches this window".
 *
 * The data comes from outside, so it is validated row by row: a malformed row is skipped rather
 * than letting one bad publisher break the verdict of every item in a shard. An end of '' is an
 * open end (the item runs on without a known end), read as +Infinity.
 *
 * Pure; unit-tested in web/test/timeline.test.mjs.
 */
import type { Impact, Vehicle } from './types';

export interface TimeSegment {
  start: number;
  /** +Infinity for an open end. */
  end: number;
  imp: Impact;
  /** Vehicle groups the stretch applies to; null = all traffic. */
  veh: Vehicle[] | null;
}

/** Precedence, strongest first — the same order as the pipeline's `impactOf()`. */
const IMPACT_ORDER: readonly Impact[] = ['dicht', 'rijbaan', 'hinder', 'geen', 'onbekend'];
const VEHICLES: readonly Vehicle[] = ['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other'];

// Kept local on purpose: verdict.ts reads this module, so importing its validators back would
// make the two modules depend on each other.
function isImpact(v: unknown): v is Impact {
  return typeof v === 'string' && (IMPACT_ORDER as readonly string[]).includes(v);
}

function cleanVehicles(v: unknown): Vehicle[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is Vehicle => typeof x === 'string' && (VEHICLES as readonly string[]).includes(x));
  return out.length > 0 ? Array.from(new Set(out)) : null;
}

function rankOf(imp: Impact): number {
  const i = IMPACT_ORDER.indexOf(imp);
  return i < 0 ? IMPACT_ORDER.length : i;
}

/** Validated, sorted segments; [] when there is no (usable) timeline. */
export function parseTimeline(tl: unknown): TimeSegment[] {
  if (!Array.isArray(tl)) return [];
  const out: TimeSegment[] = [];
  for (const row of tl as unknown[]) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [s, e, imp, veh] = row as unknown[];
    if (typeof s !== 'string' || typeof e !== 'string' || !isImpact(imp)) continue;
    const start = Date.parse(s);
    const end = e === '' ? Number.POSITIVE_INFINITY : Date.parse(e);
    if (!Number.isFinite(start) || Number.isNaN(end) || end <= start) continue;
    out.push({ start, end, imp, veh: cleanVehicles(veh) });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The stretch that covers `at` (start inclusive, end exclusive), or null in a gap. */
export function segmentAt(segments: readonly TimeSegment[], at: number): TimeSegment | null {
  for (const s of segments) {
    if (s.start <= at && at < s.end) return s;
    if (s.start > at) break;
  }
  return null;
}

/** Every stretch that overlaps the window [from, to]. */
export function segmentsIn(segments: readonly TimeSegment[], from: number, to: number): TimeSegment[] {
  return segments.filter((s) => s.start <= to && s.end > from);
}

/** The heavier of two stretches; on a tie the one for all traffic wins. */
export function heavier(a: TimeSegment, b: TimeSegment): TimeSegment {
  const ra = rankOf(a.imp);
  const rb = rankOf(b.imp);
  if (ra !== rb) return ra < rb ? a : b;
  if (!a.veh) return a;
  if (!b.veh) return b;
  return a;
}

/**
 * The blocks in which the measure applies, touching stretches merged regardless of verdict, as
 * [iso, iso] pairs for the existing period wording ("ma–vr 22:00–05:00"). An open end is kept and
 * written as '' (the convention of `periods`): leaving it out made the item look inactive during
 * its last block, which is the one that runs on.
 */
export function periodsFromTimeline(segments: readonly TimeSegment[]): [string, string][] {
  const merged: { start: number; end: number }[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && last.end === s.start) last.end = s.end;
    else merged.push({ start: s.start, end: s.end });
  }
  return merged.map((p) => [new Date(p.start).toISOString(), Number.isFinite(p.end) ? new Date(p.end).toISOString() : '']);
}
