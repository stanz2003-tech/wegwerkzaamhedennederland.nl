#!/usr/bin/env node
/**
 * Build/extend `static/bruggen.json` — the bridge registry:
 * `{version, bridges: BridgeRegistryEntry[]}` with
 * `{id, slug, name, road?, water?, gemeente?, woonplaats?, prov?, provCode?, lon, lat}`.
 *
 * Two independent sources are unioned, so an id is never lost:
 *
 *   RIS bridges — every `loc:externalLocationCode` with a RIS-index seen in
 *     `planningsfeed_brugopeningen.xml.gz` / `actueel_beeld.xml.gz`, plus the
 *     existing registry and `<cache>/bruggen-seen.json` (which the pipeline
 *     appends to on every run; one snapshot only exposes 70–90 bridges).
 *     These are the only bridges that can carry openings.
 *   VILD bridges — all 364 `P3.2` rows of the AlertC table, folded per physical
 *     bridge. Every one is named and has a road, a waterway and coordinates.
 *
 * A VILD bridge is matched to a RIS bridge when they are < 150 m apart and
 * their road numbers do not contradict each other; the VILD row then supplies
 * name/road/water and the RIS id supplies the openings. An unmatched VILD
 * bridge still becomes a registry entry (id `VILD-<nr>`) so it gets a page —
 * it simply never has openings.
 *
 * Names: VILD P3.2 name, else the rules in `src/bridges.js`
 * (`bridgeFallbackName`) over the reverse-geocoded street and place.
 *
 *   node bin/build-bruggen.js [--from-file src=path]... [--no-download] [--no-geocode]
 *                             [--geocode-max n] [--no-vild] [--out static/bruggen.json]
 *                             [--cache pipeline/cache]
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  bridgeFallbackName,
  canonicalBridgeName,
  DEFAULT_REGISTRY_PATH,
  disambiguateNames,
  loadRegistry,
  loadSeen,
  matchVildBridge,
  RIS_MATCH_M,
  vildBridges,
} from '../src/bridges.js';
import { fetchFeed, openLocalFile } from '../src/fetch.js';
import { createGeocoder } from '../src/geocode.js';
import { roundCoord } from '../src/geometry.js';
import { parseFeed } from '../src/parse.js';
import { DEFAULT_CACHE_DIR } from '../src/pipeline.js';
import { normalizeVildRoad } from '../src/roads.js';
import { slugify } from '../src/slug.js';
import { SOURCES } from '../src/sources.js';
import { normalizeProvince } from '../src/sources-friendly.js';
import { loadVild } from '../src/vild.js';

/**
 * @typedef {object} Observed
 * @property {string} id
 * @property {number} lon
 * @property {number} lat
 * @property {string=} alertC
 */

/**
 * Collect RIS-coded bridge locations from a feed stream.
 * @param {AsyncIterable<string>} stream
 * @param {Map<string, Observed>} into
 */
export async function collectBridges(stream, into) {
  return parseFeed(stream, (situation) => {
    for (const rec of situation.recs) {
      if (rec.gnm !== 'bridgeSwingInOperation') continue;
      for (const loc of rec.locs) {
        if (!loc.ris || !loc.point) continue;
        const [lon, lat] = roundCoord(loc.point);
        const known = into.get(loc.ris);
        if (known) {
          if (!known.alertC && loc.alertC?.p) known.alertC = loc.alertC.p;
        } else {
          into.set(loc.ris, { id: loc.ris, lon, lat, alertC: loc.alertC?.p });
        }
      }
    }
  });
}

/**
 * Registry entry for one bridge.
 *
 * The name is always recomputed from the current inputs (so bad fallback names
 * from earlier runs are repaired); the coordinates and the slug of an entry
 * that already exists are kept, because the URLs are indexed.
 * @param {object} input
 * @param {Observed} input.obs
 * @param {import('../src/bridges.js').VildBridge=} input.vild   matched VILD bridge
 * @param {string=} input.risRoad                                road from the AlertC row
 * @param {import('../src/geocode.js').GeoEntry=} input.geo
 * @param {import('../src/bridges.js').RegistryEntry=} input.existing
 * @returns {import('../src/bridges.js').RegistryEntry & { street?: string }}
 */
export function registryEntry({ obs, vild, risRoad, geo, existing }) {
  const prov = normalizeProvince(geo?.prov);
  const place = geo?.woonplaats ?? geo?.gemeente ?? existing?.woonplaats ?? existing?.gemeente;
  const road = vild?.road ?? risRoad ?? existing?.road;
  const vildName = canonicalBridgeName(vild?.name);
  const name = vildName ?? bridgeFallbackName({ id: obs.id, street: geo?.straat, place, road });

  /** @type {import('../src/bridges.js').RegistryEntry & { street?: string }} */
  const entry = {
    id: obs.id,
    slug: existing?.slug ?? '',
    name: name === `Brug ${obs.id}` && existing?.name ? existing.name : name,
    road,
    water: vild?.water || existing?.water,
    gemeente: geo?.gemeente ?? existing?.gemeente,
    woonplaats: geo?.woonplaats ?? existing?.woonplaats,
    prov: prov?.name ?? existing?.prov,
    provCode: prov?.code ?? existing?.provCode,
    lon: existing?.lon ?? obs.lon,
    lat: existing?.lat ?? obs.lat,
    street: geo?.straat,
  };
  for (const k of Object.keys(entry)) if (k !== 'slug' && (entry[k] === undefined || entry[k] === '')) delete entry[k];
  return entry;
}

/**
 * slug = slugify(name); duplicates → `-slugify(woonplaats||gemeente)`; still
 * duplicate → `-<last 4 chars of id>`.
 *
 * Invariant: a bridge that already had a slug in the committed registry keeps
 * it, whatever its name became — those URLs are indexed by search engines.
 * @param {(import('../src/bridges.js').RegistryEntry & { street?: string })[]} bridges
 * @param {Map<string, string>} [frozen]  id → slug from the committed registry
 */
export function assignSlugs(bridges, frozen = new Map()) {
  /** @type {Set<string>} */
  const taken = new Set();
  /** @type {(import('../src/bridges.js').RegistryEntry)[]} */
  const fresh = [];
  for (const b of bridges) {
    const keep = frozen.get(b.id);
    if (keep) {
      b.slug = keep;
      taken.add(keep);
    } else fresh.push(b);
  }

  const counts = new Map();
  for (const b of fresh) {
    const base = slugify(b.name) || `brug-${b.id.slice(-4).toLowerCase()}`;
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  for (const b of fresh) {
    let slug = slugify(b.name) || `brug-${b.id.slice(-4).toLowerCase()}`;
    if ((counts.get(slug) ?? 0) > 1 || taken.has(slug)) {
      const place = b.woonplaats ?? b.gemeente;
      if (place) slug = `${slug}-${slugify(place)}`;
    }
    if (taken.has(slug)) slug = `${slug}-${b.id.slice(-4).toLowerCase()}`;
    let unique = slug;
    for (let n = 2; taken.has(unique); n++) unique = `${slug}-${n}`;
    b.slug = unique;
    taken.add(unique);
  }
  return bridges;
}

/**
 * Order the keys exactly as the contract lists them and drop the internals.
 * @param {(import('../src/bridges.js').RegistryEntry & { street?: string })[]} bridges
 */
function serialize(bridges) {
  return bridges.map((b) => {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of ['id', 'slug', 'name', 'road', 'water', 'gemeente', 'woonplaats', 'prov', 'provCode', 'lon', 'lat']) {
      if (b[key] !== undefined) out[key] = b[key];
    }
    return out;
  });
}

async function main() {
  const { values } = parseArgs({
    allowNegative: true,
    options: {
      'from-file': { type: 'string', multiple: true },
      download: { type: 'boolean', default: true },
      geocode: { type: 'boolean', default: true },
      'geocode-max': { type: 'string', default: '2000' },
      vild: { type: 'boolean', default: true },
      out: { type: 'string', default: DEFAULT_REGISTRY_PATH },
      cache: { type: 'string', default: DEFAULT_CACHE_DIR },
    },
  });
  const log = (/** @type {string} */ m) => process.stderr.write(m + '\n');
  const vild = loadVild();
  const registry = loadRegistry(values.out);
  const existing = new Map(registry.bridges.map((b) => [b.id, b]));
  const frozen = new Map(registry.bridges.filter((b) => b.slug).map((b) => [b.id, b.slug]));

  /** @type {Map<string, Observed>} */
  const observed = new Map();
  for (const b of registry.bridges) {
    if (b.id.startsWith('VILD-')) continue; // rebuilt from the table below
    observed.set(b.id, { id: b.id, lon: b.lon, lat: b.lat });
  }
  for (const s of loadSeen(join(values.cache, 'bruggen-seen.json'))) {
    const known = observed.get(s.id);
    if (known) {
      if (!known.alertC && s.alertC) known.alertC = s.alertC;
    } else observed.set(s.id, { id: s.id, lon: s.lon, lat: s.lat, alertC: s.alertC });
  }

  for (const spec of values['from-file'] ?? []) {
    const idx = spec.indexOf('=');
    const path = idx >= 0 ? spec.slice(idx + 1) : spec;
    const before = observed.size;
    const { count } = await collectBridges(openLocalFile(path), observed);
    log(`${path}: ${count} situations, ${observed.size - before} new bridges`);
  }
  if (values.download) {
    for (const name of ['bruggen', 'actueel']) {
      const res = await fetchFeed(SOURCES[name].url);
      if (res.status !== 'ok' || !res.stream) {
        log(`download of ${name} failed: ${res.error ?? res.status}`);
        continue;
      }
      const before = observed.size;
      const { count } = await collectBridges(res.stream, observed);
      log(`${SOURCES[name].url}: ${count} situations, ${observed.size - before} new bridges`);
    }
  }

  // --- match the VILD bridge table onto the observed RIS bridges -----------
  const table = values.vild ? vildBridges(vild, normalizeVildRoad) : [];
  /** @type {Map<string, import('../src/bridges.js').VildBridge>} */
  const vildOf = new Map();
  const usedVild = new Set();
  /** @type {number[]} */
  const matchDistances = [];
  /** @type {number[]} */
  const nearMisses = [];
  const byNr = new Map();
  for (const b of table) for (const nr of b.nrs) byNr.set(nr, b);

  for (const obs of observed.values()) {
    const row = vild.lookup(obs.alertC);
    const risRoad = normalizeVildRoad(row?.road) ?? existing.get(obs.id)?.road;
    const direct = obs.alertC ? byNr.get(String(obs.alertC)) : undefined;
    const match = direct ? { bridge: direct, m: 0 } : matchVildBridge(table, { lon: obs.lon, lat: obs.lat, road: risRoad });
    if (match) {
      vildOf.set(obs.id, match.bridge);
      usedVild.add(match.bridge.id);
      matchDistances.push(Math.round(match.m));
    } else {
      // nearest VILD bridge that was rejected — lets the 150 m threshold be judged
      let nearest = Infinity;
      for (const b of table) {
        const m = Math.hypot((b.lon - obs.lon) * 68000, (b.lat - obs.lat) * 111000);
        if (m < nearest) nearest = m;
      }
      if (Number.isFinite(nearest)) nearMisses.push(Math.round(nearest));
    }
  }

  // --- geocode every bridge we are going to write --------------------------
  const geocoder = createGeocoder({
    cachePath: join(values.cache, 'geocode.json'),
    maxNew: Number(values['geocode-max']),
    enabled: values.geocode,
    log: { warn: (m, f) => log(`${m} ${JSON.stringify(f ?? {})}`), debug: () => {} },
  });

  /** @type {(import('../src/bridges.js').RegistryEntry & { street?: string })[]} */
  const bridges = [];
  let geocoded = 0;
  for (const obs of observed.values()) {
    const prior = existing.get(obs.id);
    const matched = vildOf.get(obs.id);
    const needsPlace = !prior?.woonplaats && !prior?.gemeente;
    const needsStreet = !matched; // only a fallback name needs the street name
    const geo = needsPlace || needsStreet ? await geocoder.lookup(obs.lon, obs.lat) : geocoder.cached(obs.lon, obs.lat);
    if (geo) geocoded++;
    const row = vild.lookup(obs.alertC);
    bridges.push(registryEntry({ obs, vild: matched, risRoad: normalizeVildRoad(row?.road), geo, existing: prior }));
  }
  let vildOnly = 0;
  for (const b of table) {
    if (usedVild.has(b.id)) continue;
    vildOnly++;
    const prior = existing.get(b.id);
    const geo = (await geocoder.lookup(b.lon, b.lat)) ?? undefined;
    if (geo) geocoded++;
    bridges.push(registryEntry({ obs: { id: b.id, lon: b.lon, lat: b.lat }, vild: b, geo, existing: prior }));
  }
  await geocoder.flush();
  geocoder.save();

  bridges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  disambiguateNames(bridges);
  assignSlugs(bridges, frozen);

  const out = { version: new Date().toISOString().slice(0, 10), bridges: serialize(bridges) };
  writeFileSync(values.out, JSON.stringify(out, null, 0).replace(/\},\{"id"/g, '},\n{"id"') + '\n');

  const named = bridges.filter((b) => !/^Brug\b/.test(b.name)).length;
  const placed = bridges.filter((b) => b.woonplaats || b.gemeente).length;
  const keptSlugs = bridges.filter((b) => frozen.get(b.id) === b.slug).length;
  log(`VILD table: ${table.length} bridges, ${usedVild.size} matched to a RIS id, ${vildOnly} without openings data`);
  log(`RIS bridges: ${observed.size} (${vildOf.size} with a VILD name)`);
  log(`match distances (m): ${percentiles(matchDistances)}; nearest rejected VILD bridge for unmatched RIS ids (m): ${percentiles(nearMisses)} (threshold ${RIS_MATCH_M})`);
  process.stdout.write(
    `bruggen.json: ${bridges.length} bridges (${named} with a real name, ${placed} with a place, ${keptSlugs} slugs kept, ${geocoded} geocoded, pending ${geocoder.stats.pending}) → ${values.out}\n`,
  );
}

/** @param {number[]} values */
function percentiles(values) {
  if (values.length === 0) return 'none';
  const s = [...values].sort((a, b) => a - b);
  const at = (/** @type {number} */ p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `n=${s.length} min=${s[0]} p50=${at(0.5)} p90=${at(0.9)} max=${s[s.length - 1]}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`build-bruggen failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
}
