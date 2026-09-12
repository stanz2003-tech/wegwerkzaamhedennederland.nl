/**
 * `web/src/data/types.ts` (the shared data contract) uses the ambient `GeoJSON.*` namespace.
 * `@types/geojson` — a direct dependency of maplibre-gl, so always installed — publishes those
 * types as a module plus a UMD global, and a UMD global is not visible inside ES modules.
 * This file re-exposes the handful of shapes the contract needs as a real global namespace, so
 * the contract file compiles unchanged and stays the single source of truth.
 */
import type * as G from 'geojson';

declare global {
  namespace GeoJSON {
    type Position = G.Position;
    type Point = G.Point;
    type LineString = G.LineString;
    type MultiLineString = G.MultiLineString;
    type Polygon = G.Polygon;
    type Geometry = G.Geometry;
    type GeoJsonProperties = G.GeoJsonProperties;
    type Feature<Geom extends G.Geometry | null = G.Geometry, Props = G.GeoJsonProperties> = G.Feature<Geom, Props>;
    type FeatureCollection<
      Geom extends G.Geometry | null = G.Geometry,
      Props = G.GeoJsonProperties,
    > = G.FeatureCollection<Geom, Props>;
  }
}
