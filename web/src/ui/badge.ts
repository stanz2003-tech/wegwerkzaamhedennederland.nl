/**
 * Road badge as on Dutch signs: A = red/white, N = yellow/black, E = green/white,
 * S (city route) and local roads = slate.
 *
 * Items without a road number (two thirds of the data set — every street-level measure) get a
 * neutral glyph badge. They used to show the first letter of the place name ("H" next to
 * "… · Harlingen"), which looks like a rendering bug and means nothing on a sign.
 */
import type { RoadType } from '../data/types';
import { esc } from './format';
import { ICONS } from './icons';

export type BadgeKind = 'a' | 'n' | 'e' | 's' | 'lokaal';

export function badgeKind(road: string | null | undefined, roadType?: RoadType | null): BadgeKind {
  if (roadType === 'A') return 'a';
  if (roadType === 'N') return 'n';
  if (roadType === 'E') return 'e';
  if (roadType === 'S') return 's';
  if (roadType === 'lokaal') return 'lokaal';
  const first = (road ?? '').trim().charAt(0).toUpperCase();
  if (first === 'A') return 'a';
  if (first === 'N') return 'n';
  if (first === 'E') return 'e';
  if (first === 'S') return 's';
  return 'lokaal';
}

/** Badge text: the road number as printed on signs, or "" when the item has no road number. */
export function badgeText(road: string | null | undefined): string {
  const r = (road ?? '').trim();
  return r.length > 6 ? r.slice(0, 6) : r;
}

/** Accessible name of the badge (it is the only content of the badge, so it needs one). */
export function badgeLabel(road: string | null | undefined, place?: string | null): string {
  const r = badgeText(road);
  if (r) return `Weg ${r}`;
  return place ? `Lokale weg in ${place}` : 'Lokale weg';
}

export interface BadgeOptions {
  size?: 'sm' | 'md' | 'xl';
  place?: string | null;
}

export function roadBadge(road: string | null | undefined, roadType: RoadType | null | undefined, opts: BadgeOptions = {}): string {
  const kind = badgeKind(road, roadType);
  const size = opts.size ?? 'md';
  const text = badgeText(road);
  const label = badgeLabel(road, opts.place);
  const classes = `badge badge--${kind} badge--${size}${text ? '' : ' badge--glyph'}`;
  return `<span class="${classes}" role="img" aria-label="${esc(label)}">${text ? esc(text) : ICONS.route}</span>`;
}
