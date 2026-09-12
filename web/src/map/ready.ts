/**
 * The one supported way to reach a MapLibre instance from outside these modules.
 *
 * Two channels, because a caller can arrive either before or after the map exists:
 *   - the `wegwerk:mapready` event, dispatched on the map container (it bubbles, so a listener
 *     on `document` sees it too) for code that is already running;
 *   - the `wegwerkMap` property on that same container, for code that arrives later — the map
 *     is created inside a dynamic import, so anything outside the bundle is usually too late
 *     for the event.
 *
 * Nothing in the app depends on either: they exist so a page script can add something to a map
 * it did not create, and so an automated check can assert on the rendered layers and the source
 * feature counts (`map.getStyle().layers`, `map.querySourceFeatures('ww-lines')`) rather than on
 * screenshots — the MapLibre canvas does not always composite in a headless capture.
 */
import type { Map as MlMap } from 'maplibre-gl';

export const MAP_READY_EVENT = 'wegwerk:mapready';

export interface MapReadyDetail {
  map: MlMap;
}

/** A map container that has a map. */
export interface MapHost extends HTMLElement {
  wegwerkMap?: MlMap;
}

export function announceMap(container: HTMLElement, map: MlMap): void {
  (container as MapHost).wegwerkMap = map;
  container.dispatchEvent(new CustomEvent<MapReadyDetail>(MAP_READY_EVENT, { detail: { map }, bubbles: true }));
}

/** The map of a container, when one was mounted into it. */
export function mapOf(container: HTMLElement | null): MlMap | undefined {
  return (container as MapHost | null)?.wegwerkMap;
}
