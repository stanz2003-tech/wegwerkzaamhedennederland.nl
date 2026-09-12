/**
 * Category / sub type / severity classification — docs/onderzoek.md §2.2.
 *
 * Order per situation (first match wins; `closed` is always set as a flag):
 * file → incident → brug → evenement → afsluiting → werk → overig.
 * `file` only for AbnormalTraffic from the live feed (`actueel_beeld`); in the
 * planning feed AbnormalTraffic is "expected hindrance" and stays an attribute.
 */

/** @typedef {'werk'|'afsluiting'|'file'|'incident'|'brug'|'evenement'|'overig'} Category */
/** @typedef {'planning'|'live'|'bridges'} FeedRole */

/** DATEX II overallSeverity → 0..4 */
export const SEVERITY = Object.freeze({
  none: 0,
  lowest: 0,
  low: 1,
  medium: 2,
  unknown: 2,
  high: 3,
  highest: 4,
});

export const CLOSURE_TYPES = new Set(['roadClosed', 'carriagewayClosures']);
const INCIDENT_TYPES = new Set(['Accident', 'VehicleObstruction', 'GeneralObstruction', 'EnvironmentalObstruction']);
const WORK_PARENT_TYPES = new Set(['MaintenanceWorks', 'ConstructionWorks']);
const WORK_CAUSES = new Set(['roadMaintenance', 'constructionWork']);
const MEASURE_TYPES = new Set(['RoadOrCarriagewayOrLaneManagement', 'SpeedManagement']);

/** Every record type the classifier knows how to place. */
export const KNOWN_TYPES = new Set([
  'MaintenanceWorks',
  'ConstructionWorks',
  'RoadOrCarriagewayOrLaneManagement',
  'ReroutingManagement',
  'SpeedManagement',
  'PublicEvent',
  'GeneralNetworkManagement',
  'AbnormalTraffic',
  'Accident',
  'VehicleObstruction',
  'GeneralObstruction',
  'EnvironmentalObstruction',
]);

/** Records that only describe consequences and never carry the main story. */
const SECONDARY_TYPES = new Set(['ReroutingManagement', 'SpeedManagement', 'RoadOrCarriagewayOrLaneManagement', 'GeneralNetworkManagement']);

/**
 * The record that carries title, period, source: a works/event parent when
 * present (Melvin `_BASE`/`_MAN`/`_EVE`, RWS `MAIN_ROADWORKS`), else the first
 * record that is not a pure measure, else the first record.
 * @param {import('./parse.js').SituationRecord[]} recs
 */
export function mainRecord(recs) {
  return (
    recs.find((r) => WORK_PARENT_TYPES.has(r.type) || r.type === 'PublicEvent') ??
    recs.find((r) => !SECONDARY_TYPES.has(r.type)) ??
    recs[0]
  );
}

/** @param {string | undefined} severity */
export function severityOf(severity) {
  return SEVERITY[severity ?? 'unknown'] ?? 2;
}

/**
 * @param {import('./parse.js').Situation} situation
 * @param {FeedRole} role
 * @returns {{ cat: Category, sub?: string, sev: 0|1|2|3|4, closed: boolean, unknown: string[] }}
 */
export function classify(situation, role) {
  const recs = situation.recs;
  const sev = /** @type {0|1|2|3|4} */ (severityOf(situation.sev));
  const unknown = recs.filter((r) => !KNOWN_TYPES.has(r.type)).map((r) => r.type);
  const closedRec = recs.find((r) => r.lane === 'roadClosed') ?? recs.find((r) => r.lane === 'carriagewayClosures');
  const closed = closedRec !== undefined;
  const main = mainRecord(recs);

  if (role === 'live') {
    const traffic = recs.find((r) => r.type === 'AbnormalTraffic');
    if (traffic) return { cat: 'file', sub: traffic.traffic, sev, closed, unknown };
  }

  const incident = recs.find((r) => INCIDENT_TYPES.has(r.type));
  if (incident) {
    // "other" says nothing; fall back to the record type (accident, vehicleObstruction …)
    const specific = incident.accident ?? incident.vehObs ?? incident.obstruction ?? incident.envObs;
    const sub = specific && specific !== 'other' ? specific : lowerFirst(incident.type);
    return { cat: 'incident', sub, sev, closed, unknown };
  }

  const bridge = recs.find((r) => r.gnm === 'bridgeSwingInOperation');
  if (bridge) return { cat: 'brug', sub: 'bridgeSwingInOperation', sev, closed, unknown };

  if (main?.type === 'PublicEvent' || recs.some((r) => r.cause === 'publicEvent')) {
    const event = recs.find((r) => r.type === 'PublicEvent') ?? main;
    return { cat: 'evenement', sub: event?.event ?? 'publicEvent', sev, closed, unknown };
  }

  if (closed) return { cat: 'afsluiting', sub: closedRec.lane, sev, closed, unknown };

  if (main && WORK_PARENT_TYPES.has(main.type)) {
    const sub = main.maint ?? (main.type === 'ConstructionWorks' ? 'constructionWork' : 'maintenanceWork');
    return { cat: 'werk', sub, sev, closed, unknown };
  }
  const workMeasure = recs.find((r) => MEASURE_TYPES.has(r.type) && WORK_CAUSES.has(r.cause ?? ''));
  if (workMeasure) {
    const sub = workMeasure.lane ?? workMeasure.speedType ?? 'maintenanceWork';
    return { cat: 'werk', sub, sev, closed, unknown };
  }

  return { cat: 'overig', sub: otherSub(recs, main), sev, closed, unknown };
}

/**
 * @param {import('./parse.js').SituationRecord[]} recs
 * @param {import('./parse.js').SituationRecord | undefined} main
 */
function otherSub(recs, main) {
  if (recs.some((r) => r.lane === 'hardShoulderRunningInOperation')) return 'spitsstrook';
  if (!main) return undefined;
  return main.lane ?? main.speedType ?? main.gnm ?? main.rerouteType ?? main.traffic ?? lowerFirst(main.type);
}

/** @param {string} s */
function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
