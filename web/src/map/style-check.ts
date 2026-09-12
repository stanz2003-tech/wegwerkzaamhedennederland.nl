/**
 * A tiny static check for the one MapLibre expression rule that silently kills a whole layer:
 * a paint/layout property may contain **at most one** zoom-based `interpolate`/`step`, and that
 * curve must be the outermost expression of the property value.
 *
 * MapLibre rejects a violating layer with
 *   "Only one zoom-based \"step\" or \"interpolate\" subexpression may be used in an expression."
 * or
 *   "\"zoom\" expression may only be used as input to a top-level \"step\" or \"interpolate\"…"
 * — logged to the console via `map.on('error')`, after which `addLayer` leaves nothing behind.
 * Because we run with `validateStyle: false` (for speed), nothing else catches this, so the
 * layer list is checked in a unit test instead.
 *
 * Pure, dependency-free and DOM-free on purpose: `web/test/map-layers.test.mjs` runs it in Node.
 */
import type { LayerSpecification } from 'maplibre-gl';

/** One violation: which layer, which property, and what is wrong. */
export interface StyleProblem {
  layer: string;
  /** `paint` or `layout` property name, e.g. `circle-radius`. */
  property: string;
  kind: 'multiple-zoom-curves' | 'nested-zoom-curve';
  message: string;
}

const CURVE_OPERATORS = new Set(['interpolate', 'interpolate-hcl', 'interpolate-lab', 'step']);

function isExpressionArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && typeof value[0] === 'string';
}

/** True when the expression *itself* reads the zoom (not counting nested curve inputs). */
function readsZoom(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value[0] === 'zoom' && value.length === 1) return true;
  return value.some((child) => readsZoom(child));
}

/** True for `["interpolate", …, ["zoom"], …]` / `["step", ["zoom"], …]`. */
function isZoomCurve(value: unknown): boolean {
  if (!isExpressionArray(value)) return false;
  const op = value[0] as string;
  if (!CURVE_OPERATORS.has(op)) return false;
  const input = op === 'step' ? value[1] : value[2];
  return readsZoom(input);
}

/** Counts the zoom curves anywhere inside `value`. */
function countZoomCurves(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let n = isZoomCurve(value) ? 1 : 0;
  for (const child of value) n += countZoomCurves(child);
  return n;
}

/**
 * Checks one property value. Returns the problems found (empty when the value is fine).
 */
export function checkPropertyValue(layer: string, property: string, value: unknown): StyleProblem[] {
  const total = countZoomCurves(value);
  if (total === 0) return [];
  if (total > 1) {
    return [
      {
        layer,
        property,
        kind: 'multiple-zoom-curves',
        message: `${layer}.${property}: ${total} zoom-based interpolate/step expressions; MapLibre allows one. Move the variation inside the zoom stops.`,
      },
    ];
  }
  if (!isZoomCurve(value)) {
    return [
      {
        layer,
        property,
        kind: 'nested-zoom-curve',
        message: `${layer}.${property}: the zoom-based interpolate/step is nested; it must be the outermost expression of the property.`,
      },
    ];
  }
  return [];
}

function propertiesOf(layer: LayerSpecification): [string, unknown][] {
  const bag = layer as unknown as { paint?: Record<string, unknown>; layout?: Record<string, unknown> };
  return [...Object.entries(bag.paint ?? {}), ...Object.entries(bag.layout ?? {})];
}

/**
 * Checks every paint and layout property of every layer. An empty result means MapLibre will
 * accept all of them (as far as zoom curves are concerned).
 */
export function checkLayers(layers: readonly LayerSpecification[]): StyleProblem[] {
  const problems: StyleProblem[] = [];
  for (const layer of layers) {
    for (const [property, value] of propertiesOf(layer)) {
      problems.push(...checkPropertyValue(layer.id, property, value));
    }
  }
  return problems;
}
