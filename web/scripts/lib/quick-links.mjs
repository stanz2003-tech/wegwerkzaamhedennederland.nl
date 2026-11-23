/**
 * The short row of links right under the answer on road, place and gemeente pages.
 *
 * Measured on a phone (375 × 812), 23 Nov 2026: the first link to another text page stood 4,308 px
 * down /plaats/maarssen/ (5.3 screens) and 7,579 px down /weg/a28/ (9.3 screens): under the list,
 * the questions and the FAQ. Almost nobody gets there, so almost nobody went from one page to the
 * next. The blocks at the bottom ("In de buurt", "Langs de A28") stay as they are, complete; this
 * row repeats the few links a reader most likely wants next, where the reader is:
 *   - a place or gemeente: the roads through it (someone who looked up a street usually drives on
 *     over one of them), then the gemeente it lies in or its neighbours;
 *   - a road: the towns on it (the gemeenten whose largest kern has the longest stretch of it).
 * Short on purpose: at most two lines of chips on a phone, so the map and the list below it move
 * down as little as possible. The last link jumps to the full block.
 *
 * Pure: the callers (pages.mjs) pass links that already exist and are in Google.
 */

/** Road badges in the row: one line of them on a 375 px phone. */
export const MAX_QUICK_ROADS = 4;
/** Links in the row, the jump to the full block included: two lines on a phone. */
export const MAX_QUICK_LINKS = 6;
/** Gemeenten in the row of a road page. */
export const MAX_QUICK_GEMEENTEN = 4;

const roadLink = (r) => ({ name: r.road, href: r.href, cls: `badge badge--${r.badgeClass}` });
const placeLink = (g) => ({ name: g.name, href: g.href, cls: 'chip chip--gemeente' });
const moreLink = (name, href) => ({ name, href, cls: 'chip chip--more' });

/**
 * The row of a place or gemeente page. `roads`: `{ road, href, badgeClass }`, most important
 * first; `gemeenten`: `{ name, href }` (the own gemeente of a woonplaats, the neighbours of a
 * gemeente); `moreHref`: the block further down that holds everything, '' when the row already
 * shows all there is. Empty when there is nothing to link to.
 */
export function placeQuickLinks({ roads, gemeenten, moreHref }) {
  const roadLinks = roads.slice(0, MAX_QUICK_ROADS).map(roadLink);
  const room = MAX_QUICK_LINKS - roadLinks.length - (moreHref ? 1 : 0);
  const links = [...roadLinks, ...gemeenten.slice(0, Math.max(0, room)).map(placeLink)];
  if (links.length === 0) return [];
  return moreHref ? [...links, moreLink('Meer in de buurt', moreHref)] : links;
}

/** The row of a road page. `gemeenten`: `{ name, href }`, the most important first. */
export function roadQuickLinks({ gemeenten, moreHref }) {
  const links = gemeenten.slice(0, MAX_QUICK_GEMEENTEN).map(placeLink);
  if (links.length === 0) return [];
  return moreHref ? [...links, moreLink('Alle plaatsen langs de weg', moreHref)] : links;
}
