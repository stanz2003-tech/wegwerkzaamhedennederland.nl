/**
 * "Nu dicht op snelwegen: [A2] [A27] …" — at national zoom the map panel names the motorways on
 * which something is closed, instead of a count sentence ("In beeld: 2604 plekken dicht, …",
 * overzicht-5). Every badge links to that road's page; without a known page it is a button that
 * opens road mode with the answer for that road.
 *
 * Built from the answer the panel already computed for the view (same mode and moment), so a
 * road is named exactly when one of its relevant items there is "dicht" or "rijbaan". When no
 * motorway qualifies the block stays empty: silence here is no claim that the roads are open.
 */
import type { AnsweredItem } from '../data/forecast';
import { roadKey } from '../data/entity';
import { VERDICT_META, type VerdictLevel } from '../data/verdict';
import { roadBadge } from './badge';
import { closedMotorwaysLead } from './copy';
import { esc } from './format';

/** At most this many badges; more would be a list, and the list is right under it. */
export const MAX_CLOSED_ROADS = 8;
/** Below this zoom level the view is (most of) the country: name the motorways. */
export const NATIONAL_ZOOM = 9;

export interface ClosedRoad {
  /** Normalised road number ("A27"). */
  road: string;
  level: Extract<VerdictLevel, 'dicht' | 'rijbaan'>;
}

function isMotorway(x: AnsweredItem): boolean {
  const p = x.item.f.properties;
  if (p.roadType) return p.roadType === 'A';
  return (roadKey(p.road) ?? '').startsWith('A');
}

/** Motorways with a closure among `items`, "weg dicht" first, then by number. */
export function closedMotorways(items: readonly AnsweredItem[], max = MAX_CLOSED_ROADS): ClosedRoad[] {
  const worst = new Map<string, ClosedRoad['level']>();
  for (const x of items) {
    const level = x.verdict.level;
    if (level !== 'dicht' && level !== 'rijbaan') continue;
    if (!isMotorway(x)) continue;
    const road = roadKey(x.item.f.properties.road);
    if (!road) continue;
    if (worst.get(road) !== 'dicht') worst.set(road, level);
  }
  const num = (r: string): number => Number(r.slice(1)) || 0;
  return [...worst.entries()]
    .map(([road, level]) => ({ road, level }))
    .sort((a, b) => (a.level === b.level ? num(a.road) - num(b.road) : a.level === 'dicht' ? -1 : 1))
    .slice(0, max);
}

/**
 * Fills `el` with the lead and the badges, or hides it. Returns the sentence a screen reader
 * hears after a user action ("Nu dicht op snelwegen: A2, A27."), or null when hidden.
 * `hrefOf` gives a road's page (with the map's vehicle and moment): the badge is then a link
 * straight to it. Without a page (or before the manifest has arrived) the badge stays the button
 * that opens road mode on the map (main.ts).
 */
export function renderClosedRoads(
  el: HTMLElement,
  roads: readonly ClosedRoad[],
  whenLabel: string,
  more: boolean,
  hrefOf?: (road: string) => string | null,
): string | null {
  if (roads.length === 0) {
    el.hidden = true;
    el.innerHTML = '';
    return null;
  }
  const lead = closedMotorwaysLead(whenLabel);
  const buttons = roads
    .map((r) => {
      const verdict = `${r.road}: ${VERDICT_META[r.level].label.toLowerCase()}.`;
      const badge = roadBadge(r.road, 'A', { size: 'md' });
      const href = hrefOf?.(r.road) ?? null;
      if (href) {
        const name = `${verdict} Naar de pagina over de ${r.road}`;
        return `<li><a class="closed-roads__btn" href="${esc(href)}" data-level="${r.level}" aria-label="${esc(name)}" title="${esc(name)}">${badge}</a></li>`;
      }
      const name = `${verdict} Toon het antwoord voor de ${r.road}`;
      return `<li><button type="button" class="closed-roads__btn" data-road="${esc(r.road)}" data-level="${r.level}" aria-label="${esc(name)}" title="${esc(name)}">${badge}</button></li>`;
    })
    .join('');
  el.hidden = false;
  el.innerHTML = `<p class="closed-roads__lead" id="closed-roads-lead">${esc(lead)}</p><ul class="closed-roads__list" aria-labelledby="closed-roads-lead">${buttons}${more ? '<li class="closed-roads__more">en meer</li>' : ''}</ul>`;
  return `${lead} ${roads.map((r) => r.road).join(', ')}${more ? ' en meer' : ''}.`;
}
