/**
 * Fold the records of one situation into a single flat item.
 *
 * Parent/main record → title inputs, description, period, source, status,
 * hindrance, probability, url, type of works. Child records → closure flag,
 * lanes, speed, detour text, vehicles, delay/queue, AlertC references.
 */

import { mainRecord } from './classify.js';
import { detourGeomOf } from './detour.js';

const MAX_DESC = 2000;
const MAX_PERIODS_KEPT = 400;

/**
 * @typedef {object} Merged
 * @property {string} id
 * @property {string=} comment        first warning comment (title candidate)
 * @property {string=} causeDesc
 * @property {string=} desc           public comments (other + remaining warnings), never internalNote
 * @property {string=} start
 * @property {string=} end
 * @property {[string, string|undefined][]=} periods
 * @property {string=} src            source name as published
 * @property {string=} status
 * @property {string=} hind
 * @property {string=} prob
 * @property {string=} url
 * @property {string=} works
 * @property {{closed?: number, open?: number, total?: number}=} lanes
 * @property {number=} speed
 * @property {string=} detour
 * @property {string[]=} vehicles
 * @property {string=} delay
 * @property {number=} delaySec
 * @property {number=} queueM
 * @property {string=} roadNr         sit:roadOrJunctionNumber (rerouting records)
 * @property {[number, number][]=} detourGeom   simplified alternativeRoute of the first rerouting record with one
 * @property {import('./impact.js').ImpactRecord[]} measures   every record reduced to what the impact verdict reads
 * @property {{p?: string, s?: string, dir?: string}=} alertC
 * @property {string=} ris
 * @property {import('./parse.js').Location[]} locations   main record first
 * @property {string=} upd
 * @property {string} mainType
 */

/**
 * @param {import('./parse.js').Situation} situation
 * @returns {Merged}
 */
export function mergeSituation(situation) {
  const recs = situation.recs;
  const main = mainRecord(recs) ?? { id: situation.id, type: 'Unknown', locs: [] };
  const ordered = [main, ...recs.filter((r) => r !== main)];

  const warning = firstComment(ordered, 'warning');
  const desc = joinComments(ordered, warning);

  /** @type {Merged} */
  const merged = {
    id: situation.id,
    mainType: main.type,
    comment: warning,
    causeDesc: main.causeDesc ?? firstDefined(ordered, (r) => r.causeDesc),
    desc,
    start: minIso(ordered.map((r) => r.start)),
    end: main.end === undefined ? undefined : maxIso(ordered.map((r) => r.end)),
    periods: periodsOf(main),
    src: main.src ?? firstDefined(ordered, (r) => r.src),
    status: main.status ?? firstDefined(ordered, (r) => r.status),
    hind: main.hind ?? firstDefined(ordered, (r) => r.hind),
    prob: main.prob,
    url: firstDefined(ordered, (r) => r.urls?.[0]),
    works: worksOf(main),
    lanes: lanesOf(recs),
    speed: minNumber(recs.filter((r) => r.type === 'SpeedManagement').map((r) => r.speed)),
    detour: joinUnique(recs.map((r) => r.detour), '\n'),
    vehicles: uniqueStrings(recs.flatMap((r) => r.vehicles ?? [])),
    roadNr: firstDefined(recs, (r) => r.roadNr),
    detourGeom: detourGeomOf(recs),
    measures: recs.map(measureOf),
    upd: situation.ver ?? main.ver,
    locations: ordered.flatMap((r) => (r.type === 'ReroutingManagement' ? [] : r.locs)),
  };
  if (merged.locations.length === 0) merged.locations = ordered.flatMap((r) => r.locs);

  const traffic = recs.find((r) => r.type === 'AbnormalTraffic');
  const delaySource = traffic ?? main;
  merged.delay = delaySource.delayBand ?? firstDefined(ordered, (r) => r.delayBand);
  merged.delaySec = delaySource.delaySec ?? firstDefined(ordered, (r) => r.delaySec);
  merged.queueM = traffic?.queue;

  const withAlertC = merged.locations.find((l) => l.alertC?.p);
  merged.alertC = withAlertC?.alertC;
  merged.ris = merged.locations.find((l) => l.ris)?.ris;

  return compact(merged);
}

/** @param {import('./parse.js').SituationRecord[]} recs @param {string} type */
function firstComment(recs, type) {
  for (const r of recs) {
    const c = r.comments?.find((x) => x.type === type);
    if (c) return clean(c.text);
  }
  return undefined;
}

/**
 * All public comments except the one used as title, de-duplicated, in record
 * order, one per line. `internalNote` never reaches this point (dropped by
 * the parser).
 * @param {import('./parse.js').SituationRecord[]} recs
 * @param {string | undefined} title
 */
function joinComments(recs, title) {
  const seen = new Set();
  /** @type {string[]} */
  const parts = [];
  for (const r of recs) {
    for (const c of r.comments ?? []) {
      if (c.type === 'internalNote') continue;
      const t = clean(c.text);
      if (!t || t === title || seen.has(t)) continue;
      seen.add(t);
      parts.push(t);
    }
  }
  if (parts.length === 0) return undefined;
  const joined = parts.join('\n');
  return joined.length > MAX_DESC ? joined.slice(0, MAX_DESC - 1).trimEnd() + '…' : joined;
}

/**
 * Normalise publisher text for display: HTML removed, entities decoded, runs
 * of spaces collapsed and **exactly one newline between paragraphs** (the UI
 * renders one line per paragraph). Empty result → undefined.
 * @param {string | undefined} s
 */
export function clean(s) {
  if (!s) return undefined;
  const t = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Recurring sub-periods, or undefined when the record is simply valid for its
 * whole window. Melvin often repeats the same `validPeriod` (once per record
 * copy), so identical pairs collapse first — two copies of the whole window
 * are still "the whole window", not a recurring measure (`per` must stay off).
 * @param {import('./parse.js').SituationRecord} main
 */
function periodsOf(main) {
  const periods = main.periods;
  if (!periods || periods.length === 0) return undefined;
  const seen = new Set();
  /** @type {[string, string|undefined][]} */
  const unique = [];
  for (const p of periods) {
    const key = `${p[0]}|${p[1] ?? ''}`;
    if (!p[0] || seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  if (unique.length === 0) return undefined;
  // An "umbrella" validPeriod that spans the whole window next to the real blocks is a
  // publication artefact, not evidence that the measure runs continuously. Left in, it wrecks
  // `coversWholeWindow` below: sorted first, it sets `reach` to the end of the window in one
  // step, every real block then falls inside it, and the function concludes that the periods are
  // continuous — so all of them are thrown away. Measured on the feed of 19 September 2026 that
  // silently flattened 101 published measures, 58 of them `dicht`: the Alexander de Grotelaan in
  // Utrecht was reported shut from 9 March to 2 October while the municipality had only filed
  // Tuesday 22 and Thursday 24 September, 07:00-16:00.
  const real = unique.filter((p) => !spansWholeWindow(p, main.start, main.end));
  if (real.length === 0) return undefined;
  const sorted = real.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (coversWholeWindow(sorted, main.start, main.end)) return undefined;
  return sorted.length > MAX_PERIODS_KEPT ? sorted.slice(0, MAX_PERIODS_KEPT) : sorted;
}

/**
 * True when this single period covers (nearly) the entire window on its own.
 * @param {[string, string|undefined]} period
 * @param {string | undefined} start
 * @param {string | undefined} end
 */
function spansWholeWindow([s, e], start, end) {
  const sMs = Date.parse(s);
  const eMs = Date.parse(e ?? '');
  const startMs = Date.parse(start ?? '');
  const endMs = Date.parse(end ?? '');
  if (![sMs, eMs, startMs, endMs].every((n) => Number.isFinite(n))) return false;
  return sMs <= startMs + PERIOD_SLACK_MS && eMs >= endMs - PERIOD_SLACK_MS;
}

/** Slack for publishers that round the phase boundaries to the minute. */
const PERIOD_SLACK_MS = 60 * 1000;

/**
 * Melvin phases ("fase 1" 09-14 → 09-28, "fase 2" 09-28 → 10-05) are published
 * as validPeriods that meet or overlap and together fill the whole window: the
 * measure is continuous, so they are no recurring sub-periods either. True
 * when the union of the (sorted) periods is one interval from start to end.
 * Open ends (period or window) and unparseable timestamps never match.
 * @param {[string, string|undefined][]} sorted
 * @param {string | undefined} start
 * @param {string | undefined} end
 */
function coversWholeWindow(sorted, start, end) {
  const startMs = Date.parse(start ?? '');
  const endMs = Date.parse(end ?? '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  let reach;
  for (const [s, e] of sorted) {
    const sMs = Date.parse(s);
    const eMs = Date.parse(e ?? '');
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) return false;
    if (reach === undefined) {
      if (sMs > startMs + PERIOD_SLACK_MS) return false;
    } else if (sMs > reach + PERIOD_SLACK_MS) {
      return false;
    }
    if (reach === undefined || eMs > reach) reach = eMs;
  }
  return reach !== undefined && reach >= endMs - PERIOD_SLACK_MS;
}

/**
 * The handful of fields `impactOf()` reads, without locations or comments, so
 * the verdict can be computed after geocoding (it needs the road type) while
 * the record copies with their coordinates are long gone.
 * @param {import('./parse.js').SituationRecord} r
 * @returns {import('./impact.js').ImpactRecord}
 */
function measureOf(r) {
  return compact({
    type: r.type,
    lane: r.lane,
    lanesRestricted: r.lanesRestricted,
    speedType: r.speedType,
    speed: r.speed,
    gnm: r.gnm,
    rerouteType: r.rerouteType,
    vehicles: r.vehicles,
  });
}

/** @param {import('./parse.js').SituationRecord} main */
function worksOf(main) {
  if (main.maint && main.maint !== 'other') return main.maint;
  if (main.subject && main.subject !== 'other') return main.subject;
  if (main.type === 'ConstructionWorks') return 'constructionWork';
  if (main.event) return main.event;
  return main.maint ?? main.subject;
}

/** @param {import('./parse.js').SituationRecord[]} recs */
function lanesOf(recs) {
  const laneRecs = recs.filter((r) => r.type === 'RoadOrCarriagewayOrLaneManagement');
  const closed = maxNumber(laneRecs.map((r) => r.lanesRestricted));
  const open = minNumber(laneRecs.map((r) => r.lanesOperational));
  const total = maxNumber(recs.flatMap((r) => r.locs.map((l) => l.lanesTotal)));
  if (closed === undefined && open === undefined && total === undefined) return undefined;
  return compact({ closed, open, total });
}

/**
 * @template T
 * @param {import('./parse.js').SituationRecord[]} recs
 * @param {(r: import('./parse.js').SituationRecord) => T | undefined} pick
 */
function firstDefined(recs, pick) {
  for (const r of recs) {
    const v = pick(r);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** @param {(string | undefined)[]} values */
function minIso(values) {
  let best;
  for (const v of values) if (v !== undefined && (best === undefined || v < best)) best = v;
  return best;
}

/** @param {(string | undefined)[]} values */
function maxIso(values) {
  let best;
  for (const v of values) if (v !== undefined && (best === undefined || v > best)) best = v;
  return best;
}

/** @param {(number | undefined)[]} values */
function minNumber(values) {
  let best;
  for (const v of values) if (v !== undefined && (best === undefined || v < best)) best = v;
  return best;
}

/** @param {(number | undefined)[]} values */
function maxNumber(values) {
  let best;
  for (const v of values) if (v !== undefined && (best === undefined || v > best)) best = v;
  return best;
}

/** @param {(string | undefined)[]} values @param {string} sep */
function joinUnique(values, sep) {
  const unique = uniqueStrings(values.map(clean));
  return unique ? unique.join(sep) : undefined;
}

/** @param {(string | undefined)[]} values */
function uniqueStrings(values) {
  const out = [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))];
  return out.length > 0 ? /** @type {string[]} */ (out) : undefined;
}

/**
 * @template {object} T
 * @param {T} obj
 */
function compact(obj) {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key];
  return obj;
}
