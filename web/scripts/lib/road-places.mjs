/**
 * Which places a road runs through, and which roads run through a place: the links between road
 * pages and place pages.
 *
 * Until 2026-11 road pages linked only to other roads (by number) and place pages only to other
 * places, so the two halves of the site met only in /wegen/ and /plaatsen/ (3,400 links on two
 * pages). Google indexed the pages those lists and the home page lead to; of the 2,578 sitemap
 * URLs, 1,856 had no impression in four weeks. A link from the gemeente pages Google already
 * ranks to the roads around them, and from each road to the places along it, is also what a
 * reader of "wegwerkzaamheden Nieuwegein" looks for next.
 *
 * How: every stretch of a road's course (`public/road-lines/<slug>.json`, NWB) belongs to the
 * woonplaats whose centre is nearest, a Voronoi split of the country without needing borders. A
 * road runs through a place when at least MIN_STRETCH_M of it lies in that place's area. Roads
 * without a course in the NWB (the city ring roads s100…) go with the place nearest their centre.
 * Areas follow centres, not borders, so the outskirts of a city with one centre can fall to a
 * neighbour: the page headings say "in en rond" and "langs", not "in de gemeente".
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { roadNumber } from './lists.mjs';
import { roadKind } from './text.mjs';

/** Spacing of the points sampled along a road. */
export const STEP_M = 250;
/** A stretch further than this from every woonplaats centre belongs to none (the Afsluitdijk, a lake). */
export const MAX_CELL_DISTANCE_M = 6000;
/** A road that only clips a place's area for less than this does not run through it. */
export const MIN_STRETCH_M = 300;

/* The most a block on a page holds. */
const MAX_PLACE_ROADS = 20;
const MAX_ALONG_GEMEENTEN = 40;
const MAX_ALONG_PLACES = 40;
const ROAD_TYPE_ORDER = { A: 0, N: 1, E: 2, S: 3 };

const M_PER_DEG_LAT = 110_540;
/** Metres per degree of longitude at the latitude of the Netherlands. */
const M_PER_DEG_LON = 111_320 * Math.cos((52 * Math.PI) / 180);
const CELL_DEG = 0.05;

/**
 * The courses of all roads in `dir` (`<slug>.json` with `lines: [[lon, lat], …][]`). A missing
 * directory or a broken file leaves those roads without a course.
 * @returns {Map<string, [number, number][][]>}
 */
export function loadRoadLines(dir, warn = console.warn) {
  const lines = new Map();
  if (!existsSync(dir)) {
    warn(`[gen-pages] ${dir} ontbreekt – wegen en plaatsen worden alleen via hun middelpunt gekoppeld`);
    return lines;
  }
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const json = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (Array.isArray(json?.lines)) lines.set(file.slice(0, -5), json.lines.filter((l) => Array.isArray(l) && l.length > 1));
    } catch (err) {
      warn(`[gen-pages] ${file}: ${err.message}`);
    }
  }
  return lines;
}

const isPoint = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Nearest woonplaats centre within MAX_CELL_DISTANCE_M, via a grid of CELL_DEG squares. */
function nearestFinder(woonplaatsen) {
  const grid = new Map();
  const keyOf = (cx, cy) => `${cx}:${cy}`;
  for (const w of woonplaatsen) {
    if (!Number.isFinite(w.lon) || !Number.isFinite(w.lat)) continue;
    const k = keyOf(Math.floor(w.lon / CELL_DEG), Math.floor(w.lat / CELL_DEG));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(w);
  }
  const reach = Math.ceil(MAX_CELL_DISTANCE_M / (CELL_DEG * M_PER_DEG_LON));
  return (lon, lat) => {
    const cx = Math.floor(lon / CELL_DEG);
    const cy = Math.floor(lat / CELL_DEG);
    let best = null;
    let bestD = MAX_CELL_DISTANCE_M;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (const w of grid.get(keyOf(cx + dx, cy + dy)) ?? []) {
          const d = Math.hypot((w.lon - lon) * M_PER_DEG_LON, (w.lat - lat) * M_PER_DEG_LAT);
          if (d <= bestD) {
            bestD = d;
            best = w;
          }
        }
      }
    }
    return best;
  };
}

/** Metres of `lines` in each woonplaats area, by woonplaats slug. */
function stretchesPerPlace(lines, nearest) {
  const metres = new Map();
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      if (!isPoint(a) || !isPoint(b)) continue;
      const len = Math.hypot((b[0] - a[0]) * M_PER_DEG_LON, (b[1] - a[1]) * M_PER_DEG_LAT);
      const n = Math.max(1, Math.ceil(len / STEP_M));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const w = nearest(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
        if (w) metres.set(w.slug, (metres.get(w.slug) ?? 0) + len / n);
      }
    }
  }
  return metres;
}

/**
 * @param {object} p
 * @param {{ slug: string, lon: number, lat: number }[]} p.roads
 * @param {{ slug: string, lon: number, lat: number }[]} p.woonplaatsen
 * @param {Map<string, [number, number][][]>} p.lines   road slug → course
 * @returns {{ placesByRoad: Map<string, { slug: string, metres: number }[]>, roadsByPlace: Map<string, { slug: string, metres: number }[]> }}
 *   road slug → woonplaats slugs and woonplaats slug → road slugs, longest stretch first
 */
export function roadPlaceLinks({ roads, woonplaatsen, lines }) {
  const nearest = nearestFinder(woonplaatsen);
  const placesByRoad = new Map();
  const roadsByPlace = new Map();
  for (const road of roads) {
    let along = [];
    const course = lines.get(road.slug);
    if (course?.length) {
      along = [...stretchesPerPlace(course, nearest)].filter(([, m]) => m >= MIN_STRETCH_M).map(([slug, metres]) => ({ slug, metres }));
    } else if (Number.isFinite(road.lon) && Number.isFinite(road.lat)) {
      const place = nearest(road.lon, road.lat);
      if (place) along = [{ slug: place.slug, metres: MIN_STRETCH_M }];
    }
    along.sort((x, y) => y.metres - x.metres);
    placesByRoad.set(road.slug, along);
    for (const { slug, metres } of along) {
      if (!roadsByPlace.has(slug)) roadsByPlace.set(slug, []);
      roadsByPlace.get(slug).push({ slug: road.slug, metres });
    }
  }
  for (const list of roadsByPlace.values()) list.sort((x, y) => y.metres - x.metres);
  return { placesByRoad, roadsByPlace };
}

const linkCache = new Map();

/**
 * roadPlaceLinks for the lists and courses of this site, worked out once per process (~0.4 s):
 * the dev server builds a model for every request. The result holds only slugs, so any model
 * built from the same lists can use it.
 */
export function roadPlacesFor({ dir, roads, woonplaatsen, warn }) {
  const key = [dir, roads.length, woonplaatsen.length, roads[0]?.slug, woonplaatsen[0]?.slug].join('|');
  if (!linkCache.has(key)) linkCache.set(key, roadPlaceLinks({ roads, woonplaatsen, lines: loadRoadLines(dir, warn) }));
  return linkCache.get(key);
}

/** A page that exists and is in Google: links go only there (no noindex page, no redirect). */
function linkable(model, path) {
  const page = model.byPath.get(path);
  return Boolean(page) && page.thin !== true;
}

const byName = (a, b) => a.naam.localeCompare(b.naam, 'nl');

/** Roads through a woonplaats, or through any woonplaats of a gemeente: A-roads first, then by number. */
export function roadsThroughPlace(model, page) {
  const { roadsByPlace } = model.index.roadPlaces();
  const places = page.kind === 'gemeente' ? model.index.woonplaatsenByGemeente.get(page.entity.code) ?? [] : [page.entity];
  const roads = new Set();
  for (const w of places) {
    for (const { slug } of roadsByPlace.get(w.slug) ?? []) {
      const road = model.index.roadBySlug.get(slug);
      if (road) roads.add(road);
    }
  }
  return [...roads]
    .filter((r) => linkable(model, `/weg/${r.slug}/`))
    .sort((a, b) => (ROAD_TYPE_ORDER[a.type] ?? 9) - (ROAD_TYPE_ORDER[b.type] ?? 9) || roadNumber(a.road) - roadNumber(b.road))
    .slice(0, MAX_PLACE_ROADS)
    .map((r) => ({ road: r.road, href: `/weg/${r.slug}/`, badgeClass: roadKind(r.type).badge }));
}

/**
 * Gemeenten and woonplaatsen a road runs through, the longest stretches first, shown by name; two
 * woonplaatsen with the same name (Klarenbeek in Apeldoorn and in Voorst) get their gemeente. A
 * woonplaats that redirects to its gemeente is left out: the gemeente is already listed.
 */
export function placesAlongRoad(model, road) {
  const along = model.index.roadPlaces().placesByRoad.get(road.slug) ?? [];
  const woonplaatsen = along.map(({ slug }) => model.index.woonplaatsBySlug.get(slug)).filter(Boolean);
  const gemeenten = [];
  for (const w of woonplaatsen) {
    const g = model.index.gemeenteByCode.get(w.gemeenteCode);
    if (g && !gemeenten.includes(g) && linkable(model, `/gemeente/${g.slug}/`)) gemeenten.push(g);
  }
  const places = woonplaatsen.filter((w) => !model.index.merged.has(w) && linkable(model, `/plaats/${w.slug}/`)).slice(0, MAX_ALONG_PLACES);
  const nameCount = new Map();
  for (const w of places) nameCount.set(w.naam, (nameCount.get(w.naam) ?? 0) + 1);
  return {
    alongGemeenten: gemeenten.slice(0, MAX_ALONG_GEMEENTEN).sort(byName).map((g) => ({ name: g.naam, href: `/gemeente/${g.slug}/` })),
    alongPlaces: places.sort(byName).map((w) => ({
      name: nameCount.get(w.naam) > 1 && w.gemeente ? `${w.naam} (${w.gemeente})` : w.naam,
      href: `/plaats/${w.slug}/`,
    })),
  };
}
