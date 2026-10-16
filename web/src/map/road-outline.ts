/**
 * The chosen road of road mode as a soft band on the map, UNDER everything else of ours: in road
 * mode the map only drew the stretches with a measure, so a reader could not see which road the
 * answer was about (review 2026-10-16). The band shows the road's whole course (from the NWB,
 * public/road-lines/<slug>.json); the verdict colours stay on top and stay the loudest thing.
 * One GeoJSON source, re-added after every style change by AppMap.installOverlay.
 */
import type { GeoJSONSource, LayerSpecification, Map as MlMap } from 'maplibre-gl';
import { LAYERS } from './layers';
import type { BasemapTheme } from './restyle';
import { ROUTE_LAYERS } from './route-layers';

export const SRC_ROAD_OUTLINE = 'ww-road-outline';
export const ROAD_OUTLINE_LAYER = 'road-outline';

export type RoadLines = readonly (readonly (readonly [number, number])[])[];

/** A tint that is no verdict colour and reads on both basemaps. */
const OUTLINE_HEX: Record<BasemapTheme, string> = { light: '#36506e', dark: '#c3d2e6' };
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function roadOutlineCollection(lines: RoadLines | null): GeoJSON.FeatureCollection {
  if (!lines || lines.length === 0) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines.map((l) => l.map((c) => [c[0], c[1]])) } }],
  };
}

export function roadOutlineLayer(theme: BasemapTheme): LayerSpecification {
  return {
    id: ROAD_OUTLINE_LAYER,
    type: 'line',
    source: SRC_ROAD_OUTLINE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': OUTLINE_HEX[theme],
      'line-opacity': theme === 'dark' ? 0.3 : 0.24,
      'line-blur': 1,
      // Wide enough to find the road at national zoom, never wider than the closures on top.
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 5, 10, 8, 14, 14],
    },
  };
}

/** Adds the source and the layer below the routes and the items. Idempotent. */
export function ensureRoadOutline(map: MlMap, theme: BasemapTheme): void {
  if (!map.getSource(SRC_ROAD_OUTLINE)) map.addSource(SRC_ROAD_OUTLINE, { type: 'geojson', data: EMPTY });
  if (map.getLayer(ROAD_OUTLINE_LAYER)) return;
  const under = [ROUTE_LAYERS.alt, LAYERS.selectedLine].find((id) => map.getLayer(id));
  map.addLayer(roadOutlineLayer(theme), under);
}

export function setRoadOutlineData(map: MlMap, lines: RoadLines | null): void {
  const src = map.getSource<GeoJSONSource>(SRC_ROAD_OUTLINE);
  if (src) void src.setData(roadOutlineCollection(lines));
}
