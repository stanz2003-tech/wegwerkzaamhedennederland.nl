/**
 * The route question: "Kan ik van Almkerk naar Montfoort, en zo niet, hoe dan wel?"
 *
 *  1. Ask the router for the fastest route and up to two alternatives.
 *  2. Judge each route: the items ON it (data/route-match.ts), with the verdict for the vehicle
 *     over the whole trip — leaving at the asked moment, the trip window runs until arrival, so a
 *     night closure that starts while you are on the road counts.
 *  3. When the fastest route runs into a closure (`dicht`, or `rijbaan` on your own carriageway),
 *     ask again avoiding those closures, and once more if the new route meets another one.
 *  4. Recommend the fastest route without a closure; if none exists, say so and show them all.
 *
 * The verdicts are the site's own (answerFor / selectWhen): nothing here judges an item
 * differently. Network access comes in through `PlanDeps`, so the whole flow is unit-tested
 * with a fake router (web/test/route-plan.test.mjs).
 */
import { answerFor, type Answer } from './answer';
import { selectWhen, type ForecastItem, type When } from './forecast';
import { MAX_AVOID_POINTS, avoidPoints, matchRoute, type LonLat, type RouteMatch } from './route-match';
import { MAX_ALTERNATES, RoutingError, type RouteOption, type RouteRequest, type Stop } from './routing';
import type { ItemDetail, ItemFeature } from './types';
import type { VehicleMode, VerdictLevel } from './verdict';

/** How often the planner re-asks the router to get round closures it ran into. */
export const MAX_AVOID_ROUNDS = 2;
const BLOCKING: ReadonlySet<VerdictLevel> = new Set<VerdictLevel>(['dicht', 'rijbaan']);

export interface PlanQuestion {
  from: Stop;
  to: Stop;
  mode: VehicleMode;
  /** The asked moment (departure) or window, as the answer card has it. */
  when: When;
  now: number;
  horizonMs?: number;
}

export interface PlanDeps {
  route(req: RouteRequest): Promise<RouteOption[]>;
  /** Every item the question may need (actueel + live, + gepland when it looks ahead). */
  items(): readonly ItemFeature[];
  /** Details for these ids; missing ones are judged without (conservatively). */
  details(ids: readonly string[]): Promise<ReadonlyMap<string, ItemDetail>>;
}

export interface AssessedRoute {
  option: RouteOption;
  /** Items on the route itself, in driving order. */
  on: RouteMatch[];
  /** Items alongside it (the other carriageway, a parallel road), in driving order. */
  beside: RouteMatch[];
  /** The verdict over the trip, for the items on the route. */
  answer: Answer;
  /** The `on` items whose verdict closes the road for this vehicle during the trip. */
  blockers: RouteMatch[];
  /** Planned round the closures of a faster route. */
  avoiding: boolean;
}

export interface RoutePlan {
  /** Fastest first. */
  routes: AssessedRoute[];
  /** Index into `routes` of the one to show first. */
  recommended: number;
  /** No route without a closure was found. */
  noClearRoute: boolean;
}

/** The window a trip covers: from departure to arrival; a window question keeps its own window. */
export function tripWhen(when: When, durationS: number): When {
  if (when.kind === 'window') return when;
  return { kind: 'window', from: when.at, to: when.at + Math.max(0, durationS) * 1000 };
}

/** Judges one route with the items and details at hand. Pure. */
export function assessRoute(
  option: RouteOption,
  features: readonly ItemFeature[],
  details: ReadonlyMap<string, ItemDetail>,
  q: Pick<PlanQuestion, 'mode' | 'when' | 'now' | 'horizonMs'>,
  avoiding = false,
): AssessedRoute {
  return assessMatches(option, matchRoute(option.coords, features), features, details, q, avoiding);
}

/** `assessRoute` with the matches already known (ui/route-controller.ts caches them per route). */
export function assessMatches(
  option: RouteOption,
  matches: readonly RouteMatch[],
  features: readonly ItemFeature[],
  details: ReadonlyMap<string, ItemDetail>,
  q: Pick<PlanQuestion, 'mode' | 'when' | 'now' | 'horizonMs'>,
  avoiding = false,
): AssessedRoute {
  const byId = new Map(features.map((f) => [f.properties.id, f]));
  const on = matches.filter((m) => m.side === 'op' && byId.has(m.id));
  const beside = matches.filter((m) => m.side === 'naast' && byId.has(m.id));
  const items: ForecastItem[] = on.flatMap((m) => {
    const f = byId.get(m.id);
    return f ? [{ f, d: details.get(m.id) ?? null }] : [];
  });
  const when = tripWhen(q.when, option.durationS);
  const answer = answerFor(items, q.mode, when, { kind: 'gebied', name: '' }, q.now, q.horizonMs);
  const closing = new Set(answer.items.filter((x) => BLOCKING.has(x.verdict.level)).map((x) => x.item.f.properties.id));
  return { option, on, beside, answer, blockers: on.filter((m) => closing.has(m.id)), avoiding };
}

/** The ids whose detail the verdict of these routes needs. */
function idsOn(options: readonly RouteOption[], features: readonly ItemFeature[]): string[] {
  const ids = new Set<string>();
  for (const o of options) for (const m of matchRoute(o.coords, features)) if (m.side === 'op') ids.add(m.id);
  return [...ids];
}

/** Same road, give or take a rounding: the router's alternative and our detour can coincide. */
export function sameRoute(a: RouteOption, b: RouteOption): boolean {
  return Math.abs(a.distanceM - b.distanceM) <= Math.max(50, a.distanceM * 0.005) && Math.abs(a.durationS - b.durationS) <= Math.max(30, a.durationS * 0.01);
}

/** Fastest first; the route to recommend is the fastest without a closure. */
export function rankRoutes(routes: readonly AssessedRoute[]): RoutePlan {
  const unique: AssessedRoute[] = [];
  for (const r of routes) {
    const twin = unique.findIndex((u) => sameRoute(u.option, r.option));
    if (twin === -1) unique.push(r);
    else if (r.blockers.length < (unique[twin]?.blockers.length ?? 0)) unique[twin] = r;
  }
  const sorted = [...unique].sort((a, b) => a.option.durationS - b.option.durationS);
  const clear = sorted.findIndex((r) => r.blockers.length === 0);
  return { routes: sorted, recommended: clear === -1 ? 0 : clear, noClearRoute: clear === -1 };
}

async function assessAll(options: readonly RouteOption[], q: PlanQuestion, deps: PlanDeps, avoiding: boolean): Promise<AssessedRoute[]> {
  const features = deps.items();
  const details = await deps.details(idsOn(options, features));
  return options.map((o) => assessRoute(o, features, details, q, avoiding));
}

/** Keeps asking for a route round the closures met so far, up to MAX_AVOID_ROUNDS times. */
async function planAround(first: AssessedRoute, q: PlanQuestion, deps: PlanDeps): Promise<AssessedRoute | null> {
  let avoid: LonLat[] = avoidPoints(first.option.coords, first.blockers);
  let best: AssessedRoute | null = null;
  for (let round = 0; round < MAX_AVOID_ROUNDS && avoid.length > 0; round++) {
    let options: RouteOption[];
    try {
      options = await deps.route({ from: q.from, to: q.to, mode: q.mode, avoid });
    } catch (err) {
      // No way round (the destination street itself is closed), or the router refused this extra
      // question: the routes already judged still stand, so keep what we have.
      if (err instanceof RoutingError) return best;
      throw err;
    }
    const option = options[0];
    if (!option) return best;
    const [assessed] = await assessAll([option], q, deps, true);
    if (!assessed) return best;
    best = assessed;
    if (assessed.blockers.length === 0) return assessed;
    avoid = [...avoid, ...avoidPoints(assessed.option.coords, assessed.blockers)].slice(0, MAX_AVOID_POINTS);
  }
  return best;
}

/** The whole route question. Throws RoutingError when not even a first route was found. */
export async function planRoutes(q: PlanQuestion, deps: PlanDeps): Promise<RoutePlan> {
  const options = await deps.route({ from: q.from, to: q.to, mode: q.mode, alternates: MAX_ALTERNATES });
  const assessed = await assessAll(options, q, deps, false);
  const fastest = [...assessed].sort((a, b) => a.option.durationS - b.option.durationS)[0];
  if (fastest && fastest.blockers.length > 0) {
    const around = await planAround(fastest, q, deps);
    if (around) assessed.push(around);
  }
  return rankRoutes(assessed);
}

export interface BesideNote {
  /** Items beside the route that matter for the vehicle at that time. */
  count: number;
  /** The titles of those that close the road ("A27 · Werkendam → Gorinchem"), worst first. */
  closures: string[];
}

/**
 * What lies beside the route (the other direction, a parallel road). It never decides the
 * verdict, but a closure there is named, not just counted: if the geometry put it on the wrong
 * side, the driver still reads which road it is.
 */
export function besideNote(route: AssessedRoute, features: readonly ItemFeature[], q: Pick<PlanQuestion, 'mode' | 'when' | 'now'>): BesideNote {
  const byId = new Map(features.map((f) => [f.properties.id, f]));
  const items = route.beside.flatMap((m) => {
    const f = byId.get(m.id);
    return f ? [{ f, d: null }] : [];
  });
  const sel = selectWhen(items, q.mode, tripWhen(q.when, route.option.durationS), q.now).items;
  const closures = sel.filter((x) => BLOCKING.has(x.verdict.level)).map((x) => x.item.f.properties.title);
  return { count: sel.length, closures: [...new Set(closures)] };
}
