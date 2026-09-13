/**
 * Situation → Item: composes classify, merge, geometry, VILD, time window and
 * source hints into the internal item; `finalizeItem()` adds the geocoder
 * result, road detection, the display title and the impact verdict
 * (`src/impact.js`) and produces the exact `ItemProperties` / `ItemDetail`
 * shapes of the contract.
 */

import { classify } from './classify.js';
import { buildGeometry, midpoint } from './geometry.js';
import { impactOf } from './impact.js';
import { mergeSituation } from './merge.js';
import { detectRoad } from './roads.js';
import { friendlySource, normalizeProvince } from './sources-friendly.js';
import { toMinuteIso, upcomingPeriods, windowState } from './time.js';
import { buildTitle, TITLE_MAX } from './title.js';

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {'planning'|'live'} role
 * @property {'active'|'upcoming'} state
 * @property {import('./classify.js').Category} cat
 * @property {import('./geometry.js').Geometry} geometry
 * @property {[number, number]} mid
 * @property {string[]=} rel                   related situation ids the publisher declared
 * @property {string=} provCode
 * @property {Record<string, unknown>} props     ItemProperties (filled by finalizeItem)
 * @property {Record<string, unknown>} detail    ItemDetail (filled by finalizeItem)
 * @property {object} raw                        internal inputs for finalizeItem
 */

/**
 * @typedef {object} BuildContext
 * @property {import('./vild.js').Vild} vild
 * @property {number} nowMs
 * @property {(gemeente: string) => { prov: string, provCode: string } | undefined=} provOfGemeente
 */

/**
 * @param {import('./parse.js').Situation} situation
 * @param {'planning'|'live'} role
 * @param {BuildContext} ctx
 * @returns {{ item?: Item, skip?: 'ended'|'future'|'invalid'|'nogeom'|'notlive', dropped: number, unknown: string[] }}
 */
export function buildItem(situation, role, ctx) {
  const cls = classify(situation, role);
  const merged = mergeSituation(situation);
  const state = windowState(merged, ctx.nowMs);
  if (state === 'ended' || state === 'future' || state === 'invalid') return { skip: state, dropped: 0, unknown: cls.unknown };

  const isLiveCat = cls.cat === 'file' || cls.cat === 'incident' || cls.cat === 'brug';
  if (isLiveCat && (role !== 'live' || state !== 'active')) return { skip: 'notlive', dropped: 0, unknown: cls.unknown };

  const geo = buildGeometry(merged.locations, (alertC) => ctx.vild.point(alertC.p) ?? ctx.vild.point(alertC.s));
  if (!geo.geometry) return { skip: 'nogeom', dropped: geo.dropped + 1, unknown: cls.unknown };

  const alertC = ctx.vild.describe(merged.alertC);
  const source = friendlySource(merged.src);
  merged.locations = []; // coordinates now live in `geometry`; free the record copies
  const provFromGemeente = source.gemeente ? ctx.provOfGemeente?.(source.gemeente) : undefined;

  /** @type {Item} */
  const item = {
    id: situation.id,
    role,
    state,
    cat: cls.cat,
    geometry: geo.geometry,
    mid: midpoint(geo.geometry),
    rel: situation.rel,
    provCode: source.provCode ?? provFromGemeente?.provCode,
    props: {},
    detail: {},
    raw: {
      cls,
      merged,
      alertC,
      source,
      prov: source.prov ?? provFromGemeente?.prov,
      gemeente: source.gemeente,
    },
  };
  return { item, dropped: geo.dropped, unknown: cls.unknown };
}

/**
 * Fill `props`/`detail` once the geocoder result is known.
 * @param {Item} item
 * @param {import('./geocode.js').GeoEntry | undefined} geo
 * @param {number} nowMs
 */
export function finalizeItem(item, geo, nowMs) {
  const { cls, merged, alertC, source } = item.raw;
  const gemeente = geo?.gemeente ?? item.raw.gemeente;
  const woonplaats = geo?.woonplaats;
  const provNorm = normalizeProvince(geo?.prov) ?? normalizeProvince(item.raw.prov);
  const prov = provNorm?.name ?? geo?.prov ?? item.raw.prov;
  item.provCode = geo?.provCode ?? provNorm?.code ?? item.provCode;

  const road = detectRoad({
    roadNr: merged.roadNr,
    vildRoad: alertC?.road,
    texts: [merged.comment, merged.desc, merged.causeDesc, merged.src],
    street: geo?.straat,
    publisher: source.src,
  });

  const shortComment = merged.comment && merged.comment.length <= TITLE_MAX ? merged.comment : undefined;
  const title = buildTitle({
    comment: shortComment,
    causeDesc: merged.causeDesc,
    road: road.road,
    roadName: alertC?.roadName,
    from: alertC?.from,
    to: alertC?.to,
    street: geo?.straat,
    place: woonplaats ?? gemeente,
    cat: cls.cat,
    sub: cls.sub,
  });

  const start = toMinuteIso(merged.start) ?? toMinuteIso(nowMs);
  const periods = upcomingPeriods(merged.periods, nowMs);
  // The verdict needs the road type (A/N have two carriageways), which is only
  // known here: detectRoad() may rest on the geocoded street name.
  const impact = impactOf(merged.measures, {
    cat: cls.cat,
    roadType: road.roadType,
    delay: merged.delay,
    hasPeriods: periods !== undefined,
    lanes: merged.lanes,
    speed: merged.speed,
  });
  item.props = compact({
    id: item.id,
    cat: cls.cat,
    sub: cls.sub,
    sev: cls.sev,
    title,
    road: road.road,
    roadType: road.roadType,
    gemeente,
    woonplaats,
    prov,
    start,
    end: toMinuteIso(merged.end),
    closed: cls.closed ? true : undefined,
    hind: merged.hind,
    prob: merged.prob,
    src: source.src,
    imp: impact.imp,
    veh: impact.veh,
    per: impact.per,
    spd: impact.spd,
    lc: impact.lc,
  });

  const desc = shortComment === undefined && merged.comment ? joinDesc(merged.comment, merged.desc) : merged.desc;
  item.detail = compact({
    id: item.id,
    desc,
    detour: merged.detour,
    periods,
    lanes: merged.lanes,
    speed: merged.speed,
    delay: merged.delay,
    delaySec: merged.delaySec,
    queueM: merged.queueM,
    from: alertC?.from,
    to: alertC?.to,
    dir: alertC?.dir,
    src: merged.src ?? source.src,
    status: merged.status,
    url: merged.url,
    vehicles: merged.vehicles,
    works: merged.works,
    detourGeom: merged.detourGeom,
    upd: toMinuteIso(merged.upd) ?? start,
  });
  delete item.raw;
  return item;
}

/** One paragraph per line — same convention as `clean()` in merge.js. */
/** @param {string} first @param {string | undefined} rest */
function joinDesc(first, rest) {
  return rest ? `${first}\n${rest}` : first;
}

/**
 * @template {object} T
 * @param {T} obj
 */
function compact(obj) {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key];
  return obj;
}
