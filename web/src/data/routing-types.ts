/**
 * The shapes every router dialect (data/routing.ts for Valhalla, data/routing-geoapify.ts)
 * shares, apart so the two modules do not import each other.
 */
import type { LonLat } from './route-match';
import type { VehicleMode } from './verdict';

/** A route through the Netherlands has a few thousand points; far more means a broken answer. */
export const MAX_ROUTE_POINTS = 100_000;
/** Router points outside this box are not a Dutch route (lon/lat, with a margin for Belgium and Germany). */
const ROUTE_BOUNDS = { west: 1.5, east: 9.0, south: 49.5, north: 54.5 } as const;

export function inRouteBounds([lon, lat]: LonLat): boolean {
  return lon >= ROUTE_BOUNDS.west && lon <= ROUTE_BOUNDS.east && lat >= ROUTE_BOUNDS.south && lat <= ROUTE_BOUNDS.north;
}

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
