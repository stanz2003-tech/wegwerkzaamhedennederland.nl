/**
 * The router: from A to B for a vehicle, optionally avoiding points. Speaks the Valhalla API
 * (https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/), which the FOSSGIS
 * server, Stadia Maps and a self-hosted Valhalla all offer — so moving to another host is one
 * build variable (`VITE_ROUTING_URL`, the full `/route` endpoint, a key in its query string if
 * the host wants one), not a code change.
 *
 * FOSSGIS terms (www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen): at most one
 * request per second, OSM attribution with a "fix the map" link, a reachable operator e-mail, and
 * no use as a substantial part of a commercial or high-traffic site. The one-per-second rule is
 * enforced here for every caller; docs/handleiding.md says when to move to another host.
 *
 * Request building and response parsing are pure and unit-tested (web/test/routing.test.mjs).
 */
import type { LonLat } from './route-match';
import type { VehicleMode } from './verdict';

export const DEFAULT_ROUTING_URL = 'https://valhalla1.openstreetmap.de/route';
/** FOSSGIS: max one request per second. A little margin for clock jitter. */
export const MIN_REQUEST_GAP_MS = 1100;
const TIMEOUT_MS = 20_000;
/** Valhalla's own maximum is 2 alternates on the public servers. */
export const MAX_ALTERNATES = 2;
/** A route through the Netherlands has a few thousand points; far more means a broken answer. */
export const MAX_ROUTE_POINTS = 100_000;
/** Router points outside this box are not a Dutch route (lon/lat, with a margin for Belgium and Germany). */
const ROUTE_BOUNDS = { west: 1.5, east: 9.0, south: 49.5, north: 54.5 } as const;

export interface Stop {
  /** What the user picked: "Almkerk", "Kerkstraat 1, Montfoort". */
  name: string;
  lon: number;
  lat: number;
}

export interface RouteRequest {
  from: Stop;
  to: Stop;
  mode: VehicleMode;
  /** Points the route must not pass (each snaps to the road it lies on). */
  avoid?: readonly LonLat[];
  alternates?: number;
}

export interface RouteOption {
  /** [lon, lat] polyline from start to end. */
  coords: LonLat[];
  distanceM: number;
  durationS: number;
}

export class RoutingError extends Error {
  /** 'none' = no route exists between the points (not a technical failure). */
  readonly kind: 'none' | 'failed';

  constructor(message: string, kind: 'none' | 'failed') {
    super(message);
    this.name = 'RoutingError';
    this.kind = kind;
  }
}

const COSTING: Record<VehicleMode, string> = { auto: 'auto', vracht: 'truck', fiets: 'bicycle' };

/** The `/route` endpoint: `VITE_ROUTING_URL` at build time (empty = unset), else FOSSGIS. */
export function routingEndpoint(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_ROUTING_URL?.trim() || DEFAULT_ROUTING_URL;
}

/** Whether the public FOSSGIS server answers: its terms ask for a credit naming it. */
export function usesFossgis(endpoint = routingEndpoint()): boolean {
  return endpoint.startsWith('https://valhalla1.openstreetmap.de/');
}

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** The Valhalla `/route` JSON body. */
export function buildRouteBody(req: RouteRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    locations: [
      { lat: round5(req.from.lat), lon: round5(req.from.lon), type: 'break' },
      { lat: round5(req.to.lat), lon: round5(req.to.lon), type: 'break' },
    ],
    costing: COSTING[req.mode],
    directions_type: 'none',
    units: 'kilometers',
    language: 'nl-NL',
  };
  const alternates = Math.max(0, Math.min(MAX_ALTERNATES, req.alternates ?? 0));
  if (alternates > 0) body.alternates = alternates;
  if (req.avoid && req.avoid.length > 0) {
    body.exclude_locations = req.avoid.map(([lon, lat]) => ({ lat: round5(lat), lon: round5(lon) }));
  }
  return body;
}

/** Valhalla's encoded polyline, precision 6, as [lon, lat]. */
export function decodePolyline6(str: string): LonLat[] {
  const out: LonLat[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (i >= str.length) return null;
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

interface ValhallaTrip {
  legs?: { shape?: unknown }[];
  summary?: { length?: unknown; time?: unknown };
}

const inBounds = ([lon, lat]: LonLat): boolean => lon >= ROUTE_BOUNDS.west && lon <= ROUTE_BOUNDS.east && lat >= ROUTE_BOUNDS.south && lat <= ROUTE_BOUNDS.north;

function tripOf(trip: ValhallaTrip | undefined): RouteOption | null {
  if (!trip || !Array.isArray(trip.legs)) return null;
  const coords: LonLat[] = [];
  for (const leg of trip.legs) {
    if (typeof leg?.shape !== 'string') return null;
    const part = decodePolyline6(leg.shape);
    for (let i = coords.length > 0 ? 1 : 0; i < part.length; i++) {
      const c = part[i];
      if (!c || !inBounds(c) || coords.length >= MAX_ROUTE_POINTS) return null;
      coords.push(c);
    }
  }
  const km = Number(trip.summary?.length);
  const s = Number(trip.summary?.time);
  if (coords.length < 2 || !(km >= 0) || !(s >= 0) || !Number.isFinite(km) || !Number.isFinite(s)) return null;
  return { coords, distanceM: Math.round(km * 1000), durationS: Math.round(s) };
}

/** The main trip plus its alternates; throws RoutingError for an error body or nothing usable. */
export function parseRouteResponse(json: unknown): RouteOption[] {
  const j = (json ?? {}) as { trip?: ValhallaTrip; alternates?: { trip?: ValhallaTrip }[]; error_code?: unknown; error?: unknown };
  if (j.error_code !== undefined || j.error !== undefined) {
    // 442 "No path could be found for input", 171 "No suitable edges near location".
    const code = Number(j.error_code);
    const none = code === 442 || code === 171 || code === 170;
    throw new RoutingError(none ? 'Geen route gevonden tussen deze plaatsen.' : 'De routeplanner gaf een fout.', none ? 'none' : 'failed');
  }
  const main = tripOf(j.trip);
  if (!main) throw new RoutingError('De routeplanner gaf geen bruikbare route.', 'failed');
  const alts = (Array.isArray(j.alternates) ? j.alternates : []).map((a) => tripOf(a?.trip)).filter((r): r is RouteOption => r !== null);
  return [main, ...alts];
}

/* ---------------------------------- network ---------------------------------- */

let queue: Promise<unknown> = Promise.resolve();
/** Start of the last request on the monotonic clock: a wall-clock jump must not stall or skip the gap. */
let lastAt = Number.NEGATIVE_INFINITY;

const aborted = (): DOMException => new DOMException('Afgebroken', 'AbortError');

/**
 * Runs `task` after the previous one, at least MIN_REQUEST_GAP_MS after that one started. A task
 * whose signal is aborted while it waits is dropped without using a slot, so a user clicking
 * through moments does not leave a queue of dead requests to the router.
 */
function throttled<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = queue.then(async () => {
    if (signal?.aborted) throw aborted();
    const wait = lastAt + MIN_REQUEST_GAP_MS - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (signal?.aborted) throw aborted();
    lastAt = performance.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function fetchRoutes(req: RouteRequest, signal?: AbortSignal): Promise<RouteOption[]> {
  return throttled(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const onAbort = (): void => ctrl.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(routingEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRouteBody(req)),
        signal: ctrl.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok && json === null) throw new RoutingError(`De routeplanner is niet bereikbaar (${res.status}).`, 'failed');
      return parseRouteResponse(json);
    } catch (err) {
      if (err instanceof RoutingError) throw err;
      if (signal?.aborted) throw err;
      throw new RoutingError('De routeplanner is niet bereikbaar. Probeer het zo nog eens.', 'failed');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }, signal);
}
