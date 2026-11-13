/**
 * Both directions closed, published as two situations.
 *
 * A road authority that closes a road in both directions often files each direction as its own
 * situation: two carriageway closures on the same road, at the same place, for the same times, one
 * `positive` and one `negative`. `impactOf()` looks at one situation at a time and calls each of
 * them `rijbaan` — one direction closed, the other may be open — while the two together say
 * nobody gets through. Measured on the data of 2026-11-12: 59 of the 117 one-direction closures
 * on Rijkswaterstaat's N-roads had such a twin.
 *
 * This pass finds the twins and raises both to `dicht`. It is deliberately strict, because a
 * wrong "Weg dicht" sends people on a detour for nothing:
 *   - the same road number, both for all traffic, and neither a closed ramp or connector that a
 *     related situation raised (`SIDE_SUBS`): its own records do not close the carriageway;
 *   - opposite directions;
 *   - exactly the same start, end, working periods and timeline;
 *   - the same place: the stretch names mirror each other (A → B against B → A) or the midpoints
 *     lie within `MAX_APART_M` of each other.
 * A northbound closure at one junction and a southbound one ten kilometres on, in the same night,
 * are not a pair. Runs after de-duplication, so a planning object and its live measure count once.
 */

import { SIDE_SUBS } from './impact.js';

/** Midpoints further apart than this are different places (metres). */
export const MAX_APART_M = 1000;

const M_PER_DEG_LAT = 111_320;

/**
 * @typedef {object} PairItem
 * @property {string} id
 * @property {[number, number]} mid   [lon, lat]
 * @property {Record<string, unknown>} props
 * @property {Record<string, unknown>} detail
 * @property {object=} qa
 */

/**
 * @param {PairItem[]} items  final items (after roll-up and de-duplication); mutated in place
 * @returns {{ raised: number }}
 */
export function raiseBothWayPairs(items) {
  /** @type {Map<string, PairItem[]>} */
  const groups = new Map();
  for (const item of items) {
    if (!isCandidate(item)) continue;
    const key = [item.props.road, item.props.start, item.props.end ?? '', timesKey(item)].join('|');
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  /** @type {Map<PairItem, string>} */
  const twinOf = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const forward = group.filter((i) => i.detail.dir === 'positive');
    const backward = group.filter((i) => i.detail.dir === 'negative');
    for (const a of forward) {
      const b = backward.find((candidate) => samePlace(a, candidate));
      if (!b) continue;
      if (!twinOf.has(a)) twinOf.set(a, b.id);
      if (!twinOf.has(b)) twinOf.set(b, a.id);
    }
  }

  for (const [item, twinId] of twinOf) {
    item.props.imp = 'dicht';
    raiseTimeline(/** @type {unknown[][] | undefined} */ (item.detail.tl));
    if (item.qa) /** @type {{ pair?: string }} */ (item.qa).pair = twinId;
  }
  return { raised: twinOf.size };
}

/** @param {PairItem} item */
function isCandidate(item) {
  const p = item.props;
  if (p.imp !== 'rijbaan' || p.veh !== undefined || typeof p.road !== 'string' || p.road === '') return false;
  if (SIDE_SUBS.has(/** @type {string} */ (p.sub))) return false;
  return item.detail.dir === 'positive' || item.detail.dir === 'negative';
}

/** The working periods and the timeline as one string: twins must match on both. */
/** @param {PairItem} item */
function timesKey(item) {
  return JSON.stringify([item.detail.periods ?? null, item.detail.tl ?? null, item.detail.tlTo ?? null]);
}

/** @param {PairItem} a @param {PairItem} b */
function samePlace(a, b) {
  const mirrored = typeof a.detail.from === 'string' && typeof a.detail.to === 'string' && a.detail.from === b.detail.to && a.detail.to === b.detail.from;
  return mirrored || metresApart(a.mid, b.mid) <= MAX_APART_M;
}

/**
 * Planar distance, good to a few metres over the kilometre this is used for.
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
function metresApart(a, b) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * M_PER_DEG_LAT * Math.cos(lat);
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/**
 * The one-direction stretches of the timeline become closed both ways; lighter and heavier
 * stretches keep their own verdict.
 * @param {unknown[][] | undefined} tl
 */
function raiseTimeline(tl) {
  if (!tl) return;
  for (let i = 0; i < tl.length; i++) {
    const seg = tl[i];
    if (seg[2] === 'rijbaan' && seg[3] === undefined) tl[i] = [seg[0], seg[1], 'dicht'];
  }
}
