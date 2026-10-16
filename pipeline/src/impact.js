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
 * Read from the publisher's words, and only ever making the verdict heavier (`by` in the result):
 *   - "<weg> is dicht" / "<weg> is afgesloten" next to a detour record: `rijbaan` on A/N (`dicht`
 *     with "in beide richtingen"), `dicht` elsewhere — `by: 'tekst'`;
 *   - Melvin's label "Weg dicht in beide richtingen" → at least `dicht`, "Weg dicht in een
 *     richting" → at least `rijbaan`, unless the closure records restrict vehicles — `by: 'gevolg'`;
 *   - that label over a closure whose vehicle list leaves out cars, when the list is not credible
 *     (`listLeavesOutCars`): the closure counts for everyone — `overruled` keeps the list.
 * Disagreements the other way are explained on the site, not acted on (src/consistency.js).
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
 * @property {string=} gevolg                             Melvin's "gevolg voor het verkeer" label, lower case
 *                                                        (`gevolgOf()` in src/consistency.js)
 * @property {ImpactRecord[]=} allRecords                 every record of the situation, also those not in
 *                                                        force in this stretch (the detour check reads them)
 */

/**
 * `by` says the verdict was not read from a measure record: `gevolg` = Melvin's dropdown,
 * `tekst` = a sentence like "De A15 is afgesloten" next to a detour. The site explains those.
 * `overruled` is the closure's own vehicle list when the label made it count for everyone.
 * @typedef {{ imp: Impact, veh?: Vehicle[], by?: 'gevolg'|'tekst', overruled?: Vehicle[], per?: true, spd?: number, lc?: number }} ImpactResult
 */

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
 * "Afgesloten" is read the same way ("De A15 is afgesloten tussen Gorinchem en Deil", 2026-10-12:
 * six RWS night closures read "doorrijden mogelijk"), but only when the words before it are not a
 * lane, a ramp, a path or a car park — those leave the road usable — and not when it is "afgesloten
 * voor vrachtverkeer", which is about one kind of traffic. "Is dicht" keeps its reading of
 * 2026-09 unchanged ("De A2 tunnelbuis vanuit Eindhoven is dicht" = rijbaan).
 */
const CLOSED_BY_TEXT_RE = /\b(?:is|zijn)\s+dicht\b(?!\s*bij\b)/i;
const AFGESLOTEN_RE = /\b(?:is|zijn)\s+afgesloten\b(?!\s+voor\s+(?!(?:al(?:le|l)?\s+(?:het\s+)?|het\s+)?(?:doorgaand\s+)?verkeer\b))/i;
const NOT_THE_ROAD_RE =
  /\b(?:rijstro(?:ok|ken)|op-?\s*en\s*afrit|oprit(?:ten)?|afrit(?:ten)?|toerit|fiets\w*|voet\w*|trottoir|stoep|parkeer\w*|carpool\w*|verzorgingsplaats|vluchtstrook|spitsstrook|plusstrook|wisselbaan|busbaan)\b/i;

const BOTH_WAYS_RE = /\bbeide\s+richtingen\b/i;

/** Melvin's dropdown labels that state a closure, and the verdict they stand for. */
const GEVOLG_VERDICT = Object.freeze({
  'weg dicht in beide richtingen': 'dicht',
  'weg dicht in een richting': 'rijbaan',
});
const WEAKER_THAN_RIJBAAN = new Set(['hinder', 'geen', 'onbekend']);

/**
 * True when Melvin's label (lower case, `gevolgOf()`) says the road is closed in one or both
 * directions.
 * @param {string | undefined} gevolg
 */
export function labelClosesRoad(gevolg) {
  return GEVOLG_VERDICT[gevolg ?? ''] !== undefined;
}

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
  /** @type {ImpactResult['by']} */
  let by;
  /** @type {string | undefined} */
  let sentence;
  if (closedRecs.length > 0 || ctx.cat === 'brug') {
    imp = 'dicht';
    winning = closedRecs;
  } else if (carriagewayRecs.length > 0) {
    imp = 'rijbaan';
    winning = carriagewayRecs;
  } else if (rerouteRecs.length > 0 && (sentence = closedByText(textOf(ctx)))) {
    // Same reading as `carriagewayClosures`: on a road with two carriageways "de A6 is dicht"
    // means this carriageway, and the other direction stays open — unless the sentence says "in
    // beide richtingen". The detour's vehicle list says who the detour is for, not who the road is
    // closed to, so it does not narrow this verdict.
    imp = dual && !BOTH_WAYS_RE.test(sentence) ? 'rijbaan' : 'dicht';
    winning = [];
    by = 'tekst';
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

  // Melvin's "gevolg voor het verkeer" is a drop-down the publisher fills in, not prose. On
  // 2026-10-12 about 140 situations said "Weg dicht in beide richtingen" there without a closure
  // record (only a detour, a speed limit or nothing) and the site printed "doorrijden mogelijk".
  // It only ever makes the verdict heavier. Over a closure with a vehicle list it usually means
  // that list ("weg dicht" over a closure for bicycles is a closed cycle path), except when the list
  // itself is not credible (`listLeavesOutCars`): then the closure counts for everyone.
  const byLabel = GEVOLG_VERDICT[ctx.gevolg ?? ''];
  const listed = vehiclesOf(winning);
  // Only a closure's list: a lane closure for some vehicles is not what the label overrules.
  const closing = imp === 'dicht' || imp === 'rijbaan';
  const overruled = byLabel && closing && listed && listLeavesOutCars(listed, ctx.allRecords ?? recs) ? listed : undefined;
  const unrestricted = listed === undefined || overruled !== undefined;
  if ((byLabel && WEAKER_THAN_RIJBAAN.has(imp)) || (byLabel === 'dicht' && imp === 'rijbaan' && unrestricted)) {
    imp = byLabel;
    winning = [];
    by = 'gevolg';
  }

  /** @type {ImpactResult} */
  const out = { imp };
  const veh = overruled ? undefined : vehiclesOf(winning);
  if (veh) out.veh = veh;
  if (by) out.by = by;
  if (overruled) out.overruled = overruled;
  if (ctx.hasPeriods) out.per = true;
  if (ctx.speed !== undefined && ctx.speed > 0) out.spd = ctx.speed;
  if (ctx.lanes?.closed !== undefined && ctx.lanes.closed > 0) out.lc = ctx.lanes.closed;
  return out;
}

/** @param {ImpactContext} ctx */
function textOf(ctx) {
  return (ctx.texts ?? []).filter(Boolean).join('\n');
}

/**
 * True when a sentence says the road itself is closed ("De A15 is afgesloten tussen …"). The
 * words before the verb are its subject: "de rijstrook is afgesloten" is not about the road.
 * Exported for the consistency check, which quotes the sentence.
 * @param {string} text
 * @returns {string | undefined} the sentence
 */
export function closedByText(text) {
  const sentences = sentencesOf(text);
  // "Is dicht" is read over the whole text, as before 2026-10-12: a line break inside the phrase
  // ("De A2 is⏎dicht") must not undo it. The sentence is only for the quote.
  const flat = text.replace(/\s+/g, ' ');
  const dicht = CLOSED_BY_TEXT_RE.exec(flat);
  if (dicht) return sentences.find((s) => CLOSED_BY_TEXT_RE.test(s)) ?? flat.slice(Math.max(0, dicht.index - 60), dicht.index + dicht[0].length).trim();
  return sentences.find((s) => {
    const m = AFGESLOTEN_RE.exec(s);
    return m !== null && !NOT_THE_ROAD_RE.test(s.slice(0, m.index));
  });
}

/**
 * Sentences of publisher text, without the closing full stop. A full stop only ends a sentence
 * before a capital, and not after an abbreviation: "i.v.m. de bouw" and "De rijstrook t.h.v.
 * Vianen is afgesloten" stay in one piece.
 * @param {string} text
 * @returns {string[]}
 */
export function sentencesOf(text) {
  /** @type {string[]} */
  const out = [];
  for (const line of text.split(/\n|\s\|\s/)) {
    let current = '';
    for (const piece of line.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/)) {
      if (current && ABBREVIATION_END_RE.test(current)) {
        current = `${current} ${piece}`;
      } else {
        pushSentence(out, current);
        current = piece;
      }
    }
    pushSentence(out, current);
  }
  return out;
}

/** "t.h.v.", "i.v.m.", "ca.", "nr." at the end of a piece: not the end of a sentence. */
const ABBREVIATION_END_RE = /(?:^|\s)(?:[a-z]\.(?:[a-z]+\.)+|[a-z]{1,3}\.)$/;

/** @param {string[]} out @param {string} s */
function pushSentence(out, s) {
  const t = s.trim().replace(/[.!?]+$/, '');
  if (t) out.push(t);
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
 * DATEX `forVehiclesWithCharacteristicsOf` restricts the record it sits on and
 * nothing else. Until 2026-09-23 a closure without a list of its own took the
 * list of its DETOUR as its audience; measured on the feed of that day it touched
 * 225 situations, and nearly all of them read "Weg dicht in beide richtingen —
 * de weg is afgesloten voor al het verkeer" next to a detour for cyclists. The
 * site then told car drivers "Geldt niet voor auto's" about a street closed to
 * them. That fallback caused 2.233 of the 2.416 dangerous answers an independent
 * check found. A closure without its own list now applies to all traffic: over-
 * warning a footbridge closure to drivers is the lesser error.
 * @param {ImpactRecord[]} winning
 * @returns {Vehicle[] | undefined}
 */
function vehiclesOf(winning) {
  if (winning.length === 0) return undefined;
  const restricted = winning.filter((r) => r.vehicles && r.vehicles.length > 0);
  if (restricted.length === 0) return undefined;
  return restricted.length === winning.length ? unionOf(restricted) : undefined;
}

const HEAVY_GROUPS = new Set(['lorry', 'bus']);
const SLOW_GROUPS = new Set(['bicycle', 'moped']);

/**
 * True when a closure's vehicle list that leaves out cars cannot be what the publisher meant, given
 * that Melvin's label says "weg dicht". Two signs, each enough (review 2026-10-16, the 95 situations
 * whose label said "weg dicht" over a list without cars):
 *   - the list bans heavy traffic AND bicycles or mopeds: works that let only cars through do not
 *     exist ("Mijnsherenlaan": lorries, buses, tractors, mopeds and bicycles — asphalting);
 *   - the situation sends ALL traffic along a detour (a ReroutingManagement record without a
 *     vehicle list) while the closure names only some ("Johan Willem Frisostraat": bicycles).
 * The real cycle-path closures and lorry bans under the same label fail both: a cycle path bans
 * bicycles and mopeds (sometimes tractors) and diverts cyclists; a lorry ban diverts lorries.
 * The detour counts when the situation has one at all, not only in this stretch: a detour with a
 * shorter window must not flip the verdict back and forth over time.
 * @param {Vehicle[]} listed   the closure's vehicle groups
 * @param {ImpactRecord[]} recs every record of the situation
 */
function listLeavesOutCars(listed, recs) {
  if (listed.includes('car')) return false;
  const heavyAndSlow = listed.some((v) => HEAVY_GROUPS.has(v)) && listed.some((v) => SLOW_GROUPS.has(v));
  const detourForAll = recs.some((r) => r.type === 'ReroutingManagement' && !(r.vehicles && r.vehicles.length > 0));
  return heavyAndSlow || detourForAll;
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
