/**
 * The Geoapify Routing API (https://apidocs.geoapify.com/docs/routing/), the router for when the
 * site is commercial: its free plan (3.000 credits a day) allows commercial use, the FOSSGIS
 * server does not. Chosen with the build variable `VITE_ROUTING_URL` =
 * `https://api.geoapify.com/v1/routing?apiKey=<key>`; data/routing.ts picks this module by host.
 *
 * Differences from Valhalla that matter here:
 *  - `avoid=location:lat,lon|…` is soft ("won't exclude roads if there are no alternatives"):
 *    data/route-plan.ts judges every route it gets again, so a route that still runs through
 *    the closure is shown as such, never as a way round;
 *  - there are no alternative routes: a plan has the fastest route and, when that one is
 *    closed, the route round the closure;
 *  - the answer is GeoJSON: one feature per route, a MultiLineString (one line per leg),
 *    `properties.distance` in metres and `properties.time` in seconds.
 *
 * Pure; unit-tested in web/test/routing-geoapify.test.mjs.
 */
import type { LonLat } from './route-match';
import { MAX_ROUTE_POINTS, RoutingError, inRouteBounds, type RouteOption, type RouteRequest } from './routing-types';
import type { VehicleMode } from './verdict';

const MODE: Record<VehicleMode, string> = { auto: 'drive', vracht: 'truck', fiets: 'bicycle' };
/** Geoapify asks for client-side pacing; a burst over its limit answers 429. */
export const GEOAPIFY_GAP_MS = 250;

export function isGeoapify(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === 'api.geoapify.com';
  } catch {
    return false;
  }
}

const ll = (lon: number, lat: number): string => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** The GET URL: the configured endpoint (with its apiKey) plus the route question. */
export function buildGeoapifyUrl(endpoint: string, req: RouteRequest): string {
  const url = new URL(endpoint);
  url.searchParams.set('waypoints', `${ll(req.from.lon, req.from.lat)}|${ll(req.to.lon, req.to.lat)}`);
  url.searchParams.set('mode', MODE[req.mode]);
  url.searchParams.set('type', 'balanced');
  url.searchParams.set('units', 'metric');
  url.searchParams.set('lang', 'nl');
  if (req.avoid && req.avoid.length > 0) {
    url.searchParams.set('avoid', req.avoid.map(([lon, lat]) => `location:${ll(lon, lat)}`).join('|'));
  } else url.searchParams.delete('avoid');
  return url.toString();
}

function linesOf(geometry: unknown): LonLat[][] | null {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!g || !Array.isArray(g.coordinates)) return null;
  const raw = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : null;
  if (!raw) return null;
  const lines: LonLat[][] = [];
  for (const line of raw as unknown[]) {
    if (!Array.isArray(line)) return null;
    const pts: LonLat[] = [];
    for (const p of line as unknown[]) {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
      pts.push([p[0], p[1]]);
    }
    lines.push(pts);
  }
  return lines;
}

/** One feature as a route: the legs joined without repeating the point they share. */
function featureOf(f: unknown): RouteOption | null {
  const feature = f as { geometry?: unknown; properties?: { distance?: unknown; time?: unknown; distance_units?: unknown } } | null;
  const lines = linesOf(feature?.geometry);
  if (!lines) return null;
  const coords: LonLat[] = [];
  for (const line of lines) {
    for (const p of line) {
      if (!inRouteBounds(p) || coords.length >= MAX_ROUTE_POINTS) return null;
      const last = coords[coords.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p);
    }
  }
  const m = Number(feature?.properties?.distance);
  const s = Number(feature?.properties?.time);
  const units = feature?.properties?.distance_units;
  const metres = units === 'miles' ? m * 1609.344 : m;
  if (coords.length < 2 || !(metres >= 0) || !(s >= 0) || !Number.isFinite(metres) || !Number.isFinite(s)) return null;
  return { coords, distanceM: Math.round(metres), durationS: Math.round(s) };
}

/** The routes in a Geoapify answer (a point far outside the Netherlands makes a route unusable). */
export function parseGeoapifyResponse(json: unknown): RouteOption[] {
  const j = (json ?? {}) as { features?: unknown };
  if (!Array.isArray(j.features)) throw new RoutingError('De routeplanner gaf geen bruikbare route.', 'failed');
  const routes = j.features.map(featureOf).filter((r): r is RouteOption => r !== null);
  if (routes.length === 0) throw new RoutingError('Geen route gevonden tussen deze plaatsen.', 'none');
  return routes;
}

/**
 * An error answer (`{ statusCode, error, message }`): "no route" is not a failure of the
 * service, everything else is. Geoapify documents no code for it, so the message decides.
 */
export function geoapifyError(status: number, json: unknown): RoutingError {
  const message = String((json as { message?: unknown } | null)?.message ?? '');
  if (status === 401 || status === 403) return new RoutingError('De routeplanner weigert de sleutel van deze site.', 'failed');
  if (status === 429) return new RoutingError('De routeplanner is even te druk. Probeer het zo nog eens.', 'failed');
  if (status >= 400 && status < 500 && /no (route|path)|not? (be )?found|unreachable|could ?n.?t (find|route)|impossible/i.test(message)) {
    return new RoutingError('Geen route gevonden tussen deze plaatsen.', 'none');
  }
  return new RoutingError('De routeplanner gaf een fout.', 'failed');
}
