/**
 * Static lists (roads, places/municipalities, bridges) for the page generator.
 *
 * Lookup order: `--lists <dir>` → `pipeline/static/` → `web/public/lists/` → built-in sample.
 * The `slug` fields in the files are final (produced by A with `slugify()`); never re-slug.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LIST_FILES = ['wegen.json', 'plaatsen.json', 'bruggen.json'];

/* ------------------------------------------------------------------------------------------ */
/* Built-in sample (used until A's generators have produced the real files)                   */
/* ------------------------------------------------------------------------------------------ */

const SAMPLE_ROADS = [
  ['A1', 'A', ['Amsterdam → Amersfoort', 'Amersfoort → Apeldoorn', 'Apeldoorn → Hengelo', 'Hengelo → Duitse grens', 'A30/E30'], 5.3763, 52.1531, [4.93, 52.2, 7.05, 52.4], 126],
  ['A2', 'A', ['Amsterdam → Utrecht', "Utrecht → 's-Hertogenbosch", "'s-Hertogenbosch → Eindhoven", 'Eindhoven → Maastricht', 'Maastricht → Belgische grens', 'Ring Utrecht', 'Randweg Eindhoven', "Ring 's Hertogenbosch", 'A25/E25'], 4.986, 52.1743, [4.87, 50.75, 5.75, 52.35], 179],
  ['A4', 'A', ['Amsterdam → Den Haag', 'Den Haag → Rotterdam', 'Rotterdam → Bergen op Zoom', 'Bergen op Zoom → Belgische grens'], 4.44, 52.09, [4.2, 51.4, 4.9, 52.4], 98],
  ['A7', 'A', ['Zaandam → Hoorn', 'Hoorn → Afsluitdijk', 'Afsluitdijk → Sneek', 'Sneek → Groningen', 'Groningen → Duitse grens', 'Afsluitdijk', 'A280/A31/A28/E22'], 5.9328, 52.955, [4.8, 52.45, 7.2, 53.25], 165],
  ['A10', 'A', ['Ring Amsterdam', 'Ring West', 'Ring Noord', 'Ring Oost', 'Ring Zuid'], 4.956, 52.3317, [4.8, 52.3, 5.0, 52.42], 45],
  ['A12', 'A', ['Den Haag → Utrecht', 'Utrecht → Arnhem', 'Arnhem → Duitse grens', 'Ring Utrecht', 'A3'], 4.2937, 52.0665, [4.3, 51.95, 6.75, 52.1], 110],
  ['A15', 'A', ['Europoort → Rotterdam', 'Rotterdam → Gorinchem', 'Gorinchem → Nijmegen', 'Nijmegen → Arnhem'], 4.7, 51.87, [4.05, 51.82, 5.95, 51.98], 88],
  ['A16', 'A', ['Rotterdam → Dordrecht', 'Dordrecht → Breda', 'Breda → Belgische grens', 'A16/E19'], 4.55, 51.72, [4.5, 51.45, 4.65, 51.98], 54],
  ['A27', 'A', ['Almere → Utrecht', 'Utrecht → Gorinchem', 'Gorinchem → Breda'], 4.9489, 51.8158, [4.75, 51.55, 5.25, 52.4], 84],
  ['A28', 'A', ['Utrecht → Amersfoort', 'Amersfoort → Zwolle', 'Zwolle → Groningen'], 5.75, 52.45, [5.1, 52.05, 6.6, 53.25], 92],
  ['A58', 'A', ['Eindhoven → Tilburg', 'Tilburg → Breda', 'Breda → Vlissingen'], 4.9, 51.55, [3.55, 51.4, 5.5, 51.62], 70],
  ['N2', 'N', ['Randweg Eindhoven'], 5.4807, 51.4054, [5.42, 51.38, 5.5, 51.48], 20],
  ['N57', 'N', ['Middelburg → Rotterdam', 'Veersegatdam', 'Oosterscheldekering', 'Brouwersdam', 'Haringvlietdam'], 4.0523, 51.8135, [3.55, 51.45, 4.15, 51.88], 49],
  ['N201', 'N', ['Zandvoort → Hilversum'], 4.8, 52.27, [4.53, 52.22, 5.2, 52.31], 36],
  ['N261', 'N', ['Waalwijk → Tilburg'], 5.05, 51.62, [5.03, 51.56, 5.08, 51.7], 12],
  ['N325', 'N', ['Arnhem → Nijmegen', 'Pleijroute'], 5.93, 51.9, [5.86, 51.83, 5.98, 51.98], 14],
  ['s100', 'S', ['Centrumring', 'De Ruijterkade', 'Westerdoksdijk', 'Van Diemenstraat', 'Houtmankade'], 4.8935, 52.3828, [4.87, 52.36, 4.93, 52.39], 39],
  ['s101', 'S', ['Haarlemmerweg'], 4.83, 52.385, [4.78, 52.38, 4.89, 52.39], 8],
];

const SAMPLE_GEMEENTEN = [
  ['GM0363', 'Amsterdam', 'amsterdam', 'Noord-Holland', 'PV27', 4.8952, 52.3702],
  ['GM0599', 'Rotterdam', 'rotterdam', 'Zuid-Holland', 'PV28', 4.4777, 51.9244],
  ['GM0344', 'Utrecht', 'utrecht', 'Utrecht', 'PV26', 5.1214, 52.0907],
  ['GM0758', 'Breda', 'breda', 'Noord-Brabant', 'PV30', 4.7683, 51.5719],
  ['GM0772', 'Eindhoven', 'eindhoven', 'Noord-Brabant', 'PV30', 5.4697, 51.4416],
  ['GM0014', 'Groningen', 'groningen', 'Groningen', 'PV20', 6.5665, 53.2194],
  ['GM0193', 'Zwolle', 'zwolle', 'Overijssel', 'PV23', 6.0944, 52.5168],
  ['GM0687', 'Middelburg', 'middelburg', 'Zeeland', 'PV29', 3.6136, 51.4988],
  ['GM0935', 'Maastricht', 'maastricht', 'Limburg', 'PV31', 5.6909, 50.8514],
  ['GM0034', 'Almere', 'almere', 'Flevoland', 'PV24', 5.2647, 52.3508],
  ['GM0080', 'Leeuwarden', 'leeuwarden', 'Friesland', 'PV21', 5.7999, 53.2012],
  ['GM0106', 'Assen', 'assen', 'Drenthe', 'PV22', 6.5622, 52.9925],
  ['GM0202', 'Arnhem', 'arnhem', 'Gelderland', 'PV25', 5.8987, 51.9851],
  ['GM0373', 'Bergen (NH.)', 'bergen-nh', 'Noord-Holland', 'PV27', 4.7042, 52.6717],
];

const SAMPLE_WOONPLAATSEN = [
  ['WP1012', 'Amsterdam', 'amsterdam', 'Amsterdam', 'GM0363', 'Noord-Holland', 'PV27', 4.8952, 52.3702],
  ['WP1001', 'Amsterdam-Duivendrecht', 'amsterdam-duivendrecht', 'Amsterdam', 'GM0363', 'Noord-Holland', 'PV27', 4.9351, 52.3283],
  ['WP1103', 'Rotterdam', 'rotterdam', 'Rotterdam', 'GM0599', 'Zuid-Holland', 'PV28', 4.4777, 51.9244],
  ['WP1104', 'Hoek van Holland', 'hoek-van-holland', 'Rotterdam', 'GM0599', 'Zuid-Holland', 'PV28', 4.1333, 51.9772],
  ['WP1105', 'Rozenburg', 'rozenburg', 'Rotterdam', 'GM0599', 'Zuid-Holland', 'PV28', 4.2482, 51.9048],
  ['WP1201', 'Utrecht', 'utrecht', 'Utrecht', 'GM0344', 'Utrecht', 'PV26', 5.1214, 52.0907],
  ['WP1202', 'De Meern', 'de-meern', 'Utrecht', 'GM0344', 'Utrecht', 'PV26', 5.0281, 52.0785],
  ['WP1203', 'Vleuten', 'vleuten', 'Utrecht', 'GM0344', 'Utrecht', 'PV26', 5.0111, 52.1061],
  ['WP1301', 'Breda', 'breda', 'Breda', 'GM0758', 'Noord-Brabant', 'PV30', 4.7683, 51.5719],
  ['WP1302', 'Prinsenbeek', 'prinsenbeek', 'Breda', 'GM0758', 'Noord-Brabant', 'PV30', 4.7124, 51.5987],
  ['WP1303', 'Bavel', 'bavel', 'Breda', 'GM0758', 'Noord-Brabant', 'PV30', 4.8277, 51.5606],
  ['WP1401', 'Eindhoven', 'eindhoven', 'Eindhoven', 'GM0772', 'Noord-Brabant', 'PV30', 5.4697, 51.4416],
  ['WP1501', 'Groningen', 'groningen', 'Groningen', 'GM0014', 'Groningen', 'PV20', 6.5665, 53.2194],
  ['WP1502', 'Haren', 'haren-groningen', 'Groningen', 'GM0014', 'Groningen', 'PV20', 6.6083, 53.1717],
  ['WP1601', 'Zwolle', 'zwolle', 'Zwolle', 'GM0193', 'Overijssel', 'PV23', 6.0944, 52.5168],
  ['WP1701', 'Middelburg', 'middelburg', 'Middelburg', 'GM0687', 'Zeeland', 'PV29', 3.6136, 51.4988],
  ['WP1801', 'Maastricht', 'maastricht', 'Maastricht', 'GM0935', 'Limburg', 'PV31', 5.6909, 50.8514],
  ['WP1901', 'Almere', 'almere', 'Almere', 'GM0034', 'Flevoland', 'PV24', 5.2647, 52.3508],
  ['WP2001', 'Leeuwarden', 'leeuwarden', 'Leeuwarden', 'GM0080', 'Friesland', 'PV21', 5.7999, 53.2012],
  ['WP2101', 'Assen', 'assen', 'Assen', 'GM0106', 'Drenthe', 'PV22', 6.5622, 52.9925],
  ['WP2201', 'Arnhem', 'arnhem', 'Arnhem', 'GM0202', 'Gelderland', 'PV25', 5.8987, 51.9851],
  ['WP2301', 'Bergen', 'bergen-bergen-nh', 'Bergen (NH.)', 'GM0373', 'Noord-Holland', 'PV27', 4.7042, 52.6717],
];

const SAMPLE_BRIDGES = [
  ['NLSPL002120533400126', 'schellingwouderbrug', 'Schellingwouderbrug', 's116', 'Buiten-IJ', 'Amsterdam', 'Amsterdam', 'Noord-Holland', 'PV27', 4.9635, 52.3822],
  ['NLSPL002110411100017', 'van-brienenoordbrug', 'Van Brienenoordbrug', 'A16', 'Nieuwe Maas', 'Rotterdam', 'Rotterdam', 'Zuid-Holland', 'PV28', 4.5451, 51.9047],
  ['NLSPL002130101200041', 'zeelandbrug', 'Zeelandbrug', 'N256', 'Oosterschelde', 'Schouwen-Duiveland', 'Zierikzee', 'Zeeland', 'PV29', 3.8996, 51.6262],
  ['NLSPL002140900300022', 'stationsbrug-middelburg', 'Stationsbrug', null, 'Kanaal door Walcheren', 'Middelburg', 'Middelburg', 'Zeeland', 'PV29', 3.6162, 51.4949],
  ['NLSPL002150200800009', 'brug-in-de-n201-bij-aalsmeer', 'Brug in de N201 bij Aalsmeer', 'N201', 'Ringvaart', 'Aalsmeer', 'Aalsmeer', 'Noord-Holland', 'PV27', 4.7492, 52.2655],
];

export function sampleLists() {
  return {
    roads: SAMPLE_ROADS.map(([road, type, names, lon, lat, bbox, points]) => ({
      road,
      slug: road.toLowerCase(),
      type,
      names,
      lon,
      lat,
      bbox,
      points,
    })),
    gemeenten: SAMPLE_GEMEENTEN.map(([code, naam, slug, prov, provCode, lon, lat]) => ({ code, naam, slug, prov, provCode, lon, lat })),
    woonplaatsen: SAMPLE_WOONPLAATSEN.map(([code, naam, slug, gemeente, gemeenteCode, prov, provCode, lon, lat]) => ({
      code, naam, slug, gemeente, gemeenteCode, prov, provCode, lon, lat,
    })),
    bridges: SAMPLE_BRIDGES.map(([id, slug, name, road, water, gemeente, woonplaats, prov, provCode, lon, lat]) => {
      const b = { id, slug, name, gemeente, woonplaats, prov, provCode, lon, lat };
      if (road) b.road = road;
      if (water) b.water = water;
      return b;
    }),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Loading                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function readJsonSafe(path, warn) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    warn(`[gen-pages] ${path} kon niet worden gelezen (${err.message}) – overgeslagen`);
    return null;
  }
}

/** Candidate directories, most authoritative first. */
export function listDirCandidates({ repoRoot, webRoot, listsDir }) {
  const dirs = [];
  if (listsDir) dirs.push(listsDir);
  dirs.push(join(repoRoot, 'pipeline', 'static'));
  dirs.push(join(webRoot, 'public', 'lists'));
  return dirs;
}

/**
 * Load the three lists. Every file is looked up independently (so a partially finished
 * pipeline still works); a missing file falls back to the sample of that list.
 * Returns `{ roads, gemeenten, woonplaatsen, bridges, sources: {wegen, plaatsen, bruggen} }`.
 */
export function loadLists({ repoRoot, webRoot, listsDir, warn = console.warn }) {
  const sample = sampleLists();
  const dirs = listDirCandidates({ repoRoot, webRoot, listsDir });
  const found = {};
  for (const file of LIST_FILES) {
    for (const dir of dirs) {
      const p = join(dir, file);
      if (existsSync(p)) {
        const json = readJsonSafe(p, warn);
        if (json) {
          found[file] = { path: p, json };
          break;
        }
      }
    }
  }

  const sources = {};
  const pick = (file, key, validate) => {
    const hit = found[file];
    if (hit && validate(hit.json)) {
      sources[file] = hit.path;
      return hit.json;
    }
    if (hit) warn(`[gen-pages] ${hit.path} heeft niet de verwachte vorm – sample gebruikt`);
    sources[file] = 'sample';
    return null;
  };

  const wegen = pick('wegen.json', 'roads', (j) => Array.isArray(j?.roads));
  const plaatsen = pick('plaatsen.json', 'plaatsen', (j) => Array.isArray(j?.gemeenten) && Array.isArray(j?.woonplaatsen));
  const bruggen = pick('bruggen.json', 'bridges', (j) => Array.isArray(j?.bridges));

  const roads = (wegen ? wegen.roads : sample.roads).filter(validRoad);
  const gemeenten = (plaatsen ? plaatsen.gemeenten : sample.gemeenten).filter(validPlace);
  const woonplaatsen = (plaatsen ? plaatsen.woonplaatsen : sample.woonplaatsen).filter(validPlace);
  const bridges = (bruggen ? bruggen.bridges : sample.bridges).filter(validBridge);

  return { roads, gemeenten, woonplaatsen, bridges, sources, isSample: !wegen && !plaatsen && !bruggen };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

function validRoad(r) {
  return r && nonEmpty(r.road) && nonEmpty(r.slug) && isNum(r.lon) && isNum(r.lat);
}
function validPlace(p) {
  return p && nonEmpty(p.naam) && nonEmpty(p.slug) && isNum(p.lon) && isNum(p.lat);
}
function validBridge(b) {
  return b && nonEmpty(b.id) && nonEmpty(b.slug) && nonEmpty(b.name) && isNum(b.lon) && isNum(b.lat);
}

/**
 * Copy the real list files (when they exist) to `destDir`. Returns the copied file names.
 * Files are only copied when the source is newer or the destination is missing.
 */
export function copyLists({ repoRoot, webRoot, listsDir, destDir, warn = console.warn }) {
  const dirs = listDirCandidates({ repoRoot, webRoot, listsDir }).filter((d) => d !== destDir);
  const copied = [];
  for (const file of LIST_FILES) {
    const src = dirs.map((d) => join(d, file)).find((p) => existsSync(p));
    if (!src) continue;
    try {
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, file);
      if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs || statSync(dest).size !== statSync(src).size) {
        copyFileSync(src, dest);
      }
      copied.push(file);
    } catch (err) {
      warn(`[gen-pages] kopiëren van ${file} naar ${destDir} mislukt: ${err.message}`);
    }
  }
  return copied;
}

/* ------------------------------------------------------------------------------------------ */
/* Geo helpers                                                                                */
/* ------------------------------------------------------------------------------------------ */

/** Approximate planar distance in km between two WGS84 points (fine for NL). */
export function distanceKm(lon1, lat1, lon2, lat2) {
  const kx = 111.32 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * kx;
  const dy = (lat2 - lat1) * 110.57;
  return Math.hypot(dx, dy);
}

/** Numeric part of a road number ("A2" → 2, "s100" → 100, "N57a" → 57). */
export function roadNumber(road) {
  const m = /(\d+)/.exec(road);
  return m ? Number.parseInt(m[1], 10) : Number.NaN;
}

/** Nearest `n` roads of the same type by road number (ties → lower number first). */
export function nearestRoads(road, roads, n = 12) {
  const num = roadNumber(road.road);
  return roads
    .filter((r) => r !== road && r.type === road.type && r.slug !== road.slug)
    .map((r) => ({ r, d: Math.abs(roadNumber(r.road) - num) }))
    .sort((a, b) => a.d - b.d || roadNumber(a.r.road) - roadNumber(b.r.road))
    .slice(0, n)
    .map((x) => x.r);
}

export function nearestByCentroid(item, candidates, n) {
  return candidates
    .filter((c) => c !== item)
    .map((c) => ({ c, d: distanceKm(item.lon, item.lat, c.lon, c.lat) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.c);
}
