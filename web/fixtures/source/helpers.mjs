/**
 * Shared helpers for the fixture generator (web/scripts/make-fixtures.mjs).
 * Deterministic: no clock reads, no randomness. Times are truncated to whole minutes and
 * geometry coordinates rounded to 5 decimals, exactly as the pipeline writes them.
 */
import { createHash } from 'node:crypto';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const DETAIL_SHARDS = 32;
export const PROVINCE_CODES = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26', 'PV27', 'PV28', 'PV29', 'PV30', 'PV31', '_'];
export const PROVINCES = {
  PV20: 'Groningen',
  PV21: 'Friesland',
  PV22: 'Drenthe',
  PV23: 'Overijssel',
  PV24: 'Flevoland',
  PV25: 'Gelderland',
  PV26: 'Utrecht',
  PV27: 'Noord-Holland',
  PV28: 'Zuid-Holland',
  PV29: 'Zeeland',
  PV30: 'Noord-Brabant',
  PV31: 'Limburg',
};

/** ISO 8601 UTC, truncated to whole minutes (the contract format). */
export function iso(ms) {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

export function sha1(data) {
  return createHash('sha1').update(data).digest('hex');
}

export function shardOf(id) {
  return Number.parseInt(sha1(id).slice(0, 8), 16) % DETAIL_SHARDS;
}

export function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

/** Drops undefined/null values so the JSON matches the pipeline output ("nulls are omitted"). */
export function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Amsterdam',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
});

/** Wall-clock parts in Europe/Amsterdam (mirrors web/src/data/time.ts). */
export function zonedParts(ms) {
  const p = partsFmt.formatToParts(new Date(ms));
  const get = (t) => Number(p.find((x) => x.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** Epoch ms for a wall-clock time in Europe/Amsterdam (two-pass DST correction). */
export function zonedToMs(year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(ms);
    ms += guess - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return ms;
}

/**
 * `count` consecutive nights [fromHour → toHour next day] in local time, starting on the
 * local date of `firstNightMs`. Wall-clock stable across a DST switch by construction.
 */
export function nightlyPeriods(firstNightMs, count, fromHour, toHour) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = zonedParts(firstNightMs + i * DAY);
    const start = zonedToMs(p.year, p.month, p.day, fromHour);
    const end = zonedToMs(p.year, p.month, p.day + 1, toHour);
    out.push([iso(start), iso(end)]);
  }
  return out;
}

export function line(coords) {
  return { type: 'LineString', coordinates: coords.map(([x, y]) => [round5(x), round5(y)]) };
}

export function multiline(parts) {
  return { type: 'MultiLineString', coordinates: parts.map((c) => c.map(([x, y]) => [round5(x), round5(y)])) };
}

export function point(lon, lat) {
  return { type: 'Point', coordinates: [round5(lon), round5(lat)] };
}

/** Same midpoint rule as web/src/data/filter.ts midpointOf(). */
export function midpointOf(geometry) {
  const coords =
    geometry.type === 'Point'
      ? [geometry.coordinates]
      : geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.coordinates.flat();
  if (geometry.type === 'Point') return coords[0];
  return coords[Math.floor(coords.length / 2)];
}


/* ------------------------------ contract v3 helpers ------------------------------ */

/** Same rule as web/src/data/types.ts slugify(): lowercase, diacritics stripped, [^a-z0-9] → "-". */
export function slugify(input) {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "A12 hrb" → "A12"; null when not a road number (mirrors data/entity.ts roadKey). */
export function roadKey(road) {
  const m = /^([ANSE])\s*0*(\d{1,3})/i.exec((road ?? '').trim());
  return m ? `${m[1].toUpperCase()}${Number(m[2])}` : null;
}

const VEHICLES = new Set(['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other']);
const HINDER_SUBS = new Set(['laneClosures', 'narrowLanes', 'speedRestrictionInOperation', 'contraflow']);

/**
 * Impact verdict of a fixture spec (mirrors the pipeline rules documented on `Impact` in
 * web/src/data/types.ts). An explicit `spec.imp` wins.
 */
export function impactOf(spec) {
  if (spec.imp) return spec.imp;
  if (spec.cat === 'brug') return 'dicht';
  if (spec.cat === 'file' || spec.cat === 'incident') return 'hinder';
  if (spec.sub === 'roadClosed') return 'dicht';
  if (spec.sub === 'carriagewayClosures') return spec.roadType === 'A' || spec.roadType === 'N' ? 'rijbaan' : 'dicht';
  if (spec.closed) return 'dicht';
  const d = spec.d ?? {};
  if ((d.lanes && d.lanes.closed > 0) || d.speed || HINDER_SUBS.has(spec.sub)) return 'hinder';
  if (d.delay && d.delay !== 'negligible') return 'hinder';
  if (spec.cat === 'evenement' || spec.cat === 'overig') return 'geen';
  return 'onbekend';
}

/** Vehicle groups of a spec: explicit `veh`, else the contract groups found in `d.vehicles`. */
export function vehiclesOf(spec) {
  const raw = spec.veh ?? spec.d?.vehicles ?? [];
  const out = [...new Set(raw.filter((v) => VEHICLES.has(v)))];
  return out.length > 0 ? out : undefined;
}
