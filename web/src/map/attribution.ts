/**
 * Attribution control handling.
 *
 * The licence line (`site.attribution`) must always be reachable, but it may never cover the
 * map. MapLibre's own logic (`AttributionControl._updateCompact`) adds *both*
 * `maplibregl-compact` and `maplibregl-compact-show` — i.e. compact **and expanded** — which on
 * a phone renders as a two-line strip on top of the map. There is no option for
 * "compact and collapsed", so we collapse it ourselves once the control exists.
 *
 * That is stable: `_updateCompact()` only re-adds `maplibregl-compact-show` while the container
 * does *not* yet have the `maplibregl-compact` class, so a later resize will not re-expand it.
 */
import type { Map as MlMap } from 'maplibre-gl';

export const ATTRIB_SELECTOR = '.maplibregl-ctrl-attrib';
const COMPACT = 'maplibregl-compact';
const COMPACT_SHOW = 'maplibregl-compact-show';
/** Dutch label for the ⓘ toggle (MapLibre's default is English). */
const TOGGLE_LABEL = 'Bronvermelding van de kaart';

/** MapLibre's attribution options for every map we create: compact on all viewports. */
export function attributionOptions(text: string): { compact: true; customAttribution: string } {
  return { compact: true, customAttribution: text };
}

function collapse(container: HTMLElement): void {
  const attrib = container.querySelector<HTMLElement>(ATTRIB_SELECTOR);
  if (!attrib) return;
  attrib.classList.add(COMPACT);
  attrib.classList.remove(COMPACT_SHOW);
  const button = attrib.querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button');
  if (button && button.getAttribute('title') !== TOGGLE_LABEL) {
    button.setAttribute('title', TOGGLE_LABEL);
    button.setAttribute('aria-label', TOGGLE_LABEL);
  }
}

/**
 * Keeps the attribution compact and collapsed. Called right after the map is created and again
 * on `resize`/`styledata`, the two events that make MapLibre rebuild or re-measure the control.
 */
export function keepAttributionCompact(map: MlMap): void {
  const container = map.getContainer();
  collapse(container);
  map.on('resize', () => collapse(container));
  map.on('styledata', () => collapse(container));
}
