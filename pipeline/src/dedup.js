/**
 * De-duplication of the RWS double publication.
 *
 * Rijkswaterstaat publishes a running roadwork twice: the planning object in
 * the Melvin planning feed (`RWS01_SM1013188_D2`) and the actual measure in
 * `actueel_beeld` (`RWS01_SM1013188_D2_WWA`). Both describe the same closure,
 * so both used to appear on the map and in every list.
 *
 * The merge is deliberately conservative — a false merge hides a real closure,
 * which is worse than showing a duplicate — so **all four** conditions must
 * hold before two items are considered the same measure:
 *
 *   1. the same road number (both known and equal),
 *   2. overlapping validity windows (an absent end is open ended),
 *   3. geometry midpoints within `DEDUP_MAX_M` (250 m),
 *   4. the same publisher (`src`).
 *
 * When several planning items qualify for one actual measure (two works at the
 * same spot on the same road with overlapping windows) distance alone cannot
 * tell them apart, so nothing is merged.
 *
 * There is a second, narrower path for pairs the publisher has *declared*
 * (`relatedSituation`, or the same id base): those need no road number and may
 * be up to `DEDUP_PROVEN_MAX_M` apart, because the link — not the geometry —
 * is the evidence. The other conditions (publisher, window, no contradicting
 * road) still apply, so a recycled id can never merge two real measures.
 *
 * The item from `actueel_beeld` survives (it carries the live status); the
 * planning item is dropped, its id is attached to the survivor's detail as
 * `related`, and every field the survivor lacks is filled in from it — the
 * Melvin planning object is often the richer of the two, and merging must not
 * lose information.
 *
 * NOTE `ItemDetail.related?: string[]` and `Meta.merged?: number` are additions
 * to the data contract; `web/src/data/types.ts` is shared and read-only for
 * this workspace, so both still have to be declared there.
 *
 * The same pattern occurs one level down: `actueel_beeld` also republishes
 * municipal and provincial Melvin closures as `NDW18_<uuid>_SIT` measures.
 * Those have no id relation, so they merge on the four conditions alone;
 * `stats.unproven` lists exactly those pairs and `stats.nearMiss*` the pairs
 * that failed one condition, so the thresholds can be judged from a real run.
 */

/** Maximum distance between the two midpoints, in metres (unproven pairs). */
export const DEDUP_MAX_M = 250;

/**
 * Maximum distance when the publisher itself linked the two situations. The
 * planning object and the actual measure often describe different stretches of
 * the same works, so their midpoints can be a few hundred metres apart.
 */
export const DEDUP_PROVEN_MAX_M = 1000;

/**
 * Equirectangular metres — accurate well within a percent at Dutch latitudes.
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
export function metersBetween(a, b) {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/**
 * @param {{ start?: unknown, end?: unknown }} a
 * @param {{ start?: unknown, end?: unknown }} b
 */
export function windowsOverlap(a, b) {
  const ms = (/** @type {unknown} */ v, /** @type {number} */ fallback) => {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? fallback : t;
  };
  const aStart = ms(a.start, -Infinity);
  const aEnd = ms(a.end, Infinity);
  const bStart = ms(b.start, -Infinity);
  const bEnd = ms(b.end, Infinity);
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * @typedef {object} DedupStats
 * @property {number} merged            planning items folded into an actual measure
 * @property {number} actualsChecked
 * @property {number} candidates        pairs that passed road + window
 * @property {number} multiCandidate    actual measures with more than one qualifying planning item
 * @property {number} ambiguousSkipped  ambiguous sets where no id proved the pair — nothing merged
 * @property {number} blockedBySrc      candidates rejected because the publisher differs
 * @property {number} sameIdBase        merges where the ids only differ by the "_WWA" suffix
 * @property {number} declaredRelated   merges the publisher itself declared via relatedSituation
 * @property {number} crossCategory     merges where the two items had a different category
 * @property {number[]} distances       distance of every merge, metres
 * @property {number[]} nearMissM       nearest rejected candidate per unmerged actual, metres
 * @property {number} nearMissNoRoad    actual measures skipped because no road number is known
 * @property {number} enriched         survivors that gained a field from the dropped planning item
 * @property {string[]} unproven        merges that rest on road+window+distance+publisher alone
 *                                      (no relatedSituation link and no matching id base)
 */

/**
 * Fold RWS planning duplicates into their actual measure. Mutates the detail
 * of the surviving items and returns the items to publish.
 * @param {import('./item.js').Item[]} items
 * @returns {{ items: import('./item.js').Item[], stats: DedupStats }}
 */
export function dedupeDoublePublications(items) {
  /** @type {DedupStats} */
  const stats = {
    merged: 0,
    actualsChecked: 0,
    candidates: 0,
    multiCandidate: 0,
    ambiguousSkipped: 0,
    blockedBySrc: 0,
    sameIdBase: 0,
    declaredRelated: 0,
    crossCategory: 0,
    distances: [],
    nearMissM: [],
    nearMissNoRoad: 0,
    enriched: 0,
    unproven: [],
  };

  /** @type {Map<string, import('./item.js').Item[]>} */
  const planningByRoad = new Map();
  /** @type {Map<string, import('./item.js').Item>} */
  const planningById = new Map();
  /** @type {Map<string, import('./item.js').Item[]>} */
  const planningByBase = new Map();
  for (const item of items) {
    if (item.role !== 'planning') continue;
    planningById.set(item.id, item);
    const base = baseId(item.id);
    const sameBase = planningByBase.get(base);
    if (sameBase) sameBase.push(item);
    else planningByBase.set(base, [item]);
    const road = /** @type {string | undefined} */ (item.props.road);
    if (!road) continue;
    const list = planningByRoad.get(road);
    if (list) list.push(item);
    else planningByRoad.set(road, [item]);
  }

  const consumed = new Set();
  for (const actual of items) {
    if (actual.role !== 'live') continue;

    // Path B: the publisher itself says these are one publication. No geometric
    // guessing is needed, so a road number is not required and the distance may
    // be a whole kilometre (the two geometries often cover different stretches).
    const proof = provenTwin(actual, planningByBase, planningById, consumed);
    if (proof) {
      merge(actual, proof.item, proof.m);
      continue;
    }

    // Path A: no proof — all four conditions must hold.
    const road = /** @type {string | undefined} */ (actual.props.road);
    if (!road) {
      stats.nearMissNoRoad++;
      continue;
    }
    const pool = planningByRoad.get(road);
    if (!pool) continue;
    stats.actualsChecked++;

    /** @type {{ item: import('./item.js').Item, m: number }[]} */
    const qualifying = [];
    let nearest = Infinity;
    for (const planning of pool) {
      if (consumed.has(planning.id)) continue;
      if (!windowsOverlap(actual.props, planning.props)) continue;
      const m = metersBetween(actual.mid, planning.mid);
      if (m < nearest) nearest = m;
      if (m >= DEDUP_MAX_M) continue;
      if (actual.props.src !== planning.props.src) {
        stats.blockedBySrc++;
        continue;
      }
      qualifying.push({ item: planning, m });
    }
    stats.candidates += qualifying.length;
    if (qualifying.length === 0) {
      if (Number.isFinite(nearest)) stats.nearMissM.push(Math.round(nearest));
      continue;
    }
    // Several planning items at the same spot on the same road with the same
    // publisher: distance cannot tell them apart and no link proves any of them
    // (path B already handled every declared pair), so merge nothing.
    if (qualifying.length > 1) {
      stats.multiCandidate++;
      stats.ambiguousSkipped++;
      continue;
    }
    merge(actual, qualifying[0].item, qualifying[0].m);
  }

  /**
   * Drop `planning`, keep `actual`, move over what only the planning item knew.
   * @param {import('./item.js').Item} actual
   * @param {import('./item.js').Item} planning
   * @param {number} m
   */
  function merge(actual, planning, m) {
    consumed.add(planning.id);
    stats.merged++;
    stats.distances.push(Math.round(m));
    if (baseId(actual.id) === baseId(planning.id)) stats.sameIdBase++;
    if (actual.rel?.includes(planning.id) || planning.rel?.includes(actual.id)) stats.declaredRelated++;
    if (!isSamePublication(actual, planning)) stats.unproven.push(`${actual.id}<-${planning.id}@${Math.round(m)}m`);
    if (actual.cat !== planning.cat) stats.crossCategory++;
    if (absorb(actual, planning)) stats.enriched++;
    const related = /** @type {string[] | undefined} */ (actual.detail.related) ?? [];
    related.push(planning.id);
    actual.detail.related = related.sort();
  }

  return { items: items.filter((i) => !consumed.has(i.id)), stats };
}

/**
 * The planning item the publisher linked to this actual measure: same id base
 * ("RWS01_…_D2" for "RWS01_…_D2_WWA") or named in a `relatedSituation`. Still
 * requires overlapping windows, the same publisher, roads that do not
 * contradict each other and less than `DEDUP_PROVEN_MAX_M` between the
 * midpoints, so a stale or recycled id can never merge two real measures.
 * @param {import('./item.js').Item} actual
 * @param {Map<string, import('./item.js').Item[]>} byBase
 * @param {Map<string, import('./item.js').Item>} byId
 * @param {Set<string>} consumed
 * @returns {{ item: import('./item.js').Item, m: number } | undefined}
 */
function provenTwin(actual, byBase, byId, consumed) {
  /** @type {import('./item.js').Item[]} */
  const candidates = [...(byBase.get(baseId(actual.id)) ?? [])];
  for (const id of actual.rel ?? []) {
    const linked = byId.get(id);
    if (linked && !candidates.includes(linked)) candidates.push(linked);
  }
  /** @type {{ item: import('./item.js').Item, m: number } | undefined} */
  let best;
  for (const planning of candidates) {
    if (consumed.has(planning.id) || planning.id === actual.id) continue;
    if (actual.props.src !== planning.props.src) continue;
    if (!windowsOverlap(actual.props, planning.props)) continue;
    if (actual.props.road && planning.props.road && actual.props.road !== planning.props.road) continue;
    const m = metersBetween(actual.mid, planning.mid);
    if (m >= DEDUP_PROVEN_MAX_M) continue;
    if (!best || m < best.m) best = { item: planning, m };
  }
  return best;
}

/**
 * Fields the dropped planning item may contribute to the survivor. The Melvin
 * planning object is often the richer of the two (comments, detour, hindrance,
 * a link to melvin.ndw.nu), so dropping it must not lose that. Purely
 * additive: an existing value on the survivor is never overwritten, and the
 * fields that describe *what is happening right now* (cat, sub, sev, closed,
 * start, end) always stay the actual measure's own.
 */
const ABSORB_PROPS = Object.freeze(['hind', 'prob', 'gemeente', 'woonplaats', 'prov', 'veh', 'per', 'spd', 'lc']);
const ABSORB_DETAIL = Object.freeze(['desc', 'detour', 'lanes', 'speed', 'delay', 'delaySec', 'from', 'to', 'dir', 'status', 'url', 'vehicles', 'works', 'detourGeom']);
/**
 * When a measure applies (contract v4). These three describe one timeline together, so they are
 * taken over as a set or not at all: the survivor's own `periods` next to the dropped item's `tl`
 * would describe two different measures in one detail.
 */
const TIME_GROUP = Object.freeze(['periods', 'tl', 'tlTo']);

/**
 * @param {import('./item.js').Item} survivor
 * @param {import('./item.js').Item} dropped
 * @returns {boolean} true when at least one field was filled in
 */
export function absorb(survivor, dropped) {
  let filled = false;
  // `imp` is always set; only an actual measure that says nothing ("onbekend")
  // takes the verdict of the planning object it replaces.
  if (survivor.props.imp === 'onbekend' && dropped.props.imp !== undefined && dropped.props.imp !== 'onbekend') {
    survivor.props.imp = dropped.props.imp;
    filled = true;
  }
  for (const key of ABSORB_PROPS) {
    if (survivor.props[key] === undefined && dropped.props[key] !== undefined) {
      survivor.props[key] = dropped.props[key];
      filled = true;
    }
  }
  for (const key of ABSORB_DETAIL) {
    if (survivor.detail[key] === undefined && dropped.detail[key] !== undefined) {
      survivor.detail[key] = dropped.detail[key];
      filled = true;
    }
  }
  const survivorHasTime = TIME_GROUP.some((key) => survivor.detail[key] !== undefined);
  const droppedHasTime = TIME_GROUP.some((key) => dropped.detail[key] !== undefined);
  if (!survivorHasTime && droppedHasTime) {
    for (const key of TIME_GROUP) if (dropped.detail[key] !== undefined) survivor.detail[key] = dropped.detail[key];
    filled = true;
  }
  return filled;
}

/**
 * Proof that two items are the same publication: the publisher linked them with
 * `relatedSituation`, or the ids differ only by the actual-measure suffix.
 * @param {import('./item.js').Item} a
 * @param {import('./item.js').Item} b
 */
export function isSamePublication(a, b) {
  if (a.rel?.includes(b.id) || b.rel?.includes(a.id)) return true;
  return baseId(a.id) === baseId(b.id);
}

/** "RWS01_SM1013188_D2_WWA" and "RWS01_SM1013188_D2" share this base. */
/** @param {string} id */
export function baseId(id) {
  return id.replace(/_(?:WWA|SM|ACT)$/, '');
}

/** Compact percentile line for the run log. */
/** @param {number[]} values */
export function spread(values) {
  if (values.length === 0) return 'none';
  const s = [...values].sort((a, b) => a - b);
  const at = (/** @type {number} */ p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `n=${s.length} min=${s[0]} p50=${at(0.5)} p90=${at(0.9)} p99=${at(0.99)} max=${s[s.length - 1]}`;
}
