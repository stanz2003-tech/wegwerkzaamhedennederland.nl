/**
 * Entity files (`EntityFile` in web/src/data/types.ts): every item of one road
 * or one gemeente with its geometry and full detail, so an entity page can
 * answer "kan ik op <datum> over de A2?" without the national collections.
 *
 * Road matching: both the registry entry (`static/wegen.json`) and the item's
 * road number are reduced with `normalizeVildRoad()`, which folds carriageway
 * variants ("A12 hrb", "A15 prb") and branch letters ("N282A") onto the base
 * road and normalises case and spaces. So an item on "A12 hrb" lands in
 * `roads/a12.json`, and in `roads/a12-hrb.json` too if the registry ever gets
 * such an entry; a registry entry that does not reduce ("s107A") matches only
 * items with exactly that normalised number.
 *
 * Gemeente matching: `slugify(item.gemeente) === slugify(gemeente.naam)`, the
 * same slugify as the page generator; the registry slug IS that value.
 */

import { normalizeVildRoad } from './roads.js';
import { slugify } from './slug.js';

/** @typedef {import('./item.js').Item} Item */
/** @typedef {{ road: string, slug: string }} RoadEntry */
/** @typedef {{ naam: string, slug: string }} GemeenteEntry */
/** @typedef {{ kind: 'road'|'gemeente', key: string, slug: string, items: Item[] }} EntityGroup */

/**
 * Matching key of a road number (lower case, so "s107A" and "s107a" meet);
 * undefined when it is empty.
 * @param {string | undefined} road
 */
export function roadKey(road) {
  const key = normalizeVildRoad(road) ?? (road ? slugify(road) : '');
  return key ? key.toLowerCase() : undefined;
}

/**
 * @param {Item[]} items            every published item, active and planned
 * @param {RoadEntry[]} roads       static/wegen.json
 * @param {GemeenteEntry[]} gemeenten  static/plaatsen.json
 * @returns {EntityGroup[]}         only entities with ≥ 1 item, road files first, sorted by slug
 */
export function groupEntities(items, roads, gemeenten) {
  /** @type {Map<string, Item[]>} */
  const byRoad = new Map();
  /** @type {Map<string, Item[]>} */
  const byGemeente = new Map();
  for (const item of items) {
    const road = roadKey(/** @type {string | undefined} */ (item.props.road));
    if (road) push(byRoad, road, item);
    const gemeente = item.props.gemeente ? slugify(String(item.props.gemeente)) : undefined;
    if (gemeente) push(byGemeente, gemeente, item);
  }

  /** @type {EntityGroup[]} */
  const groups = [];
  const seen = new Set();
  for (const r of roads) {
    const list = byRoad.get(roadKey(r.road) ?? '');
    if (!list || seen.has(`road/${r.slug}`)) continue;
    seen.add(`road/${r.slug}`);
    groups.push({ kind: 'road', key: r.road, slug: r.slug, items: sortEntityItems(list) });
  }
  for (const g of gemeenten) {
    const list = byGemeente.get(slugify(g.naam));
    if (!list || seen.has(`gemeente/${g.slug}`)) continue;
    seen.add(`gemeente/${g.slug}`);
    groups.push({ kind: 'gemeente', key: g.naam, slug: g.slug, items: sortEntityItems(list) });
  }
  return groups.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'road' ? -1 : 1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/**
 * Active first, then by start, then by id (deterministic output).
 * @param {Item[]} items
 */
export function sortEntityItems(items) {
  return [...items].sort((a, b) => {
    const activeA = a.state === 'active' ? 0 : 1;
    const activeB = b.state === 'active' ? 0 : 1;
    if (activeA !== activeB) return activeA - activeB;
    const startA = String(a.props.start);
    const startB = String(b.props.start);
    if (startA !== startB) return startA < startB ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** @param {string} kind @param {string} slug */
export function entityPath(kind, slug) {
  return kind === 'road' ? `roads/${slug}.json` : `gemeenten/${slug}.json`;
}

/**
 * @template T
 * @param {Map<string, T[]>} map @param {string} key @param {T} value
 */
function push(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
