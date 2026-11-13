/**
 * Our overlay: three GeoJSON sources (lines, points, detour) and the layer stack bottom → top:
 * selected-line · werk-casing · werk-line · afsluiting-dash · werk-arrows · live-line · hit-lines ·
 * detour-casing · detour-line · detour-label · clusters · cluster-count · selected-point · points.
 *
 * Lines and points are coloured by the VERDICT for the chosen vehicle mode (property `v`, set by
 * the app on every feature it hands to the map), not by category: red = dicht/rijbaan (white
 * dash for `dicht`), amber = doorrijden met hinder, green = geen hinder, grey = onbekend, faded
 * = geldt niet voor jou (`nvt`). Files keep their own live colour; incidents keep theirs as points.
 * A line that is closed in ONE direction (`rijbaan`) carries arrows in that direction and is drawn
 * a few pixels to the right of its course, the side that direction drives on: at the zoom of a
 * phone the two carriageways of a motorway lie on top of each other, and an orange line alone could
 * not say which way is shut. The feed draws its lines in the direction of travel (measured
 * 2026-11-13 on 46 pairs of opposite closures: 44 run in opposite order, and where the carriageways
 * lie apart the other one is on the left in 11 of 12).
 * Clusters (national zoom) take the colour of the worst verdict inside them (`worst`, a cluster
 * property), so the country view shows where it is closed, not just how many items lie there.
 * Feature ids come from `properties.id` (promoteId) so feature-state (hover/selected) works.
 */
import type {
  ExpressionSpecification,
  GeoJSONFeatureDiff,
  GeoJSONSource,
  GeoJSONSourceDiff,
  LayerSpecification,
  Map as MlMap,
  SourceSpecification,
} from 'maplibre-gl';
import type { ItemCollection, ItemFeature } from '../data/types';
import { CATEGORY_HEX, CLUSTER_HEX, DETOUR_HEX, VERDICT_HEX } from '../ui/categories';
import type { BasemapTheme } from './restyle';

export const SRC_LINES = 'ww-lines';
export const SRC_POINTS = 'ww-points';
export const SRC_DETOUR = 'ww-detour';

export const LAYERS = {
  selectedLine: 'selected-line',
  casing: 'werk-casing',
  line: 'werk-line',
  dash: 'afsluiting-dash',
  arrows: 'werk-arrows',
  live: 'live-line',
  hit: 'hit-lines',
  detourCasing: 'detour-casing',
  detour: 'detour-line',
  detourLabel: 'detour-label',
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
/** Opacity of items that do not apply to the chosen vehicle mode. */
export const NVT_OPACITY = 0.25;

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
const EMPTY_DETOUR: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

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

/** GeoJSON for the detour source: one LineString, or empty. */
export function detourCollection(coords: readonly [number, number][] | null): GeoJSON.FeatureCollection {
  if (!coords || coords.length < 2) return EMPTY_DETOUR;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { kind: 'detour' }, geometry: { type: 'LineString', coordinates: coords.map((c) => [c[0], c[1]]) } }],
  };
}

/* ------------------------------- expressions ------------------------------- */

const hover: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
const sev: ExpressionSpecification = ['coalesce', ['get', 'sev'], 1];
/** Verdict level written by the app (data/verdict.ts); `onbekend` when absent (v2 data). */
const verdict: ExpressionSpecification = ['coalesce', ['get', 'v'], 'onbekend'];
const isNvt: ExpressionSpecification = ['==', verdict, 'nvt'];
const isDichtV: ExpressionSpecification = ['==', verdict, 'dicht'];
const isRijbaanV: ExpressionSpecification = ['==', verdict, 'rijbaan'];

/** Name of the arrow image on the map (`arrowImage()`, added by `ensureOverlay`). */
export const ARROW_IMAGE = 'ww-arrow';
/** The arrow is drawn at twice its shown size, for sharp edges on a phone screen. */
export const ARROW_PIXEL_RATIO = 2;
/** Screen pixels between two arrows along a line. */
export const ARROW_SPACING = 42;

/** How far a one-direction closure sits to the right of its course, in pixels, per zoom. */
const SIDE_OFFSET_STOPS: readonly (readonly [zoom: number, px: number])[] = [
  [7, 1.5],
  [11, 3],
  // From here the feed's own line lies on its carriageway: no shift, or it would leave the road.
  [15, 0],
];

/**
 * `line-offset` for the item lines: a one-direction closure moves to the right of its direction of
 * travel, every other line stays where it is. One zoom curve, outermost (style-check.ts).
 */
export const sideOffset: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  ...SIDE_OFFSET_STOPS.flatMap(([zoom, px]) => [zoom, ['case', isRijbaanV, px, 0] as ExpressionSpecification]),
] as ExpressionSpecification;

/** The same shift for the arrows (`icon-offset` is [along, across]; across is to the right). */
const arrowOffset: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  ...SIDE_OFFSET_STOPS.flatMap(([zoom, px]) => [zoom, ['literal', [0, px]] as ExpressionSpecification]),
] as ExpressionSpecification;

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * The direction arrow: a white dart pointing right (the direction of the line), with a dark rim so
 * it also reads where it sticks out over a light map. Drawn by hand into pixels: no canvas, so the
 * same function runs in the tests, and no font that a basemap may or may not carry.
 */
export function arrowImage(size = 36): RgbaImage {
  const unit = size / 36;
  const dart: readonly (readonly [number, number])[] = [
    [8, 6],
    [29, 18],
    [8, 30],
    [14, 18],
  ].map(([x, y]) => [(x as number) * unit, (y as number) * unit] as const);
  const rim = 2.4 * unit;
  const inside = (x: number, y: number): boolean => {
    let hit = false;
    for (let i = 0, j = dart.length - 1; i < dart.length; j = i++) {
      const [xi, yi] = dart[i] as readonly [number, number];
      const [xj, yj] = dart[j] as readonly [number, number];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const distance = (x: number, y: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0, j = dart.length - 1; i < dart.length; j = i++) {
      const [ax, ay] = dart[j] as readonly [number, number];
      const [bx, by] = dart[i] as readonly [number, number];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  };
  const SAMPLES = 3;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let fill = 0;
      let edge = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          if (inside(x, y)) fill += 1;
          else if (distance(x, y) <= rim) edge += 1;
        }
      }
      const total = SAMPLES * SAMPLES;
      const white = fill / total;
      const dark = edge / total;
      const alpha = Math.min(1, white + dark * 0.85);
      if (alpha === 0) continue;
      // White over the dark rim colour (#15171b), weighted by how much of the pixel each covers.
      const mix = white / (white + dark);
      const o = (py * size + px) * 4;
      data[o] = Math.round(0x15 + (255 - 0x15) * mix);
      data[o + 1] = Math.round(0x17 + (255 - 0x17) * mix);
      data[o + 2] = Math.round(0x1b + (255 - 0x1b) * mix);
      data[o + 3] = Math.round(alpha * 255);
    }
  }
  return { width: size, height: size, data };
}

export function categoryColour(theme: BasemapTheme): ExpressionSpecification {
  const hex = CATEGORY_HEX[theme];
  const expr: unknown[] = ['match', ['get', 'cat']];
  for (const cat of ['werk', 'afsluiting', 'file', 'incident', 'brug', 'evenement', 'overig'] as const) expr.push(cat, hex[cat]);
  expr.push(hex.overig);
  return expr as ExpressionSpecification;
}

/** Colour by verdict: the map answers "kan ik erdoor?" in one glance. */
export function verdictColour(theme: BasemapTheme): ExpressionSpecification {
  const v = VERDICT_HEX[theme];
  return ['match', verdict, 'dicht', v.dicht, 'rijbaan', v.rijbaan, 'hinder', v.hinder, 'geen', v.geen, 'nvt', v.nvt, v.onbekend];
}

/** Points: files and incidents keep their live category colour, everything else the verdict. */
export function pointColour(theme: BasemapTheme): ExpressionSpecification {
  const hex = CATEGORY_HEX[theme];
  return ['case', ['==', ['get', 'cat'], 'incident'], hex.incident, ['==', ['get', 'cat'], 'file'], hex.file, verdictColour(theme)];
}

/** Width factor by verdict: closures thick, hindrance normal, the rest thin. */
export const verdictScale: ExpressionSpecification = ['match', verdict, 'dicht', 1.35, 'rijbaan', 1.35, 'hinder', 1, 'geen', 0.65, 'nvt', 0.55, 0.8];

/**
 * A number or any non-zoom expression that can be folded into a zoom stop. Never pass a
 * zoom-dependent expression: MapLibre allows exactly one zoom curve per property value, and
 * that curve must be the outermost expression (see `style-check.ts`).
 */
export type Addend = number | ExpressionSpecification;

/**
 * Line width by zoom and severity: `scale * (base + k * sev) + extra`. Zoom stops are the
 * outer interpolate (MapLibre requires zoom at the top level); `scale` may be an expression.
 */
export function lineWidth(extra: Addend = 0, scale: Addend = 1): ExpressionSpecification {
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
const isCluster: ExpressionSpecification = ['has', 'point_count'];
const notCluster: ExpressionSpecification = ['!', ['has', 'point_count']];

/* --------------------------------- clusters --------------------------------- */

/**
 * Rank per verdict for the cluster aggregate: higher = worse, in VERDICT_SEVERITY order
 * (data/verdict.ts). A missing or unknown `v` counts as `onbekend` (3), never lighter — a
 * cluster must not turn green because one of its items had no verdict.
 */
export const CLUSTER_RANK = { dicht: 6, rijbaan: 5, hinder: 4, onbekend: 3, geen: 2, nvt: 1 } as const;
export const CLUSTER_RANK_UNKNOWN = CLUSTER_RANK.onbekend;

/** Per-feature map expression of the `worst` cluster property: the rank of the item's verdict. */
export const clusterRankExpr: ExpressionSpecification = [
  'match',
  ['get', 'v'],
  'dicht',
  CLUSTER_RANK.dicht,
  'rijbaan',
  CLUSTER_RANK.rijbaan,
  'hinder',
  CLUSTER_RANK.hinder,
  'onbekend',
  CLUSTER_RANK.onbekend,
  'geen',
  CLUSTER_RANK.geen,
  'nvt',
  CLUSTER_RANK.nvt,
  CLUSTER_RANK_UNKNOWN,
];

/** MapLibre `clusterProperties`: `worst` = the highest rank among the clustered points. */
export const CLUSTER_PROPERTIES: Record<string, [unknown, unknown]> = { worst: ['max', clusterRankExpr] };

const worstRank: ExpressionSpecification = ['coalesce', ['get', 'worst'], CLUSTER_RANK_UNKNOWN];

/** Cluster fill or count colour by `worst` (CLUSTER_HEX: every text/fill pair ≥ 4.5:1). */
export function clusterPaint(theme: BasemapTheme, part: 'fill' | 'text'): ExpressionSpecification {
  const hex = CLUSTER_HEX[theme];
  const expr: unknown[] = ['match', worstRank];
  for (const level of ['dicht', 'rijbaan', 'hinder', 'onbekend', 'geen', 'nvt'] as const) expr.push(CLUSTER_RANK[level], hex[level][part]);
  expr.push(hex.onbekend[part]);
  return expr as ExpressionSpecification;
}

/* --------------------------------- sources --------------------------------- */

export function lineSourceSpec(data: ItemCollection): SourceSpecification {
  return { type: 'geojson', data, promoteId: 'id', lineMetrics: false, tolerance: 0.5 };
}

export function pointSourceSpec(data: ItemCollection, cluster: boolean): SourceSpecification {
  return cluster
    ? {
        type: 'geojson',
        data,
        promoteId: 'id',
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 44,
        clusterProperties: CLUSTER_PROPERTIES,
      }
    : { type: 'geojson', data, promoteId: 'id' };
}

export function detourSourceSpec(data: GeoJSON.FeatureCollection): SourceSpecification {
  return { type: 'geojson', data };
}

/* ---------------------------------- layers ---------------------------------- */

const ACCENT = '#ffc917';

export function overlayLayers(opts: OverlayOptions): LayerSpecification[] {
  const dark = opts.theme === 'dark';
  const casing = dark ? '#15171b' : '#ffffff';
  const colour = verdictColour(opts.theme);
  const catColour = categoryColour(opts.theme);
  const detour = DETOUR_HEX[opts.theme];
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
        'line-offset': sideOffset,
      },
    },
    {
      id: LAYERS.casing,
      type: 'line',
      source: SRC_LINES,
      layout: roundLine,
      paint: {
        'line-color': ['case', hover, ACCENT, casing],
        'line-width': lineWidth(3, verdictScale),
        'line-opacity': ['case', isNvt, NVT_OPACITY, 0.95],
        'line-offset': sideOffset,
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
        'line-width': lineWidth(0, verdictScale),
        'line-opacity': ['case', hover, 1, isNvt, NVT_OPACITY, 0.92],
        'line-offset': sideOffset,
      },
    },
    {
      id: LAYERS.dash,
      type: 'line',
      source: SRC_LINES,
      filter: ['all', notFile, isDichtV],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': lineWidth(0, ['*', 0.42, verdictScale]),
        'line-dasharray': [1.6, 2.2],
        'line-opacity': ['case', isNvt, NVT_OPACITY, 0.95],
      },
    },
    {
      // Which way is shut: arrows along a one-direction closure, pointing the way the line runs.
      id: LAYERS.arrows,
      type: 'symbol',
      source: SRC_LINES,
      filter: ['all', notFile, isRijbaanV],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': ARROW_SPACING,
        'icon-image': ARROW_IMAGE,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.62, 11, 0.74, 15, 0.95],
        'icon-offset': arrowOffset,
        'icon-rotation-alignment': 'map',
        // Every arrow counts: a neighbour's label must not make one disappear, and a short line
        // (a few hundred metres on a phone) still gets its arrow.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-padding': 0,
      },
    },
    {
      id: LAYERS.live,
      type: 'line',
      source: SRC_LINES,
      filter: isFile,
      layout: roundLine,
      paint: {
        'line-color': ['match', ['get', 'sub'], 'stationaryTraffic', dark ? '#e0303c' : '#7a0b1a', catColour],
        'line-width': lineWidth(2.5, 1.1),
        'line-opacity': ['case', hover, 1, isNvt, NVT_OPACITY, 0.95],
      },
    },
    {
      id: LAYERS.hit,
      type: 'line',
      source: SRC_LINES,
      layout: roundLine,
      paint: { 'line-color': '#000000', 'line-width': HIT_LINE_WIDTH, 'line-opacity': 0, 'line-offset': sideOffset },
    },
    {
      id: LAYERS.detourCasing,
      type: 'line',
      source: SRC_DETOUR,
      layout: roundLine,
      paint: { 'line-color': casing, 'line-width': 7, 'line-opacity': 0.9 },
    },
    {
      id: LAYERS.detour,
      type: 'line',
      source: SRC_DETOUR,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': detour, 'line-width': 4, 'line-dasharray': [2, 1.6], 'line-opacity': 0.95 },
    },
    {
      id: LAYERS.detourLabel,
      type: 'symbol',
      source: SRC_DETOUR,
      layout: {
        'symbol-placement': 'line',
        'text-field': 'Omleiding',
        'text-font': opts.labelFont,
        'text-size': 12,
        'text-letter-spacing': 0.05,
        'text-keep-upright': true,
        'symbol-spacing': 300,
      },
      paint: { 'text-color': detour, 'text-halo-color': casing, 'text-halo-width': 1.5 },
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
          'circle-color': clusterPaint(opts.theme, 'fill'),
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 23, 200, 29],
          'circle-stroke-width': 2,
          'circle-stroke-color': casing,
          'circle-opacity': 1,
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
        paint: { 'text-color': clusterPaint(opts.theme, 'text') },
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
        'circle-color': pointColour(opts.theme),
        // The hover bump and the nvt shrink live inside the zoom stops: one zoom curve per property.
        'circle-radius': pointRadius(['case', hover, 1.5, isNvt, -1.5, 0]),
        'circle-stroke-width': 2,
        'circle-stroke-color': ['case', hover, ACCENT, casing],
        'circle-opacity': ['case', isNvt, NVT_OPACITY, 0.96],
        'circle-stroke-opacity': ['case', isNvt, NVT_OPACITY, 1],
      },
    },
  );
  return layers;
}

/** Adds sources (if missing) and layers (if missing). Idempotent; call after every `style.load`. */
export function ensureOverlay(map: MlMap, data: SplitData, opts: OverlayOptions): void {
  if (!map.getSource(SRC_LINES)) map.addSource(SRC_LINES, lineSourceSpec(data.lines));
  if (!map.getSource(SRC_POINTS)) map.addSource(SRC_POINTS, pointSourceSpec(data.points, opts.cluster));
  if (!map.getSource(SRC_DETOUR)) map.addSource(SRC_DETOUR, detourSourceSpec(EMPTY_DETOUR));
  // A new style drops its images, so this runs after every `style.load`, before the layer that uses it.
  if (!map.hasImage(ARROW_IMAGE)) map.addImage(ARROW_IMAGE, arrowImage(), { pixelRatio: ARROW_PIXEL_RATIO });
  const before = opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;
  for (const layer of overlayLayers(opts)) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  }
}

/** Pushes new data into both item sources (no-op when the sources are not there yet). */
export function setOverlayData(map: MlMap, data: SplitData): void {
  const lines = map.getSource<GeoJSONSource>(SRC_LINES);
  const points = map.getSource<GeoJSONSource>(SRC_POINTS);
  if (lines) void lines.setData(data.lines);
  if (points) void points.setData(data.points);
}

/**
 * Moves both item sources from `prev` (what they hold) to `next`, sending only what changed.
 * `setData` copies every coordinate of every item to the map's worker on the main thread: most of
 * a tap on a time chip or vehicle button (INP), while such a tap mostly changes a verdict (`v`)
 * and shows or hides some items. Falls back to `setData` when a diff cannot be made.
 */
export function updateOverlayData(map: MlMap, prev: SplitData, next: SplitData): void {
  for (const [id, key] of [[SRC_LINES, 'lines'], [SRC_POINTS, 'points']] as const) {
    const src = map.getSource<GeoJSONSource>(id);
    if (!src) continue;
    const diff = featureDiff(prev[key], next[key]);
    if (diff === null) void src.setData(next[key]);
    else if (diff !== EMPTY_DIFF) void src.updateData(diff);
  }
}

const EMPTY_DIFF: GeoJSONSourceDiff = {};

function byId(c: ItemCollection): Map<string, ItemFeature> | null {
  const out = new Map<string, ItemFeature>();
  for (const f of c.features) {
    if (out.has(f.properties.id)) return null;
    out.set(f.properties.id, f);
  }
  return out;
}

/**
 * What turns `prev` into `next`: ids that left, items that came (or whose geometry is another
 * object: a refresh, sent whole), and per item the properties that changed. `null` when the ids
 * are not unique (MapLibre then refuses a diff) or when most items come anew; `EMPTY_DIFF`
 * when nothing changed. Applied in MapLibre's order (remove, add, update) it gives exactly `next`.
 */
export function featureDiff(prev: ItemCollection, next: ItemCollection): GeoJSONSourceDiff | null {
  const before = byId(prev);
  const after = byId(next);
  if (!before || !after) return null;
  const remove = [...before.keys()].filter((id) => !after.has(id));
  const add: ItemFeature[] = [];
  const update: GeoJSONFeatureDiff[] = [];
  for (const [id, f] of after) {
    const old = before.get(id);
    if (!old || old.geometry !== f.geometry) {
      add.push(f);
      continue;
    }
    const was = old.properties as unknown as Record<string, unknown>;
    const now = f.properties as unknown as Record<string, unknown>;
    const removeProperties = Object.keys(was).filter((k) => !(k in now));
    const addOrUpdateProperties = Object.keys(now)
      .filter((k) => !(k in was) || was[k] !== now[k])
      .map((key) => ({ key, value: now[key] }));
    if (removeProperties.length || addOrUpdateProperties.length) {
      update.push({ id, ...(removeProperties.length ? { removeProperties } : {}), ...(addOrUpdateProperties.length ? { addOrUpdateProperties } : {}) });
    }
  }
  // Adds carry their geometry: when most items come anew (the 90 s refresh), one setData is cheaper.
  if (add.length > after.size / 2) return null;
  if (!remove.length && !add.length && !update.length) return EMPTY_DIFF;
  return { ...(remove.length ? { remove } : {}), ...(add.length ? { add } : {}), ...(update.length ? { update } : {}) };
}

/** Draws (or clears, with null) the detour polyline of the open detail. */
export function setDetourData(map: MlMap, coords: readonly [number, number][] | null): void {
  const src = map.getSource<GeoJSONSource>(SRC_DETOUR);
  if (src) void src.setData(detourCollection(coords));
}
