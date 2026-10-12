/**
 * The pure half of route mode: from a judged plan to what the list, the map and the card show.
 * ui/route-controller.ts holds the state and the router calls; everything here is a function of
 * its arguments (unit-tested in web/test/route-view.test.mjs).
 */
import type { BBox } from '../data/filter';
import { liveAppliesAt, type When } from '../data/forecast';
import { deviatingPoints, type LonLat } from '../data/route-match';
import { besideNote, tripWhen, type AssessedRoute, type RoutePlan } from '../data/route-plan';
import type { RouteOption } from '../data/routing';
import { overlapsWindow } from '../data/time';
import type { ItemFeature } from '../data/types';
import type { RouteStops, UrlState } from '../data/url-state';
import type { RouteDrawing } from '../map/route-layers';
import type { RouteCardModel } from './route-card';

const MINUTE = 60_000;

export interface RouteSelection {
  /** Items on the chosen route that touch the trip, in driving order. */
  base: ItemFeature[];
  /** The trip window every verdict in list and map is judged over. */
  window: { from: number; to: number };
  /** Changes whenever the map must get new data. */
  key: string;
  /** Driving order of the list (the position along the route). */
  order(features: readonly ItemFeature[]): ItemFeature[];
  /**
   * Set while there is no judged route (planning, or the router failed): the list must then say
   * so, never "geen meldingen op je route".
   */
  pending: 'loading' | 'error' | null;
}

export const stopsKeyOf = (s: RouteStops): string => [s.from.lon, s.from.lat, s.to.lon, s.to.lat].map((n) => n.toFixed(5)).join(',');

/** The question's moment as the user set it: "nu" stays "nu" while the clock runs. */
export const whenKeyOf = (u: Pick<UrlState, 'time' | 'moment' | 'day' | 'part'>): string => `${u.time}|${u.moment ?? ''}|${u.day ?? ''}|${u.part ?? ''}`;

/** One route told apart from the others (survives a re-judge that reorders them). */
export const optionKeyOf = (o: RouteOption): string => `${o.distanceM}:${o.durationS}`;

export function pendingSelection(pending: 'loading' | 'error', now: number): RouteSelection {
  return { base: [], window: { from: now, to: now }, key: `route:${pending}`, order: (f) => [...f], pending };
}

/** The items of the chosen route for the list and the map, judged over the trip. */
export function routeSelection(route: AssessedRoute, items: readonly ItemFeature[], when: When, now: number): RouteSelection {
  const trip = tripWhen(when, route.option.durationS);
  const window = trip.kind === 'window' ? { from: trip.from, to: trip.to } : { from: trip.at, to: trip.at };
  const position = new Map(route.on.map((m) => [m.id, m.fromM]));
  const byId = new Map(items.map((f) => [f.properties.id, f]));
  const base = route.on
    .map((m) => byId.get(m.id))
    .filter((f): f is ItemFeature => f !== undefined && overlapsWindow(f.properties, window.from, window.to) && liveAppliesAt(f.properties, window.from, now));
  // Minutes, not milliseconds: "nu" moves on every render and must not re-upload the map each time.
  const key = `route:${optionKeyOf(route.option)}:${Math.floor(window.from / MINUTE)}:${Math.floor(window.to / MINUTE)}:${base.length}`;
  return {
    base,
    window,
    key,
    order: (features) => [...features].sort((a, b) => (position.get(a.properties.id) ?? 0) - (position.get(b.properties.id) ?? 0)),
    pending: null,
  };
}

/** The fastest route that was not planned round a closure: the one the others are compared with. */
export function fastestPlain(plan: RoutePlan): AssessedRoute | undefined {
  return [...plan.routes].filter((r) => !r.avoiding).sort((a, b) => a.option.durationS - b.option.durationS)[0] ?? plan.routes[0];
}

/** Google Maps via points per route: none for the fastest, the stretch that differs for the rest. */
export function viaPointsFor(route: AssessedRoute, plan: RoutePlan): LonLat[] {
  const fastest = fastestPlain(plan);
  if (!fastest || fastest === route || optionKeyOf(fastest.option) === optionKeyOf(route.option)) return [];
  return deviatingPoints(route.option.coords, fastest.option.coords);
}

export interface CardInput {
  stops: RouteStops;
  url: UrlState;
  plan: RoutePlan;
  chosen: number;
  items: readonly ItemFeature[];
  when: When;
  now: number;
  questionWhen: string;
  updating: boolean;
  dataAsOf: string | undefined;
  via(route: AssessedRoute): LonLat[];
}

export function readyModel(i: CardInput): RouteCardModel {
  const route = i.plan.routes[i.chosen];
  return {
    status: 'ready',
    from: i.stops.from,
    to: i.stops.to,
    mode: i.url.mode,
    questionWhen: i.questionWhen,
    departAt: i.when.kind === 'moment' ? i.when.at : null,
    choices: i.plan.routes.map((r) => ({ option: r.option, answer: r.answer, avoiding: r.avoiding, blocked: r.blockers.length > 0, via: i.via(r) })),
    selected: i.chosen,
    recommended: i.plan.recommended,
    noClearRoute: i.plan.noClearRoute,
    beside: route ? besideNote(route, i.items, { mode: i.url.mode, when: i.when, now: i.now }) : { count: 0, closures: [] },
    updating: i.updating,
    ...(i.dataAsOf ? { dataAsOf: i.dataAsOf } : {}),
  };
}

/** What the map draws: every route (the chosen one highlighted) and the two stops. */
export function drawingOf(stops: RouteStops | null, plan: RoutePlan | null, chosen: number): RouteDrawing | null {
  if (!stops) return null;
  const ends = { from: [stops.from.lon, stops.from.lat] as LonLat, to: [stops.to.lon, stops.to.lat] as LonLat };
  if (!plan) return { routes: [], ...ends };
  return { routes: plan.routes.map((r, i) => ({ coords: r.option.coords, selected: i === chosen })), ...ends };
}

export function bboxOfRoutes(options: readonly { option: RouteOption }[]): BBox | null {
  let b: BBox | null = null;
  for (const { option } of options) {
    for (const [x, y] of option.coords) {
      b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
    }
  }
  return b;
}
