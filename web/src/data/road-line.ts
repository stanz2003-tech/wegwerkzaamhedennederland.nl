/**
 * The course of an A- or N-road for the map's road mode: `/road-lines/<slug>.json`, a static file
 * built from the NWB by pipeline/bin/build-road-lines.js ({ road, source, lines }). A road without
 * a file (S-routes, renumbered roads) or a failed request simply has no line; road mode works the
 * same without it.
 */
import { normalizeRoadParam } from './url-state';
import { slugify } from './types';

export type RoadLineCoords = [number, number][][];

const FETCH_TIMEOUT_MS = 10_000;

function isCoord(c: unknown): c is [number, number] {
  return Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);
}

/** The lines of a road-lines file, or null when it is not one (validated: it comes over the network). */
export function parseRoadLineFile(v: unknown): RoadLineCoords | null {
  if (typeof v !== 'object' || v === null || !Array.isArray((v as { lines?: unknown }).lines)) return null;
  const lines: RoadLineCoords = [];
  for (const line of (v as { lines: unknown[] }).lines) {
    if (!Array.isArray(line)) continue;
    const coords = line.filter(isCoord).map((c) => [c[0], c[1]] as [number, number]);
    if (coords.length >= 2) lines.push(coords);
  }
  return lines.length > 0 ? lines : null;
}

/** The file for a road number ("A2" → "/road-lines/a2.json"); null for what is no A- or N-road. */
export function roadLineUrl(road: string): string | null {
  const key = normalizeRoadParam(road);
  return key && /^[AN]\d/.test(key) ? `/road-lines/${slugify(key)}.json` : null;
}

const cache = new Map<string, Promise<RoadLineCoords | null>>();

/** Loads (once per page) the course of a road; null when there is none or it failed. */
export function loadRoadLine(road: string): Promise<RoadLineCoords | null> {
  const url = roadLineUrl(road);
  if (!url) return Promise.resolve(null);
  let pending = cache.get(url);
  if (!pending) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    pending = fetch(url, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => (json === null ? null : parseRoadLineFile(json)))
      .catch(() => {
        cache.delete(url); // a network hiccup may be gone next time
        return null;
      })
      .finally(() => clearTimeout(timer));
    cache.set(url, pending);
  }
  return pending;
}
