/**
 * The route of route mode on the map: the chosen route as a wide blue band UNDER the items (so a
 * red closure on it stays the loudest thing on the map), the other routes as thin grey lines, and
 * the start and destination as two dots on top. One GeoJSON source; the layers are re-added after
 * every style change by AppMap.installOverlay, like the item overlay.
 */
import type { GeoJSONSource, LayerSpecification, Map as MlMap } from 'maplibre-gl';
import type { LonLat } from '../data/route-match';
import { DETOUR_HEX } from '../ui/categories';
import { LAYERS } from './layers';
import type { BasemapTheme } from './restyle';

export const SRC_ROUTE = 'ww-route';

export const ROUTE_LAYERS = {
  alt: 'route-alt',
  casing: 'route-casing',
  line: 'route-line',
  stops: 'route-stops',
} as const;

export interface RouteDrawing {
  routes: { coords: readonly LonLat[]; selected: boolean }[];
  from: LonLat;
  to: LonLat;
}

const ALT_HEX: Record<BasemapTheme, string> = { light: '#7d838d', dark: '#9aa0aa' };
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** GeoJSON for the route source; the selected route last, so it draws over the others. */
export function routeCollection(d: RouteDrawing | null): GeoJSON.FeatureCollection {
  if (!d) return EMPTY;
  const lines = [...d.routes]
    .sort((a, b) => Number(a.selected) - Number(b.selected))
    .filter((r) => r.coords.length >= 2)
    .map<GeoJSON.Feature>((r) => ({
      type: 'Feature',
      properties: { kind: 'route', sel: r.selected ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: r.coords.map((c) => [c[0], c[1]]) },
    }));
  const stop = (c: LonLat, end: 'from' | 'to'): GeoJSON.Feature => ({ type: 'Feature', properties: { kind: 'stop', end }, geometry: { type: 'Point', coordinates: [c[0], c[1]] } });
  return { type: 'FeatureCollection', features: [...lines, stop(d.from, 'from'), stop(d.to, 'to')] };
}

const isRoute = (sel: 0 | 1): ['all', ['==', ['get', 'kind'], string], ['==', ['get', 'sel'], number]] => ['all', ['==', ['get', 'kind'], 'route'], ['==', ['get', 'sel'], sel]];

/** The three line layers (below the items) and the stop dots (on top). */
export function routeLayers(theme: BasemapTheme): { below: LayerSpecification[]; above: LayerSpecification[] } {
  const casing = theme === 'dark' ? '#15171b' : '#ffffff';
  const blue = DETOUR_HEX[theme];
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return {
    below: [
      { id: ROUTE_LAYERS.alt, type: 'line', source: SRC_ROUTE, filter: isRoute(0), layout: round, paint: { 'line-color': ALT_HEX[theme], 'line-width': 4, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] } },
      { id: ROUTE_LAYERS.casing, type: 'line', source: SRC_ROUTE, filter: isRoute(1), layout: round, paint: { 'line-color': casing, 'line-width': 11, 'line-opacity': 0.9 } },
      { id: ROUTE_LAYERS.line, type: 'line', source: SRC_ROUTE, filter: isRoute(1), layout: round, paint: { 'line-color': blue, 'line-width': 7, 'line-opacity': 0.55 } },
    ],
    above: [
      {
        id: ROUTE_LAYERS.stops,
        type: 'circle',
        source: SRC_ROUTE,
        filter: ['==', ['get', 'kind'], 'stop'],
        paint: {
          'circle-radius': 7,
          'circle-color': ['case', ['==', ['get', 'end'], 'to'], blue, casing],
          'circle-stroke-color': blue,
          'circle-stroke-width': 3,
        },
      },
    ],
  };
}

/** Adds the source and layers when missing. Idempotent; call after the item overlay is in place. */
export function ensureRouteOverlay(map: MlMap, theme: BasemapTheme): void {
  if (!map.getSource(SRC_ROUTE)) map.addSource(SRC_ROUTE, { type: 'geojson', data: EMPTY });
  const { below, above } = routeLayers(theme);
  const under = map.getLayer(LAYERS.selectedLine) ? LAYERS.selectedLine : undefined;
  for (const layer of below) if (!map.getLayer(layer.id)) map.addLayer(layer, under);
  for (const layer of above) if (!map.getLayer(layer.id)) map.addLayer(layer);
}

export function setRouteData(map: MlMap, d: RouteDrawing | null): void {
  const src = map.getSource<GeoJSONSource>(SRC_ROUTE);
  if (src) void src.setData(routeCollection(d));
}
