/**
 * Which items the map page shows for the question in the URL, and in what order — the pure part
 * of main.ts `render()`, moved out so main.ts stays the wiring. Every filter is strict and shared:
 * whatever the list shows is exactly what the map shows.
 *
 * Order of the filters: 1. time (a moment, a picked date or a window), 2. road or place mode,
 * 3. free text, then (in `judge`) 4. vehicle relevance — the verdict decides.
 */
import { matchesRoad, orderAlongRoad } from '../data/entity';
import { matchesQuery, midpointOf, sortItems, type SortId } from '../data/filter';
import { liveAppliesAt } from '../data/forecast';
import { isActiveAt, matchesTimeWindow, overlapsWindow } from '../data/time';
import type { ItemFeature, ItemProperties } from '../data/types';
import type { UrlState } from '../data/url-state';
import { VERDICT_SEVERITY, verdictFor, type VehicleMode, type VerdictLevel } from '../data/verdict';
import { dayWindowOf } from './panel-answer';

/** The part of the URL state that says when. */
export type TimeQuestion = Pick<UrlState, 'time' | 'moment' | 'day' | 'part'>;

/** Whether the question reaches past now, so werk-gepland must be loaded to answer it. */
export function needsGepland(q: TimeQuestion, now: number): boolean {
  if (q.moment !== null) return q.moment > now;
  if (q.day !== null) return (dayWindowOf(q, now)?.to ?? now) > now;
  return q.time !== 'nu';
}

/**
 * Whether an item counts for the asked time. A picked date (`?dag=`) is a window: what touches it
 * counts, judged as selectInWindow does for an item without detail (overlap, plus the
 * live-snapshot rule) — so the list holds exactly the items the answer card weighed.
 */
export function inTime(p: ItemProperties, q: TimeQuestion, now: number): boolean {
  if (q.moment !== null) return isActiveAt(p, q.moment) && liveAppliesAt(p, q.moment, now);
  const day = dayWindowOf(q, now);
  if (day) return overlapsWindow(p, day.from, day.to) && liveAppliesAt(p, day.from, now);
  return matchesTimeWindow(p, q.time, now);
}

export interface Selection {
  /** In time, on the road or in the place, matching the text. */
  base: ItemFeature[];
  /** Every item of the road (all moments): the road answer picks the moment itself. */
  roadAll: ItemFeature[];
  /** Every item of the place (all moments), for the place answer. */
  placeAll: ItemFeature[];
}

/** Steps 1–3 for the question; `inPlace` is the place-mode matcher (ui/place-mode.ts), if any. */
export function selectForQuestion(
  items: readonly ItemFeature[],
  q: TimeQuestion & Pick<UrlState, 'road' | 'query'>,
  inPlace: ((p: ItemProperties) => boolean) | null,
  now: number,
): Selection {
  const road = q.road;
  let base = items.filter((f) => inTime(f.properties, q, now));
  if (road) base = base.filter((f) => matchesRoad(f.properties.road, road));
  if (inPlace) base = base.filter((f) => inPlace(f.properties));
  if (q.query) base = base.filter((f) => matchesQuery(f.properties, q.query));
  return {
    base,
    roadAll: road ? items.filter((f) => matchesRoad(f.properties.road, road)) : [...items],
    placeAll: inPlace ? items.filter((f) => inPlace(f.properties)) : [],
  };
}

export interface Judged {
  f: ItemFeature;
  level: VerdictLevel;
}

/**
 * Verdict level per feature for the current mode and moment (no detail loaded here). For a picked
 * date the window form is used, the one the answer card's selectInWindow uses, so the pills under
 * the card never read lighter than the card. (The Vandaag/Morgen/Weekend chips still judge the
 * pills at `at` = now while the card judges the window; reported, not changed here.)
 */
export function judge(features: readonly ItemFeature[], mode: VehicleMode, at: number, window?: { from: number; to: number } | null): Judged[] {
  return features.map((f) => ({ f, level: verdictFor(f.properties, mode, window ? { window } : { now: at }).level }));
}

/** The feature the map draws: the item plus its verdict level (`v`) for the paint expressions. */
export function withVerdict(j: Judged): ItemFeature {
  return { ...j.f, properties: { ...j.f.properties, v: j.level } as ItemFeature['properties'] };
}

/**
 * The list order. "Ernstigste eerst" answers the one question first: every "weg dicht" above every
 * "doorrijden mogelijk", whatever the DATEX severity says; within a level the impact score
 * decides — or, in road mode, the position along the road (overzicht-4).
 */
export function orderForList(inView: readonly Judged[], sort: SortId, center: [number, number] | null, now: number, road: string | null): ItemFeature[] {
  const ordered = sortItems(
    inView.map((j) => j.f),
    sort,
    center,
    now,
  );
  if (sort !== 'impact') return ordered;
  const levelOf = new Map(inView.map((j) => [j.f.properties.id, j.level]));
  const rank = (f: ItemFeature): number => {
    const level = levelOf.get(f.properties.id);
    return level ? VERDICT_SEVERITY.indexOf(level) : 9;
  };
  ordered.sort((a, b) => rank(a) - rank(b));
  if (!road) return ordered;
  const points = ordered.map((f) => {
    const mid = midpointOf(f.geometry) ?? [0, 0];
    return { id: f.properties.id, lon: mid[0], lat: mid[1], f };
  });
  return orderAlongRoad(points, (x) => levelOf.get(x.id) ?? 'nvt').map((x) => x.f);
}
