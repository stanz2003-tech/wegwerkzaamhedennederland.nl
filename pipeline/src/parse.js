/**
 * Streaming DATEX II v3 parser (saxes) → one plain object per `sit:situation`.
 *
 * The feeds are single-line XML of up to 208 MB, so the whole document is never
 * buffered: only the subtree of the situation currently being read is kept as
 * a tiny DOM (`{n, ns, a, c, t}` nodes) and converted to a plain
 * {@link Situation} as soon as its closing tag arrives. Elements are matched on
 * local name + namespace URI, never on prefix. Unknown elements are ignored.
 *
 * `sit:alternativeRoute` (detour geometry) is deliberately NOT parsed as a
 * location — it must never become an item's geometry.
 */

import { SaxesParser } from 'saxes';
import { parsePosList } from './geometry.js';

export const NS = Object.freeze({
  sit: 'http://datex2.eu/schema/3/situation',
  loc: 'http://datex2.eu/schema/3/locationReferencing',
  com: 'http://datex2.eu/schema/3/common',
  nle: 'http://datex2.eu/schema/3/nlExtensions',
  mc: 'http://datex2.eu/schema/3/messageContainer',
});

/**
 * @typedef {object} Location
 * @property {'point'|'line'|'alertc'} kind
 * @property {[number, number]=} point       [lon, lat]
 * @property {[number, number][]=} line      [[lon, lat], …]
 * @property {{p?: string, s?: string, dir?: string, pOff?: number, sOff?: number}=} alertC
 * @property {string=} ris                   RIS-index code (bridges)
 * @property {number=} lanesTotal            loc:originalNumberOfLanes
 * @property {string=} carriageway
 */

/**
 * @typedef {object} SituationRecord
 * @property {string} id
 * @property {string} type              xsi:type without prefix, e.g. "MaintenanceWorks"
 * @property {string=} ver              situationRecordVersionTime
 * @property {string=} created
 * @property {string=} prob
 * @property {string=} src              sourceName
 * @property {string=} start            overallStartTime
 * @property {string=} end              overallEndTime
 * @property {[string, string|undefined][]=} periods   validPeriod start/end pairs
 * @property {{type: string, text: string}[]=} comments   public comments (internalNote excluded)
 * @property {string=} cause            causeType
 * @property {string=} causeDesc
 * @property {string[]=} urls
 * @property {string=} action           operatorActionStatus
 * @property {string=} maint            roadMaintenanceType
 * @property {string=} subject          subjectTypeOfWorks
 * @property {string=} hind             hindrance category A–E
 * @property {string=} status           nle:roadworkStatus
 * @property {string=} lane             roadOrCarriagewayOrLaneManagementType
 * @property {number=} lanesRestricted
 * @property {number=} lanesOperational
 * @property {string=} rerouteType
 * @property {string=} detour
 * @property {string=} roadNr           roadOrJunctionNumber
 * @property {string[]=} vehicles
 * @property {number=} speed            temporarySpeedLimit
 * @property {string=} speedType
 * @property {string=} event            publicEventType
 * @property {string=} gnm              generalNetworkManagementType
 * @property {string=} traffic          abnormalTrafficType
 * @property {number=} queue            queueLength (m)
 * @property {number=} delaySec
 * @property {string=} delayBand
 * @property {string=} accident
 * @property {string=} vehObs
 * @property {string=} obstruction
 * @property {string=} envObs
 * @property {string=} mobility
 * @property {Location[]} locs
 */

/**
 * @typedef {object} Situation
 * @property {string} id
 * @property {string=} sev       overallSeverity
 * @property {string=} ver       situationVersionTime
 * @property {string[]=} rel     related situation ids
 * @property {SituationRecord[]} recs
 */

/** @typedef {{ n: string, ns: string, a: Record<string, string>, c: Node[], t: string }} Node */

const TEXT_MAX = 8000;

/**
 * Parse a feed stream.
 * @param {AsyncIterable<string | Buffer>} readable  decoded XML (already gunzipped)
 * @param {(situation: Situation) => void | Promise<void>} onSituation
 * @returns {Promise<{ publicationTime?: string, count: number }>}
 */
export async function parseFeed(readable, onSituation) {
  const parser = new SaxesParser({ xmlns: true, position: false });
  /** @type {Node[]} */
  const stack = [];
  /** @type {Node | null} */
  let root = null;
  /** @type {Situation[]} */
  let emitted = [];
  let publicationTime;
  let count = 0;
  let inPublicationTime = false;
  let publicationText = '';

  parser.on('opentag', (tag) => {
    const local = tag.local ?? tag.name;
    const uri = tag.uri ?? '';
    if (root === null) {
      if (local === 'situation' && uri === NS.sit) {
        root = { n: local, ns: uri, a: attrs(tag.attributes), c: [], t: '' };
        stack.push(root);
      } else if (local === 'publicationTime' && publicationTime === undefined) {
        inPublicationTime = true;
        publicationText = '';
      }
      return;
    }
    const node = { n: local, ns: uri, a: attrs(tag.attributes), c: [], t: '' };
    stack[stack.length - 1].c.push(node);
    stack.push(node);
  });

  parser.on('text', (text) => {
    if (root !== null) {
      const node = stack[stack.length - 1];
      if (node.t.length < TEXT_MAX * 8) node.t += text;
    } else if (inPublicationTime) {
      publicationText += text;
    }
  });

  parser.on('closetag', () => {
    if (root === null) {
      if (inPublicationTime) {
        publicationTime = publicationText.trim() || undefined;
        inPublicationTime = false;
      }
      return;
    }
    const node = stack.pop();
    if (node === root) {
      emitted.push(situationFromNode(root));
      root = null;
      count++;
    }
  });

  parser.on('error', (err) => {
    throw err;
  });

  for await (const chunk of readable) {
    parser.write(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    if (emitted.length > 0) {
      const batch = emitted;
      emitted = [];
      for (const situation of batch) await onSituation(situation);
    }
  }
  parser.close();
  for (const situation of emitted) await onSituation(situation);
  return { publicationTime, count };
}

/** @param {Record<string, { local?: string, name: string, value: string }>} attributes */
function attrs(attributes) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const attr of Object.values(attributes)) out[attr.local ?? attr.name] = attr.value;
  return out;
}

// ---------------------------------------------------------------------------
// Tree helpers

/** @param {Node | undefined} node @param {string} name @param {string=} ns */
function child(node, name, ns) {
  if (!node) return undefined;
  return node.c.find((c) => c.n === name && (ns === undefined || c.ns === ns));
}

/** @param {Node | undefined} node @param {string} name */
function children(node, name) {
  return node ? node.c.filter((c) => c.n === name) : [];
}

/** @param {Node | undefined} node @param {...string} names */
function descend(node, ...names) {
  let cur = node;
  for (const name of names) {
    cur = child(cur, name);
    if (!cur) return undefined;
  }
  return cur;
}

/** @param {Node | undefined} node */
function text(node) {
  if (!node) return undefined;
  const t = node.t.trim();
  return t.length > 0 ? (t.length > TEXT_MAX ? t.slice(0, TEXT_MAX) : t) : undefined;
}

/** @param {Node | undefined} node */
function num(node) {
  const t = text(node);
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Multilingual `com:values/com:value[@lang]` → Dutch value, else the first one. */
/** @param {Node | undefined} node */
function multilingual(node) {
  const values = children(child(node, 'values'), 'value');
  if (values.length === 0) return undefined;
  const nl = values.find((v) => (v.a.lang ?? '').toLowerCase().startsWith('nl'));
  return text(nl ?? values[0]);
}

/** @param {string | undefined} xsiType */
function stripPrefix(xsiType) {
  if (!xsiType) return undefined;
  const idx = xsiType.indexOf(':');
  return idx >= 0 ? xsiType.slice(idx + 1) : xsiType;
}

/** @param {string | undefined} value */
function hindranceLetter(value) {
  const m = value?.match(/hindranceCategory([A-E])$/);
  return m ? m[1] : undefined;
}

// ---------------------------------------------------------------------------
// Situation conversion

/** @param {Node} node @returns {Situation} */
export function situationFromNode(node) {
  /** @type {Situation} */
  const situation = {
    id: node.a.id ?? '',
    sev: text(child(node, 'overallSeverity')),
    ver: text(child(node, 'situationVersionTime')),
    recs: children(node, 'situationRecord').map(recordFromNode),
  };
  const related = children(node, 'relatedSituation')
    .map((r) => child(r, 'objectReference')?.a.id)
    .filter((id) => typeof id === 'string');
  if (related.length > 0) situation.rel = related;
  return compact(situation);
}

/** @param {Node} node @returns {SituationRecord} */
function recordFromNode(node) {
  const validity = descend(node, 'validity', 'validityTimeSpecification');
  const impact = child(node, 'impact');
  const delays = child(impact, 'delays');
  const cause = child(node, 'cause');
  const ext = descend(node, '_roadworksExtension', 'roadworksExtension');

  const comments = children(node, 'generalPublicComment')
    .map((c) => ({ type: text(child(c, 'commentType')) ?? 'other', text: multilingual(child(c, 'comment')) }))
    .filter((c) => c.text !== undefined && c.type !== 'internalNote');

  const periods = children(validity, 'validPeriod')
    .map((p) => [text(child(p, 'startOfPeriod')), text(child(p, 'endOfPeriod'))])
    .filter((p) => p[0] !== undefined);

  const urls = children(node, 'urlLink')
    .map((u) => text(child(u, 'urlLinkAddress')))
    .filter((u) => u !== undefined);

  const vehicles = children(node, 'forVehiclesWithCharacteristicsOf')
    .map((v) => text(child(v, 'vehicleType')))
    .filter((v) => v !== undefined);

  /** @type {SituationRecord} */
  const rec = {
    id: node.a.id ?? '',
    type: stripPrefix(node.a.type) ?? 'Unknown',
    ver: text(child(node, 'situationRecordVersionTime')),
    created: text(child(node, 'situationRecordCreationTime')),
    prob: text(child(node, 'probabilityOfOccurrence')),
    src: multilingual(descend(node, 'source', 'sourceName')),
    start: text(child(validity, 'overallStartTime')),
    end: text(child(validity, 'overallEndTime')),
    periods: periods.length > 0 ? periods : undefined,
    comments: comments.length > 0 ? comments : undefined,
    cause: text(child(cause, 'causeType')),
    causeDesc: multilingual(child(cause, 'causeDescription')),
    urls: urls.length > 0 ? urls : undefined,
    action: text(child(node, 'operatorActionStatus')),
    maint: text(child(node, 'roadMaintenanceType')),
    subject: text(descend(node, 'subjects', 'subjectTypeOfWorks')),
    hind: hindranceLetter(text(descend(ext, 'roadworkHindrance', 'roadworkHindranceCategory'))),
    status: text(descend(ext, 'roadworkPlanningStatus', 'roadworkStatus')),
    lane: text(child(node, 'roadOrCarriagewayOrLaneManagementType')),
    lanesRestricted: num(child(impact, 'numberOfLanesRestricted')),
    lanesOperational: num(child(impact, 'numberOfOperationalLanes')),
    rerouteType: text(child(node, 'reroutingManagementType')),
    detour: multilingual(child(node, 'reroutingItineraryDescription')),
    roadNr: text(child(node, 'roadOrJunctionNumber')),
    vehicles: vehicles.length > 0 ? vehicles : undefined,
    speed: num(child(node, 'temporarySpeedLimit')),
    speedType: text(child(node, 'speedManagementType')),
    event: text(child(node, 'publicEventType')),
    gnm: text(child(node, 'generalNetworkManagementType')),
    traffic: text(child(node, 'abnormalTrafficType')),
    queue: num(child(node, 'queueLength')),
    delaySec: num(child(delays, 'delayTimeValue')),
    delayBand: text(child(delays, 'delayBand')),
    accident: text(child(node, 'accidentType')),
    vehObs: text(child(node, 'vehicleObstructionType')),
    obstruction: text(child(node, 'obstructionType')),
    envObs: text(child(node, 'environmentalObstructionType')),
    mobility: text(descend(node, 'mobility', 'mobilityType')) ?? text(descend(node, 'mobilityOfObstruction', 'mobilityType')),
    locs: locationsFromNode(child(node, 'locationReference')),
  };
  return compact(rec);
}

/**
 * Flatten a `sit:locationReference` (possibly an itinerary) into locations.
 * @param {Node | undefined} node
 * @returns {Location[]}
 */
export function locationsFromNode(node) {
  if (!node) return [];
  const type = stripPrefix(node.a.type);
  if (type === 'ItineraryByIndexedLocations') {
    const parts = children(node, 'locationContainedInItinerary')
      .map((p) => ({ index: Number(p.a.index ?? 0), node: child(p, 'location') }))
      .sort((a, b) => a.index - b.index);
    return parts.flatMap((p) => locationsFromNode(p.node));
  }
  const loc = singleLocation(node);
  return loc ? [loc] : [];
}

/** @param {Node} node @returns {Location | undefined} */
function singleLocation(node) {
  /** @type {Location} */
  const loc = { kind: 'alertc' };
  const posList = text(descend(node, 'gmlLineString', 'posList'));
  if (posList) {
    const line = parsePosList(posList);
    if (line.length >= 2) {
      loc.kind = 'line';
      loc.line = line;
    } else if (line.length === 1) {
      loc.kind = 'point';
      loc.point = line[0];
    }
  }
  if (loc.kind === 'alertc') {
    const coords = descend(node, 'pointByCoordinates', 'pointCoordinates');
    const lat = num(child(coords, 'latitude'));
    const lon = num(child(coords, 'longitude'));
    if (lat !== undefined && lon !== undefined) {
      loc.kind = 'point';
      loc.point = [lon, lat];
    }
  }
  const alertC = child(node, 'alertCPoint') ?? child(node, 'alertCLinear');
  if (alertC) loc.alertC = alertCFromNode(alertC);

  const ext = child(node, 'externalReferencing');
  if (ext && /RIS/i.test(text(child(ext, 'externalReferencingSystem')) ?? '')) {
    loc.ris = text(child(ext, 'externalLocationCode'));
  }
  const carriageway = descend(node, 'supplementaryPositionalDescription', 'carriageway');
  loc.carriageway = text(child(carriageway, 'carriageway'));
  loc.lanesTotal = num(child(carriageway, 'originalNumberOfLanes'));

  if (loc.kind === 'alertc' && !loc.alertC && !loc.ris) return undefined;
  return compact(loc);
}

/** @param {Node} node */
function alertCFromNode(node) {
  const primary = node.c.find((c) => /PrimaryPointLocation$/.test(c.n));
  const secondary = node.c.find((c) => /SecondaryPointLocation$/.test(c.n));
  return compact({
    p: text(descend(primary, 'alertCLocation', 'specificLocation')),
    s: text(descend(secondary, 'alertCLocation', 'specificLocation')),
    dir: text(descend(node, 'alertCDirection', 'alertCDirectionCoded')),
    pOff: num(descend(primary, 'offsetDistance', 'offsetDistance')),
    sOff: num(descend(secondary, 'offsetDistance', 'offsetDistance')),
  });
}

/**
 * Remove undefined properties so NDJSON/JSON stays compact.
 * @template {object} T
 * @param {T} obj
 * @returns {T}
 */
function compact(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

/**
 * Wrap a fixture snippet (one or more `sit:situation` elements without the
 * container) into a parseable document. Used by tests.
 * @param {string} inner
 */
export function wrapFixture(inner) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<mc:messageContainer xmlns:mc="${NS.mc}" xmlns:sit="${NS.sit}" xmlns:loc="${NS.loc}" xmlns:com="${NS.com}" xmlns:nle="${NS.nle}" ` +
    'xmlns:srx="http://datex2.eu/schema/3/situationRecordExtension" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" modelBaseVersion="3">' +
    '<mc:payload xsi:type="sit:SituationPublication" lang="nl"><com:publicationTime>2026-09-08T16:00:00Z</com:publicationTime>' +
    inner +
    '</mc:payload></mc:messageContainer>'
  );
}
