/**
 * The verdict of a measure over time — contract v4, `ItemDetail.tl` / `tlTo` / `periods`.
 *
 * v3 flattened a DATEX situation to one window, one period mask and one verdict, and took the three
 * from different records: the window was the hull over all records, the mask came from the main
 * record only, and `impactOf()` weighed every record at once without looking at time. A street
 * works in eight phases whose last phase closed only the cycle path read "dicht voor iedereen" for
 * 80 days; a sports event whose ten closures all fell on the Sunday read "dicht" from Thursday on.
 *
 * Here every situation record keeps its own validity. Time is cut at every boundary of every
 * record, and each stretch gets the verdict of exactly the records that apply during it.
 *
 * When a record applies (`activityOf`):
 *   1. its own validPeriods, when it has real blocks. Blocks closer together than a minute are one
 *      block — publishers round to the minute, and "dagelijks 00:00–23:59" must not produce a gap;
 *   2. otherwise, for a record that shares the main record's window, the main record's blocks — the
 *      dominant pattern: 98% of the situations with measures publish the blocks (e.g. the nights) on
 *      the main record and give every measure the overall window. When the record itself carries
 *      an umbrella (one period over its whole window), that umbrella stays as its shadow: outside
 *      the main record's blocks the stretch reads `onbekend`, never a gap;
 *   3. otherwise its own start..end — a phase with a window of its own, or a record whose own
 *      blocks fill its whole window (it says explicitly that it applies throughout).
 *
 * An "umbrella" — one validPeriod spanning the record's whole window, next to real blocks — is not
 * treated as a block, but not thrown away either. Publishers use it both as a planning envelope
 * around the actual working days ("Alexander de Grotelaan": 9 March to 2 October around two days)
 * and as the real extent of a long closure ("V.a. maandag 10-08 Kerkesteeg afgesloten": one day
 * inside 324). Which one it is cannot be told from the data, so a stretch covered only by an
 * umbrella is published as `onbekend`: never "geen hinder", never an invented seven-month closure.
 *
 * What is published (`buildTimeline`), from local midnight of the run day:
 *   - `periods`  the blocks in which the measure applies, when there are gaps (as in v3);
 *   - `tl`       the segments with their own verdict, only when the verdict changes over time —
 *                for the ~98% whose verdict is the same in every block, `periods` says it all and
 *                the files stay as small as they were;
 *   - `tlTo`     up to where the timeline is known, when the verdict still changes after the
 *                window ("to", a day past the data horizon) or the list had to be capped; beyond it
 *                the answer is "unknown", never "no hindrance". When nothing changes any more after
 *                the window, the last stretch simply runs on to the end of the item instead.
 * Clipping at local midnight instead of the run clock keeps the output byte-identical between the
 * runs of one day (see startOfLocalDay in time.js).
 */
import { startOfLocalDay, toMinuteIso, UPCOMING_DAYS } from './time.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Publishers round phase boundaries to the minute; a seam this small is not a gap. */
const SLACK_MS = 60 * 1000;
/** Safety cap; within the ~31-day window even a daily pattern stays far below it. */
export const MAX_SEGMENTS = 400;

/** Record types that carry a traffic measure (as opposed to the situation's main description). */
const MANAGEMENT_TYPES = new Set(['RoadOrCarriagewayOrLaneManagement', 'SpeedManagement', 'GeneralNetworkManagement', 'ReroutingManagement']);

/** Precedence, strongest first — the same order `impactOf()` documents. */
const IMPACT_ORDER = ['dicht', 'rijbaan', 'hinder', 'geen', 'onbekend'];
const rank = (/** @type {string} */ imp) => {
  const i = IMPACT_ORDER.indexOf(imp);
  return i < 0 ? IMPACT_ORDER.length : i;
};

/** The verdict of a stretch covered by nothing but an umbrella period. */
const UMBRELLA_VERDICT = Object.freeze({ imp: 'onbekend' });

/**
 * @typedef {object} TimedRecord
 * @property {import('./impact.js').ImpactRecord} m   the record reduced to what the verdict reads
 * @property {string=} start
 * @property {string=} end
 * @property {[string, string|undefined][]=} periods
 * @property {boolean} isMain
 */

/** @typedef {{ imp: string, veh?: string[] }} Verdict */
/** @typedef {[number, number, Verdict]} Segment   start ms, end ms (may be +Infinity), verdict */
/** @typedef {[number, number][]} Intervals        sorted, non-overlapping [start, end] ms */

/**
 * The window a timeline covers for a run at `nowMs`: from local midnight of the run day to local
 * midnight a day past the data horizon (UPCOMING_DAYS). Both ends change once a day.
 * @param {number} nowMs
 */
export function timelineWindow(nowMs) {
  const floor = startOfLocalDay(nowMs);
  // Noon keeps the arithmetic clear of the hour that goes missing or doubles on DST nights.
  const to = startOfLocalDay(floor + (UPCOMING_DAYS + 1) * DAY_MS + 12 * 60 * 60 * 1000);
  return { floor, to };
}

/** @param {string | undefined} iso @param {number} fallback */
function msOr(iso, fallback) {
  const n = Date.parse(iso ?? '');
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Sorts and merges intervals that overlap or lie within SLACK_MS of each other.
 * @param {[number, number][]} list
 * @returns {Intervals}
 */
function mergeIntervals(list) {
  const sorted = list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @type {Intervals} */
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s - last[1] <= SLACK_MS) {
      if (e > last[1]) last[1] = e;
    } else out.push([s, e]);
  }
  return out;
}

/** @param {Intervals} list @param {number} s @param {number} e @returns {Intervals} */
function intersect(list, s, e) {
  /** @type {Intervals} */
  const out = [];
  for (const [a, b] of list) {
    const lo = Math.max(a, s);
    const hi = Math.min(b, e);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

/**
 * The record's own window [start, end]; a missing start falls back to the main record's, a missing
 * end means open ended.
 * @param {TimedRecord} rec @param {TimedRecord} main
 * @returns {[number, number]}
 */
function windowOf(rec, main) {
  return [msOr(rec.start ?? main.start, Number.NEGATIVE_INFINITY), msOr(rec.end, Number.POSITIVE_INFINITY)];
}

/**
 * A record's validPeriods split into real blocks and umbrella periods. Blocks that together fill
 * the record's whole window are no blocks at all: the record is then simply valid throughout
 * (`continuous`).
 * @param {TimedRecord} rec @param {TimedRecord} main
 * @returns {{ blocks: Intervals, umbrella: Intervals, continuous: boolean }}
 */
function blocksOf(rec, main) {
  const [s0, e0] = windowOf(rec, main);
  /** @type {[number, number][]} */
  const real = [];
  /** @type {[number, number][]} */
  const umbrella = [];
  for (const [a, b] of rec.periods ?? []) {
    const s = msOr(a, Number.NaN);
    if (!Number.isFinite(s)) continue;
    const e = msOr(b, Number.POSITIVE_INFINITY);
    if (e <= s) continue;
    if (s <= s0 + SLACK_MS && e >= e0 - SLACK_MS) umbrella.push([s, e]);
    else real.push([s, e]);
  }
  const blocks = mergeIntervals(real);
  if (blocks.length === 1 && blocks[0][0] <= s0 + SLACK_MS && blocks[0][1] >= e0 - SLACK_MS) return { blocks: [], umbrella: [], continuous: true };
  // Kept also without real blocks: a record that inherits the main record's blocks (rule 2) must
  // not lose its own claim to its whole window — that claim is exactly what an umbrella is.
  return { blocks, umbrella: mergeIntervals(umbrella), continuous: false };
}

/**
 * When a record applies (`on`), and where it is covered by nothing but an umbrella (`shadow`).
 * See the rules in the module comment.
 * @param {TimedRecord} rec
 * @param {TimedRecord} main
 * @param {Intervals} mainBlocks   the main record's real blocks (may be empty)
 * @returns {{ on: Intervals, shadow: Intervals }}
 */
export function activityOf(rec, main, mainBlocks) {
  const own = blocksOf(rec, main);
  if (own.blocks.length > 0) return { on: own.blocks, shadow: own.umbrella };
  const [s, e] = windowOf(rec, main);
  if (e <= s) return { on: [], shadow: [] };
  // Only a record that SHARES the main window inherits its blocks. One whose window merely lies
  // inside it is a phase of its own: the Lijsterbeslaan in Leusden has a roadClosed child that shuts
  // the street for part of the works, on days the main record lists no block — inheriting the blocks
  // would make it read "Geen hinder · buiten werktijden" on a day the street is closed.
  const [ms0, me0] = windowOf(main, main);
  const shares = Math.abs(s - ms0) <= SLACK_MS && (e === me0 || Math.abs(e - me0) <= SLACK_MS);
  // Blocks that fill the record's own window say "valid throughout" in so many words; inheriting
  // the main record's narrower blocks would invent gaps in a closure the publisher gave no gaps.
  if (!rec.isMain && own.continuous) return { on: [[s, e]], shadow: [] };
  // The record's own umbrella is its shadow: a closure that published one period over its whole
  // window next to a main record with nightly blocks reads "dicht" in the nights and `onbekend`
  // in between — whether that period is an envelope or the real closure cannot be told.
  if ((rec.isMain || shares) && mainBlocks.length > 0) return { on: intersect(mainBlocks, s, e), shadow: intersect(own.umbrella, s, e) };
  return { on: [[s, e]], shadow: [] };
}

/**
 * The main record's real blocks, by the same rule every record is read with.
 * @param {TimedRecord} main
 */
function mainBlocksOf(main) {
  return blocksOf(main, main).blocks;
}

/**
 * Every stretch during which any record applies or is covered by an umbrella, merged, unclipped —
 * what "is this item alive now / when does it start" must be decided on. windowState() read the
 * main record's blocks only, which filed items whose closure phase runs today under "gepland" and
 * left them off the map for "Nu".
 * @param {TimedRecord[]} records
 * @returns {[string, string|undefined][] | undefined}   undefined when there are no records
 */
export function activityUnion(records) {
  const main = records.find((r) => r.isMain) ?? records[0];
  if (!main) return undefined;
  const blocks = mainBlocksOf(main);
  /** @type {[number, number][]} */
  const all = [];
  for (const r of records) {
    const a = activityOf(r, main, blocks);
    all.push(...a.on, ...a.shadow);
  }
  return mergeIntervals(all).map(([s, e]) => [new Date(s).toISOString(), Number.isFinite(e) ? new Date(e).toISOString() : undefined]);
}

/** @param {Verdict} a @param {Verdict} b */
function sameVerdict(a, b) {
  return a.imp === b.imp && (a.veh ?? []).join(',') === (b.veh ?? []).join(',');
}

/**
 * The heaviest verdict over a set of segments. Among the segments of the heaviest level, one that
 * applies to all traffic wins over restricted ones — it closes the road for everyone — and
 * otherwise the vehicle groups are united in the order the verdicts already use.
 * @param {Verdict[]} verdicts
 * @returns {Verdict | undefined}
 */
export function heaviest(verdicts) {
  if (verdicts.length === 0) return undefined;
  const best = Math.min(...verdicts.map((v) => rank(v.imp)));
  const top = verdicts.filter((v) => rank(v.imp) === best);
  const imp = top[0].imp;
  if (top.some((v) => !v.veh || v.veh.length === 0)) return { imp };
  const order = ['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other'];
  const set = new Set(top.flatMap((v) => v.veh ?? []));
  return { imp, veh: order.filter((g) => set.has(g)) };
}

/**
 * Who the item concerns at all, over every stretch that has an effect: undefined (everyone) as soon
 * as one such stretch applies to all traffic. Taking only the vehicles of the heaviest stretch hid a
 * measure from lorry drivers and cyclists whose lighter phase did concern them.
 * @param {Verdict[]} verdicts
 * @returns {string[] | undefined}
 */
export function concernedVehicles(verdicts) {
  const relevant = verdicts.filter((v) => v.imp !== 'geen');
  if (relevant.length === 0 || relevant.some((v) => !v.veh || v.veh.length === 0)) return undefined;
  const order = ['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other'];
  const set = new Set(relevant.flatMap((v) => v.veh ?? []));
  return order.filter((g) => set.has(g));
}

/**
 * Cuts time at every boundary of every record and judges each stretch.
 * @param {object} input
 * @param {TimedRecord[]} input.records
 * @param {string=} input.itemStart                          the item's own start (the hull over all records)
 * @param {string=} input.itemEnd                            the item's own end (undefined = open ended)
 * @param {number} input.nowMs
 * @param {(active: TimedRecord[]) => Verdict} input.judge   the verdict of the records active in one stretch
 * @returns {{
 *   segments: Segment[],
 *   periods?: [string, string][],
 *   tl?: [string, string, string, string[]?][],
 *   tlTo?: string,
 *   heaviest?: Verdict,
 *   veh?: string[],
 * }}
 */
export function buildTimeline({ records, itemStart, itemEnd, nowMs, judge }) {
  const main = records.find((r) => r.isMain) ?? records[0];
  if (!main) return { segments: [] };
  const { floor, to } = timelineWindow(nowMs);
  const itemEndMs = msOr(itemEnd, Number.POSITIVE_INFINITY);

  const blocks = mainBlocksOf(main);
  const clip = (/** @type {Intervals} */ iv) => intersect(iv, floor, itemEndMs);
  const acts = records.map((r) => {
    const a = activityOf(r, main, blocks);
    return { r, on: clip(a.on), shadow: clip(a.shadow) };
  });
  const counts = (/** @type {TimedRecord} */ r) => r.isMain || MANAGEMENT_TYPES.has(r.m.type);

  // The item's own end is always a boundary (+Infinity when it is open ended): without it, the
  // stretch between the last record boundary and the end of the item was never looked at, and a
  // block ending on 11 November inside an item running to 18 December read as "runs on unchanged".
  const cuts = new Set([floor, to, itemEndMs]);
  for (const { on, shadow } of acts) for (const [s, e] of [...on, ...shadow]) cuts.add(s).add(e);
  const bounds = [...cuts].filter((b) => b >= floor).sort((x, y) => x - y);

  /**
   * The verdict of the stretch [a, b), or null when nothing applies in it (a gap).
   * @param {number} a @param {number} b
   * @returns {Verdict | null}
   */
  const stretch = (a, b) => {
    const covers = (/** @type {Intervals} */ iv) => iv.some(([s, e]) => s <= a && e >= b);
    const active = acts.filter(({ on }) => covers(on)).map(({ r }) => r);
    if (active.some(counts)) return judge(active);
    if (acts.some(({ r, shadow }) => counts(r) && covers(shadow))) return UMBRELLA_VERDICT;
    return null;
  };

  /** @type {Segment[]} */
  const segments = [];
  let capped = false;
  let i = 0;
  for (; i < bounds.length - 1 && bounds[i] < to; i++) {
    const a = bounds[i];
    const b = Math.min(bounds[i + 1], to);
    if (b <= a) continue;
    const verdict = stretch(a, b);
    if (!verdict) continue;
    const prev = segments[segments.length - 1];
    // A seam of at most a minute between two stretches is rounding, not a gap.
    if (prev && a - prev[1] <= SLACK_MS && sameVerdict(prev[2], verdict)) {
      prev[1] = b;
      continue;
    }
    if (prev && a - prev[1] <= SLACK_MS) prev[1] = a;
    if (segments.length === MAX_SEGMENTS) {
      capped = true;
      break;
    }
    segments.push([a, b, verdict]);
  }
  if (segments.length === 0) return { segments };

  // Past `to`: does the verdict still change before the item ends? Walk on stretch by stretch and
  // stop at the first gap or the first different verdict. If there is none, the last stretch runs
  // on to the end of the item; if there is one, past `to` the answer is "unknown".
  const last = segments[segments.length - 1];
  const runsOn = itemEndMs > to;
  // The state the window ends in: the last verdict if it reaches `to`, or "nothing applies".
  const stateAtTo = last[1] >= to - SLACK_MS ? last[2] : null;
  let changesAfter = false;
  if (runsOn && !capped) {
    let steps = 0;
    for (let j = bounds.findIndex((x) => x >= to); j >= 0 && j < bounds.length - 1; j++) {
      const a = Math.max(bounds[j], to);
      const b = bounds[j + 1];
      if (b <= a) continue;
      const verdict = stretch(a, b);
      if (!verdict && b - a <= SLACK_MS) continue; // a seam, as inside the window
      const same = verdict === null ? stateAtTo === null : stateAtTo !== null && sameVerdict(verdict, stateAtTo);
      if (!same || ++steps > MAX_SEGMENTS) {
        changesAfter = true;
        break;
      }
    }
  }
  if (runsOn && !capped && !changesAfter && stateAtTo !== null) last[1] = itemEndMs; // may be +Infinity: an open end

  const top = heaviest(segments.map((s) => s[2]));
  const veh = concernedVehicles(segments.map((s) => s[2]));
  const varies = segments.some((s) => !sameVerdict(s[2], segments[0][2]));

  // Gaps: stretches inside the item's life during which nothing applies. The item's life starts at
  // its own start (the hull over all records), not the main record's: a record from before the main
  // record began would otherwise hide a gap ("Mijdrecht": 19 days "dicht" before anything applied).
  const lifeStart = Math.max(floor, msOr(itemStart ?? main.start, floor));
  const lifeEnd = changesAfter || capped ? Math.min(to, itemEndMs) : itemEndMs;
  let gaps = segments[0][0] > lifeStart + SLACK_MS || segments[segments.length - 1][1] < lifeEnd - SLACK_MS;
  for (let k = 1; k < segments.length && !gaps; k++) if (segments[k][0] > segments[k - 1][1]) gaps = true;

  /** An end of +Infinity is written as '' — the open-end convention periods already used. */
  const endIso = (/** @type {number} */ e) => (Number.isFinite(e) ? toMinuteIso(e) : '');

  /** @type {[string, string][] | undefined} */
  let periods;
  if (gaps) {
    // Merge touching segments regardless of verdict: `periods` answers "when does it apply".
    /** @type {[number, number][]} */
    const merged = [];
    for (const [s, e] of segments) {
      const prev = merged[merged.length - 1];
      if (prev && prev[1] === s) prev[1] = e;
      else merged.push([s, e]);
    }
    periods = merged.map(([s, e]) => /** @type {[string, string]} */ ([toMinuteIso(s), endIso(e)]));
  }

  const tl = varies
    ? segments.map(([s, e, v]) => {
        /** @type {[string, string, string, string[]?]} */
        const seg = [toMinuteIso(s), endIso(e), v.imp];
        if (v.veh && v.veh.length > 0) seg.push([...v.veh]);
        return seg;
      })
    : undefined;

  const tlTo = capped ? toMinuteIso(segments[segments.length - 1][1]) : changesAfter ? toMinuteIso(to) : undefined;

  return { segments, periods, tl, tlTo, heaviest: top, veh };
}
