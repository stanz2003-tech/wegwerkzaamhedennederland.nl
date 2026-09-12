/**
 * Our overlay: two GeoJSON sources (lines, points) and the layer stack bottom → top:
 * selected-line · werk-casing · werk-line · afsluiting-dash · live-line · hit-lines ·
 * clusters · cluster-count · selected-point · points.
 * Feature ids come from `properties.id` (promoteId) so feature-state (hover/selected) works.
 */
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MlMap,
  SourceSpecification,
} from 'maplibre-gl';
import type { ItemCollection, ItemFeature } from '../data/types';
import { CATEGORIES } from '../data/types';
import { CATEGORY_HEX } from '../ui/categories';
import type { BasemapTheme } from './restyle';

export const SRC_LINES = 'ww-lines';
export const SRC_POINTS = 'ww-points';

export const LAYERS = {
  selectedLine: 'selected-line',
  casing: 'werk-casing',
  line: 'werk-line',
  dash: 'afsluiting-dash',
  live: 'live-line',
  hit: 'hit-lines',
  clusters: 'clusters',
  clusterCount: 'cluster-count',
  selectedPoint: 'selected-point',
  points: 'points',
} as const;

/** Layers that respond to hover/click, in query priority order. */
export const HIT_LAYERS: readonly string[] = [LAYERS.points, LAYERS.clusters, LAYERS.hit];

/**
 * Highest zoom at which points are clustered. MapLibre clusters every tile zoom `<=` this
 * value, so 8 gives clusters below zoom 9 and individual features from zoom 9 upwards.
 */
export const CLUSTER_MAX_ZOOM = 8;
export const HIT_LINE_WIDTH = 24;

export interface OverlayOptions {
  theme: BasemapTheme;
  labelFont: string[];
  beforeId?: string | undefined;
  cluster: boolean;
}

export interface SplitData {
  lines: ItemCollection;
  points: ItemCollection;
}

const EMPTY: ItemCollection = { type: 'FeatureCollection', features: [] };

export function emptyData(): SplitData {
  return { lines: EMPTY, points: EMPTY };
}

/** Splits features by geometry type; the GeoJSON `id` is set to the item id for feature-state. */
export function splitFeatures(items: readonly ItemFeature[]): SplitData {
  const lines: ItemFeature[] = [];
  const points: ItemFeature[] = [];
  for (const f of items) {
    const withId: ItemFeature = f.id === f.properties.id ? f : { ...f, id: f.properties.id };
    if (f.geometry.type === 'Point') points.push(withId);
    else lines.push(withId);
  }
  return {
    lines: { type: 'FeatureCollection', features: lines },
    points: { type: 'FeatureCollection', features: points },
  };
}

/* ------------------------------- expressions ------------------------------- */

const hover: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
const sev: ExpressionSpecification = ['coalesce', ['get', 'sev'], 1];

export function categoryColour(theme: BasemapTheme): ExpressionSpecification {
  const hex = CATEGORY_HEX[theme];
  const expr: unknown[] = ['match', ['get', 'cat']];
  for (const cat of CATEGORIES) expr.push(cat, hex[cat]);
  expr.push(hex.overig);
  return expr as ExpressionSpecification;
}

/**
 * A number or any non-zoom expression that can be folded into a zoom stop. Never pass a
 * zoom-dependent expression: MapLibre allows exactly one zoom curve per property value, and
 * that curve must be the outermost expression (see `style-check.ts`).
 */
export type Addend = number | ExpressionSpecification;

/**
 * Line width by zoom and severity: `scale * (base + k * sev) + extra`. Zoom stops are the
 * outer interpolate (MapLibre requires zoom at the top level).
 */
export function lineWidth(extra: Addend = 0, scale = 1): ExpressionSpecification {
  const stop = (base: number, k: number): ExpressionSpecification => ['+', ['*', scale, ['+', base, ['*', k, sev]]], extra];
  return ['interpolate', ['linear'], ['zoom'], 6, stop(1.4, 0.35), 10, stop(2.2, 0.6), 14, stop(3.6, 0.9), 17, stop(6, 1.4)];
}

/**
 * Circle radius by zoom and severity. `extra` may be an expression (e.g. a hover bump), which
 * is folded *into* every zoom stop — wrapping the whole `interpolate` in a `["case", …]` with
 * a second `interpolate` in each branch makes MapLibre reject the layer with
 * "Only one zoom-based step or interpolate subexpression may be used in an expression".
 */
export function pointRadius(extra: Addend = 0): ExpressionSpecification {
  const stop = (base: number): ExpressionSpecification => ['+', base, ['*', 0.6, sev], extra];
  return ['interpolate', ['linear'], ['zoom'], 6, stop(4), 10, stop(5.5), 14, stop(7.5), 17, stop(9)];
}

// Typed as expressions (not FilterSpecification): only expressions may be nested inside
// ["all", ...] — the legacy filter syntax in that union cannot hold them.
const isFile: ExpressionSpecification = ['==', ['get', 'cat'], 'file'];
const notFile: ExpressionSpecification = ['!=', ['get', 'cat'], 'file'];
const isClosed: ExpressionSpecification = ['any', ['==', ['get', 'cat'], 'afsluiting'], ['==', ['get', 'closed'], true]];
const isCluster: ExpressionSpecification = ['has', 'point_count'];
const notCluster: ExpressionSpecification = ['!', ['has', 'point_count']];

/* --------------------------------- sources --------------------------------- */

export function lineSourceSpec(data: ItemCollection): SourceSpecification {
  return { type: 'geojson', data, promoteId: 'id', lineMetrics: false, tolerance: 0.5 };
}

export function pointSourceSpec(data: ItemCollection, cluster: boolean): SourceSpecification {
  return cluster
    ? { type: 'geojson', data, promoteId: 'id', cluster: true, clusterMaxZoom: CLUSTER_MAX_ZOOM, clusterRadius: 44 }
    : { type: 'geojson', data, promoteId: 'id' };
}

/* ---------------------------------- layers ---------------------------------- */

const ACCENT = '#ffc917';

export function overlayLayers(opts: OverlayOptions): LayerSpecification[] {
  const dark = opts.theme === 'dark';
  const casing = dark ? '#15171b' : '#ffffff';
  const ink = '#1b1b1f';
  const colour = categoryColour(opts.theme);
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' } as const;

  const layers: LayerSpecification[] = [
    {
      id: LAYERS.selectedLine,
      type: 'line',
      source: SRC_LINES,
      layout: roundLine,
      paint: {
        'line-color': ACCENT,
        'line-width': lineWidth(9),
        'line-opacity': ['case', selected, 0.75, 0],
        'line-blur': 0.5,
      },
    },
    {
      id: LAYERS.casing,
      type: 'line',
      source: SRC_LINES,
      layout: roundLine,
      paint: {
        'line-color': ['case', hover, ACCENT, casing],
        'line-width': lineWidth(3),
        'line-opacity': 0.95,
      },
    },
    {
      id: LAYERS.line,
      type: 'line',
      source: SRC_LINES,
      filter: notFile,
      layout: roundLine,
      paint: {
        'line-color': colour,
        'line-width': lineWidth(),
        'line-opacity': ['case', hover, 1, 0.92],
      },
    },
    {
      id: LAYERS.dash,
      type: 'line',
      source: SRC_LINES,
      filter: ['all', notFile, isClosed],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': lineWidth(0, 0.42),
        'line-dasharray': [1.6, 2.2],
        'line-opacity': 0.95,
      },
    },
    {
      id: LAYERS.live,
      type: 'line',
      source: SRC_LINES,
      filter: isFile,
      layout: roundLine,
      paint: {
        'line-color': ['match', ['get', 'sub'], 'stationaryTraffic', dark ? '#e0303c' : '#7a0b1a', colour],
        'line-width': lineWidth(2.5, 1.1),
        'line-opacity': ['case', hover, 1, 0.95],
      },
    },
    {
      id: LAYERS.hit,
      type: 'line',
      source: SRC_LINES,
      layout: roundLine,
      paint: { 'line-color': '#000000', 'line-width': HIT_LINE_WIDTH, 'line-opacity': 0 },
    },
  ];

  if (opts.cluster) {
    layers.push(
      {
        id: LAYERS.clusters,
        type: 'circle',
        source: SRC_POINTS,
        filter: isCluster,
        paint: {
          'circle-color': ACCENT,
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 23, 200, 29],
          'circle-stroke-width': 2,
          'circle-stroke-color': ink,
          'circle-opacity': 0.96,
        },
      },
      {
        id: LAYERS.clusterCount,
        type: 'symbol',
        source: SRC_POINTS,
        filter: isCluster,
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': opts.labelFont,
          'text-size': 12,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': ink },
      },
    );
  }

  layers.push(
    {
      id: LAYERS.selectedPoint,
      type: 'circle',
      source: SRC_POINTS,
      filter: notCluster,
      paint: {
        'circle-color': ACCENT,
        'circle-radius': pointRadius(7),
        'circle-opacity': ['case', selected, 0.75, 0],
        'circle-blur': 0.15,
      },
    },
    {
      id: LAYERS.points,
      type: 'circle',
      source: SRC_POINTS,
      filter: notCluster,
      paint: {
        'circle-color': colour,
        // The hover bump lives inside the zoom stops: one zoom curve per property.
        'circle-radius': pointRadius(['case', hover, 1.5, 0]),
        'circle-stroke-width': 2,
        'circle-stroke-color': ['case', hover, ACCENT, casing],
        'circle-opacity': 0.96,
      },
    },
  );
  return layers;
}

/** Adds sources (if missing) and layers (if missing). Idempotent; call after every `style.load`. */
export function ensureOverlay(map: MlMap, data: SplitData, opts: OverlayOptions): void {
  if (!map.getSource(SRC_LINES)) map.addSource(SRC_LINES, lineSourceSpec(data.lines));
  if (!map.getSource(SRC_POINTS)) map.addSource(SRC_POINTS, pointSourceSpec(data.points, opts.cluster));
  const before = opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;
  for (const layer of overlayLayers(opts)) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  }
}

/** Pushes new data into both sources (no-op when the sources are not there yet). */
export function setOverlayData(map: MlMap, data: SplitData): void {
  const lines = map.getSource<GeoJSONSource>(SRC_LINES);
  const points = map.getSource<GeoJSONSource>(SRC_POINTS);
  if (lines) void lines.setData(data.lines);
  if (points) void points.setData(data.points);
}
