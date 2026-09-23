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
 *   1. its own validPeriods, when it has real blocks (an "umbrella" period spanning its own window
 *      is a publication artefact, see merge.js periodsOf);
 *   2. otherwise, for a record that shares the main record's window, the main record's blocks —
 *      the dominant pattern: 98% of the situations with measures publish the blocks (e.g. the
 *      nights) on the main record and give every measure the overall window;
 *   3. otherwise its own start..end — a phase with a window of its own.
 *
 * What is published (`buildTimeline`), all clipped to [local midnight of the run day, `to`]:
 *   - `periods`  the blocks in which the measure applies, when there are gaps (as in v3);
 *   - `tl`       the segments with their own verdict, only when the verdict changes over time —
 *                for the ~98% whose verdict is the same in every block, `periods` says it all and
 *                the files stay as small as they were;
 *   - `tlTo`     up to where the blocks are known, when the item runs on past `to` or the list had
 *                to be capped: beyond it the answer is "unknown", never "no hindrance".
 * Clipping at local midnight instead of the run clock keeps the output byte-identical between the
 * runs of one day (see startOfLocalDay in time.js).
 */
import { startOfLocalDay, toMinuteIso, UPCOMING_DAYS } from './time.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Publishers round phase boundaries to the minute. */
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

/**
 * @typedef {object} TimedRecord
 * @property {import('./impact.js').ImpactRecord} m   the record reduced to what the verdict reads
 * @property {string=} start
 * @property {string=} end
 * @property {[string, string|undefined][]=} periods
 * @property {boolean} isMain
 */

/** @typedef {{ imp: string, veh?: string[] }} Verdict */
/** @typedef {[number, number, Verdict]} Segment   start ms, end ms, verdict */

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
 * Real blocks of a record: its validPeriods, de-duplicated, without a period that spans the
 * record's own window on its own.
 * @param {TimedRecord} rec
 * @returns {[number, number][]}
 */
function ownBlocks(rec) {
  const s0 = msOr(rec.start, Number.NEGATIVE_INFINITY);
  const e0 = msOr(rec.end, Number.POSITIVE_INFINITY);
  const seen = new Set();
  /** @type {[number, number][]} */
  const out = [];
  for (const [a, b] of rec.periods ?? []) {
    const s = msOr(a, Number.NaN);
    if (!Number.isFinite(s)) continue;
    const e = msOr(b, Number.POSITIVE_INFINITY);
    if (e <= s) continue;
    const key = `${s}|${e}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (s <= s0 + SLACK_MS && e >= e0 - SLACK_MS) continue; // umbrella over the record's own window
    out.push([s, e]);
  }
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * True when two records share their window (within SLACK_MS; two open ends count as equal).
 * @param {TimedRecord} a @param {TimedRecord} b
 */
function sameWindow(a, b) {
  const as = msOr(a.start, Number.NaN);
  const bs = msOr(b.start, Number.NaN);
  const startsMatch = (Number.isNaN(as) && Number.isNaN(bs)) || Math.abs(as - bs) <= SLACK_MS;
  const ae = msOr(a.end, Number.NaN);
  const be = msOr(b.end, Number.NaN);
  const endsMatch = (Number.isNaN(ae) && Number.isNaN(be)) || Math.abs(ae - be) <= SLACK_MS;
  return startsMatch && endsMatch;
}

/**
 * When a record applies, as [start, end] ms intervals (end may be +Infinity). See the rules in the
 * module comment.
 * @param {TimedRecord} rec
 * @param {TimedRecord} main
 * @param {[number, number][]} mainBlocks   the main record's real blocks (may be empty)
 * @returns {[number, number][]}
 */
export function activityOf(rec, main, mainBlocks) {
  const own = ownBlocks(rec);
  if (own.length > 0) return own;
  const window = /** @type {[number, number]} */ ([
    msOr(rec.start ?? main.start, Number.NEGATIVE_INFINITY),
    msOr(rec.end, Number.POSITIVE_INFINITY),
  ]);
  if ((rec.isMain || sameWindow(rec, main)) && mainBlocks.length > 0) return mainBlocks;
  return window[1] > window[0] ? [window] : [];
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
 * Cuts time at every boundary of every record and judges each stretch.
 * @param {object} input
 * @param {TimedRecord[]} input.records
 * @param {[string, string|undefined][]=} input.mainBlocks   merged.periods: the main record's real blocks
 * @param {string=} input.itemEnd                            the item's own end (undefined = open ended)
 * @param {number} input.nowMs
 * @param {(active: TimedRecord[]) => Verdict} input.judge   the verdict of the records active in one stretch
 * @returns {{
 *   segments: Segment[],
 *   periods?: [string, string][],
 *   tl?: [string, string, string, string[]?][],
 *   tlTo?: string,
 *   heaviest?: Verdict,
 * }}
 */
export function buildTimeline({ records, mainBlocks, itemEnd, nowMs, judge }) {
  const main = records.find((r) => r.isMain) ?? records[0];
  if (!main) return { segments: [] };
  const { floor, to } = timelineWindow(nowMs);

  /** @type {[number, number][]} */
  const blocks = [];
  for (const [a, b] of mainBlocks ?? []) {
    const s = msOr(a, Number.NaN);
    const e = msOr(b, Number.POSITIVE_INFINITY);
    if (Number.isFinite(s) && e > s) blocks.push([s, e]);
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  const acts = records.map((r) => ({
    r,
    iv: activityOf(r, main, blocks)
      .map(([s, e]) => /** @type {[number, number]} */ ([Math.max(s, floor), Math.min(e, to)]))
      .filter(([s, e]) => e > s),
  }));

  const cuts = new Set([floor, to]);
  for (const { iv } of acts) for (const [s, e] of iv) cuts.add(s).add(e);
  const bounds = [...cuts].sort((x, y) => x - y);

  /** @type {Segment[]} */
  const segments = [];
  let capped = false;
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const active = acts.filter(({ iv }) => iv.some(([s, e]) => s <= a && e >= b)).map(({ r }) => r);
    const mainActive = active.some((r) => r.isMain);
    const measureActive = active.some((r) => !r.isMain && MANAGEMENT_TYPES.has(r.m.type));
    if (!mainActive && !measureActive) continue; // a gap: nothing applies
    const verdict = judge(active);
    const prev = segments[segments.length - 1];
    if (prev && prev[1] === a && sameVerdict(prev[2], verdict)) {
      prev[1] = b;
      continue;
    }
    if (segments.length === MAX_SEGMENTS) {
      capped = true;
      break;
    }
    segments.push([a, b, verdict]);
  }
  if (segments.length === 0) return { segments };

  // What lies past `to`? Either nothing changes any more until the item ends — then the last
  // stretch simply continues, and cutting it at `to` would make a reader conclude "outside every
  // block, so no hindrance" — or something does change, and past `to` the honest answer is
  // "unknown". Without this check a block ending on 11 November inside an item that runs into
  // December read as "applies" for the whole of November.
  const itemEndMs = msOr(itemEnd, Number.POSITIVE_INFINITY);
  const runsOn = itemEndMs > to;
  let changesAfter = false;
  if (runsOn && !capped) {
    outer: for (const r of records) {
      for (const [s, e] of activityOf(r, main, blocks)) {
        if ((s >= to && s < itemEndMs) || (e >= to && e < itemEndMs)) {
          changesAfter = true;
          break outer;
        }
      }
    }
  }
  const last = segments[segments.length - 1];
  const extended = runsOn && !capped && !changesAfter && last[1] === to;
  if (extended) last[1] = itemEndMs; // may be +Infinity: an open end

  const top = heaviest(segments.map((s) => s[2]));
  const varies = segments.some((s) => !sameVerdict(s[2], segments[0][2]));

  // Gaps: stretches inside the item's life during which no record applies. The main record's
  // start is where that life begins for this purpose.
  const lifeStart = Math.max(floor, msOr(main.start, floor));
  const lifeEnd = extended ? itemEndMs : Math.min(to, itemEndMs);
  let gaps = segments[0][0] > lifeStart || segments[segments.length - 1][1] < lifeEnd;
  for (let i = 1; i < segments.length && !gaps; i++) if (segments[i][0] > segments[i - 1][1]) gaps = true;

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

  return { segments, periods, tl, tlTo, heaviest: top };
}
