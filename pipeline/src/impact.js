/**
 * Impact verdict — what a measure means for someone who wants to use the road
 * (`Impact` in web/src/data/types.ts). Evaluated over ALL records of the merged
 * situation, so a MaintenanceWorks parent with a roadClosed child is `dicht`.
 *
 * Precedence: dicht > rijbaan > hinder > geen > onbekend.
 *
 * | Verdict    | When                                                                                  |
 * |------------|---------------------------------------------------------------------------------------|
 * | `dicht`    | a `roadClosed` record; `carriagewayClosures` on a road that is not A or N (local       |
 * |            | streets and stadsroutes have one carriageway, so "rijbaan dicht" closes the street);   |
 * |            | or a bridge opening (cat `brug`)                                                        |
 * | `rijbaan`  | `carriagewayClosures` on an A- or N-road (the other direction may be open)             |
 * | `hinder`   | lane closed / deviated / narrowed, use of specified lanes, spitsstrook, a temporary     |
 * |            | speed limit, `lanes.closed > 0`, traffic lights or verkeersregelaars, a signed detour,  |
 * |            | cat `file` / `incident`, a delay band of `upToTenMinutes` or worse on a `werk` item, or |
 * |            | ten minutes or more on any other item                                                   |
 * | `geen`     | delay band `negligible` and none of the above; events without any traffic measure       |
 * | `onbekend` | nothing above applies                                                                   |
 *
 * `veh` is the union of `forVehiclesWithCharacteristicsOf` over the records
 * that produced the winning verdict — but only when every one of those records
 * restricts vehicles: one unrestricted `roadClosed` next to a `roadClosed` for
 * bicycles still closes the road for everyone.
 *
 * The published list is never second-guessed from the free text. A heuristic that
 * rewrote a bare `['car']` to `['bicycle']` whenever the description mentioned a
 * fietspad was tried and removed on 2026-09-21: it was right for about five of the
 * 37 situations it touched and dangerously wrong for the rest, because a municipal
 * works description almost always names a path somewhere. Worse, the commonest
 * phrasing it hit is "rijbaan dicht muv fietsers en voetgangers" — the roadway is
 * shut EXCEPT for bicycles — which it inverted into "only affects bicycles", telling
 * drivers they could pass a street that was closed to them. Interpretation notes:
 *   - a delay band on an `evenement`/`overig` item only counts from
 *     `betweenTenMinutesAndThirtyMinutes` (Melvin's default for works is
 *     `upToTenMinutes`, which the spec wants as `hinder` on works; on an event
 *     "up to ten minutes" with no measure is `geen`);
 *   - `temporaryTrafficLights` / `trafficBeingManuallyDirected` and a lone
 *     `ReroutingManagement` record are treated as `hinder` (the road is usable,
 *     with a regulator, lights or a detour) — neither is in the literal list.
 */

/** @typedef {'dicht'|'rijbaan'|'hinder'|'geen'|'onbekend'} Impact */
/** @typedef {'car'|'lorry'|'bicycle'|'moped'|'bus'|'agricultural'|'other'} Vehicle */

/**
 * @typedef {object} ImpactRecord   the subset of a parsed SituationRecord the verdict reads
 * @property {string} type
 * @property {string=} lane           roadOrCarriagewayOrLaneManagementType
 * @property {number=} lanesRestricted
 * @property {string=} speedType
 * @property {number=} speed
 * @property {string=} gnm
 * @property {string=} rerouteType
 * @property {string[]=} vehicles
 */

/**
 * @typedef {object} ImpactContext
 * @property {string} cat                                 item category
 * @property {string=} roadType                           A | N | S | E | lokaal
 * @property {string=} delay                              merged delay band
 * @property {boolean=} hasPeriods                        the item has recurring sub-periods (ItemDetail.periods)
 * @property {{ closed?: number }=} lanes                 merged lanes
 * @property {number=} speed                              merged temporary speed limit
 * @property {(string | undefined)[]=} texts              comment / description, for the path check
 */

/** @typedef {{ imp: Impact, veh?: Vehicle[], per?: true, spd?: number, lc?: number }} ImpactResult */

const DUAL_CARRIAGEWAY_ROAD_TYPES = new Set(['A', 'N']);
const HINDER_LANE_TYPES = new Set([
  'laneClosures',
  'lanesDeviated',
  'narrowLanes',
  'useOfSpecifiedLanesOrCarriagewaysAllowed',
  'hardShoulderRunningInOperation',
]);
const HINDER_NETWORK_TYPES = new Set(['temporaryTrafficLights', 'trafficBeingManuallyDirected']);
const MEASURE_TYPES = new Set(['RoadOrCarriagewayOrLaneManagement', 'SpeedManagement', 'GeneralNetworkManagement', 'ReroutingManagement']);
const LIVE_HINDER_CATS = new Set(['file', 'incident']);

/**
 * Rijkswaterstaat states the closure in prose on the parent situation and puts the `roadClosed`
 * records on its children (see src/rollup.js). Where the family link is missing from the feed,
 * the sentence plus a detour record is all there is to go on, and it beats printing "doorrijden
 * mogelijk" under the words "De A2 is dicht".
 *
 * The negative lookahead is not decoration: in Dutch "is dicht bij Hank" means "is NEAR Hank".
 */
const CLOSED_BY_TEXT_RE = /\b(?:is|zijn)\s+dicht\b(?!\s*bij\b)/i;

/** Delay bands in increasing order of hindrance. */
const DELAY_ORDER = [
  'negligible',
  'upToTenMinutes',
  'betweenTenMinutesAndThirtyMinutes',
  'betweenThirtyMinutesAndOneHour',
  'betweenOneHourAndThreeHours',
  'longerThanThreeHours',
];

/** DATEX vehicleType → Vehicle group. */
const VEHICLE_GROUPS = Object.freeze({
  car: 'car',
  lorry: 'lorry',
  heavyGoodsVehicle: 'lorry',
  heavyVehicle: 'lorry',
  bicycle: 'bicycle',
  moped: 'moped',
  bus: 'bus',
  agriculturalVehicle: 'agricultural',
});
const VEHICLE_ORDER = ['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other'];

/**
 * @param {ImpactRecord[]} recs   all records of the situation
 * @param {ImpactContext} ctx
 * @returns {ImpactResult}
 */
export function impactOf(recs, ctx) {
  const dual = DUAL_CARRIAGEWAY_ROAD_TYPES.has(ctx.roadType ?? '');
  const closedRecs = recs.filter((r) => r.lane === 'roadClosed' || (r.lane === 'carriagewayClosures' && !dual));
  const carriagewayRecs = recs.filter((r) => r.lane === 'carriagewayClosures' && dual);
  const hinderRecs = recs.filter(isHinderRecord);
  const rerouteRecs = recs.filter((r) => r.type === 'ReroutingManagement');

  /** @type {Impact} */
  let imp;
  /** @type {ImpactRecord[]} */
  let winning;
  if (closedRecs.length > 0 || ctx.cat === 'brug') {
    imp = 'dicht';
    winning = closedRecs;
  } else if (carriagewayRecs.length > 0) {
    imp = 'rijbaan';
    winning = carriagewayRecs;
  } else if (rerouteRecs.length > 0 && CLOSED_BY_TEXT_RE.test(textOf(ctx))) {
    // Same reading as `carriagewayClosures`: on a road with two carriageways "de A6 is dicht"
    // means this carriageway, and the other direction stays open.
    imp = dual ? 'rijbaan' : 'dicht';
    winning = rerouteRecs;
  } else if (hinderRecs.length > 0 || LIVE_HINDER_CATS.has(ctx.cat) || (ctx.lanes?.closed ?? 0) > 0 || delayIsHinder(ctx)) {
    imp = 'hinder';
    winning = hinderRecs;
  } else if (ctx.delay === 'negligible' || (ctx.cat === 'evenement' && !recs.some((r) => MEASURE_TYPES.has(r.type)))) {
    imp = 'geen';
    winning = [];
  } else {
    imp = 'onbekend';
    winning = [];
  }

  /** @type {ImpactResult} */
  const out = { imp };
  const veh = vehiclesOf(winning, recs);
  if (veh) out.veh = veh;
  if (ctx.hasPeriods) out.per = true;
  if (ctx.speed !== undefined && ctx.speed > 0) out.spd = ctx.speed;
  if (ctx.lanes?.closed !== undefined && ctx.lanes.closed > 0) out.lc = ctx.lanes.closed;
  return out;
}

/** @param {ImpactContext} ctx */
function textOf(ctx) {
  return (ctx.texts ?? []).filter(Boolean).join(' ');
}

/** @param {ImpactRecord} r */
function isHinderRecord(r) {
  if (r.lane && HINDER_LANE_TYPES.has(r.lane)) return true;
  if (r.type === 'SpeedManagement' || r.speed !== undefined) return true;
  if ((r.lanesRestricted ?? 0) > 0) return true;
  if (r.gnm && HINDER_NETWORK_TYPES.has(r.gnm)) return true;
  if (r.type === 'ReroutingManagement') return true;
  return false;
}

/** @param {ImpactContext} ctx */
function delayIsHinder(ctx) {
  const rank = DELAY_ORDER.indexOf(ctx.delay ?? '');
  if (rank < 0) return false;
  const threshold = ctx.cat === 'werk' ? DELAY_ORDER.indexOf('upToTenMinutes') : DELAY_ORDER.indexOf('betweenTenMinutesAndThirtyMinutes');
  return rank >= threshold;
}

/**
 * Vehicle groups the winning records restrict themselves to. Absent when any
 * winning record applies to all traffic, or when no record restricts vehicles.
 *
 * Fallback: a `ReroutingManagement` record's vehicle list says who the DETOUR
 * is for — which usually equals who the closure is for (in the planning feed
 * the two lists agree in ~80 % of the situations that carry both). It is only
 * used when none of the winning records has a vehicle list of its own, and
 * only when every rerouting record that has one agrees, so a bicycle detour
 * next to an unrestricted car detour never narrows the closure to bicycles.
 * @param {ImpactRecord[]} winning
 * @param {ImpactRecord[]} recs
 * @returns {Vehicle[] | undefined}
 */
function vehiclesOf(winning, recs) {
  if (winning.length === 0) return undefined;
  const restricted = winning.filter((r) => r.vehicles && r.vehicles.length > 0);
  if (restricted.length > 0) {
    return restricted.length === winning.length ? unionOf(restricted) : undefined;
  }
  const reroutes = recs.filter((r) => r.type === 'ReroutingManagement');
  if (reroutes.length === 0 || !reroutes.every((r) => r.vehicles && r.vehicles.length > 0)) return undefined;
  return unionOf(reroutes);
}

/** @param {ImpactRecord[]} recs @returns {Vehicle[]} */
function unionOf(recs) {
  const set = new Set();
  for (const r of recs) for (const v of r.vehicles ?? []) set.add(vehicleGroup(v));
  return VEHICLE_ORDER.filter((v) => set.has(v));
}

/** @param {string} vehicleType @returns {Vehicle} */
export function vehicleGroup(vehicleType) {
  return VEHICLE_GROUPS[vehicleType] ?? 'other';
}
