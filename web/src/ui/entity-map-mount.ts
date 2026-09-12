/**
 * Mounts the small map of a generated entity page into `#entity-map`.
 *
 * The template ships a pre-rendered text fallback inside that container (a sentence plus a link
 * to the big map) so the page is useful without JavaScript; we take it out before MapLibre
 * renders and put it back when the map cannot be created (no WebGL2, basemap unreachable).
 *
 * MapLibre and the map modules are loaded with a dynamic import: they are by far the heaviest
 * part of the bundle and an SEO page must show its text and list even when that chunk fails.
 */
import { mapFeatures } from '../data/entity';
import { loadEntityGeometry } from '../data/entity-geometry';
import type { IndexItem } from '../data/index';
import site from '../../site.config.json';
import type { ItemFeature } from '../data/types';
import type { EntityMap, EntityView } from '../map/entity-map';
import { currentTheme, prefersReducedMotion } from './theme';

const FALLBACK_SELECTOR = '.entity-map__fallback';

export interface PageMapOptions {
  /** Extra query parameters for the deep link when a feature is clicked, e.g. `cat=file`. */
  linkQuery?: string;
}

/**
 * Returns the mounted map, or null when there is no container, no WebGL2 or the map chunk
 * could not be loaded. Never throws: a failing map must not break the rest of the page.
 */
export async function mountPageMap(
  items: readonly ItemFeature[],
  view: EntityView,
  opts: PageMapOptions = {},
): Promise<EntityMap | null> {
  const container = document.getElementById('entity-map');
  if (!container) return null;

  const fallback = container.querySelector<HTMLElement>(FALLBACK_SELECTOR);
  fallback?.remove();
  const restore = (): void => {
    if (fallback && !container.contains(fallback)) container.appendChild(fallback);
  };

  try {
    await import('maplibre-gl/dist/maplibre-gl.css');
    const { mountEntityMap } = await import('../map/entity-map');
    const map = await mountEntityMap(container, items, view, {
      theme: currentTheme(),
      attribution: site.attribution,
      reducedMotion: prefersReducedMotion(),
      onSelect: (id) => {
        const q = opts.linkQuery ? `&${opts.linkQuery}` : '';
        window.location.assign(`/?id=${encodeURIComponent(id)}${q}`);
      },
    });
    if (!map) restore();
    return map;
  } catch (err) {
    console.warn('[wegwerk] kaart niet geladen:', err instanceof Error ? err.message : String(err));
    restore();
    return null;
  }
}

export interface GeometryUpgradeOptions {
  /** Features the page already has real geometry for, e.g. live.geojson. Lookup only. */
  geometry?: readonly ItemFeature[];
  /** Features that are not index rows and must stay on the map, e.g. the bridge itself. */
  keep?: readonly ItemFeature[];
}

/**
 * Replaces the representative points of a mounted page map with the real geometry of the same
 * items, so the works appear as lines along the road instead of dots beside it. Deliberately
 * not awaited by the page: the map is already usable with the points and this only improves it.
 * Never throws.
 */
export async function upgradeMapGeometry(
  map: EntityMap | null,
  items: readonly IndexItem[],
  opts: GeometryUpgradeOptions = {},
): Promise<void> {
  if (!map || items.length === 0) return;
  try {
    const real = await loadEntityGeometry(items);
    if (real.length === 0) return;
    // `real` last: the collections carry the authoritative geometry for these ids.
    map.setItems([...(opts.keep ?? []), ...mapFeatures(items, [...(opts.geometry ?? []), ...real])]);
  } catch (err) {
    console.warn('[wegwerk] kaartgeometrie niet bijgewerkt:', err instanceof Error ? err.message : String(err));
  }
}
