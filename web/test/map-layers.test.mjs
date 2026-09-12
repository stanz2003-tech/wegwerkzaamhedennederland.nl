/**
 * Regression tests for the MapLibre overlay layer specs (web/src/map/layers.ts) and the
 * expression checker that guards them (web/src/map/style-check.ts).
 *
 * Why this file exists: the `points` layer used to be
 *   'circle-radius': ['case', hover, pointRadius(1.5), pointRadius()]
 * — two zoom-based `interpolate` expressions in one property. MapLibre answers with
 *   "layers.points.paint.circle-radius: Only one zoom-based \"step\" or \"interpolate\"
 *    subexpression may be used in an expression."
 * and drops the layer, so every Point feature (the majority of the dataset) disappeared from
 * the map while the rest of the style kept working. We run with `validateStyle: false`, so
 * nothing else catches that; these tests do.
 *
 * The TypeScript sources are loaded through test/helpers/src.mjs, which installs the module
 * hooks (extensionless relative imports, `?raw` imports) — see test/README.md.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './helpers/src.mjs';

const layers = await import(new URL('../src/map/layers.ts', import.meta.url).href);
const styleCheck = await import(new URL('../src/map/style-check.ts', import.meta.url).href);

const { CLUSTER_MAX_ZOOM, LAYERS, HIT_LAYERS, overlayLayers, pointRadius, lineWidth, splitFeatures } = layers;
const { checkLayers, checkPropertyValue } = styleCheck;

const THEMES = ['light', 'dark'];

function specs(theme, cluster) {
  return overlayLayers({ theme, labelFont: ['Liberation Sans Bold'], beforeId: undefined, cluster });
}

/* --------------------------- the checker itself --------------------------- */

describe('style-check', () => {
  it('accepts a single top-level zoom interpolate', () => {
    const value = ['interpolate', ['linear'], ['zoom'], 6, 4, 14, 8];
    assert.deepEqual(checkPropertyValue('l', 'circle-radius', value), []);
  });

  it('accepts a plain number and a zoom-free expression', () => {
    assert.deepEqual(checkPropertyValue('l', 'circle-stroke-width', 2), []);
    assert.deepEqual(checkPropertyValue('l', 'circle-opacity', ['case', ['get', 'x'], 1, 0]), []);
  });

  it('flags two zoom curves in one property (the bug that killed the points layer)', () => {
    const buggy = ['case', ['boolean', ['feature-state', 'hover'], false], pointRadius(1.5), pointRadius()];
    const problems = checkPropertyValue('points', 'circle-radius', buggy);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].kind, 'multiple-zoom-curves');
    assert.match(problems[0].message, /points\.circle-radius/);
  });

  it('flags a single zoom curve that is not the outermost expression', () => {
    const nested = ['*', 2, ['interpolate', ['linear'], ['zoom'], 6, 1, 14, 3]];
    const problems = checkPropertyValue('l', 'line-width', nested);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].kind, 'nested-zoom-curve');
  });

  it('flags a zoom-based step nested in a match', () => {
    const nested = ['match', ['get', 'cat'], 'file', ['step', ['zoom'], 1, 10, 2], 3];
    assert.equal(checkPropertyValue('l', 'line-width', nested).length, 1);
  });

  it('does not flag a non-zoom step or interpolate', () => {
    const byCount = ['step', ['get', 'point_count'], 14, 10, 18, 50, 23];
    assert.deepEqual(checkPropertyValue('clusters', 'circle-radius', byCount), []);
  });
});

/* ------------------------------ the real layers ------------------------------ */

describe('overlayLayers', () => {
  for (const theme of THEMES) {
    for (const cluster of [true, false]) {
      it(`has at most one top-level zoom curve per property (${theme}, cluster=${cluster})`, () => {
        const problems = checkLayers(specs(theme, cluster));
        assert.deepEqual(
          problems.map((p) => p.message),
          [],
        );
      });
    }
  }

  it('builds every layer id in LAYERS when clustering is on', () => {
    const ids = specs('light', true).map((l) => l.id);
    for (const id of Object.values(LAYERS)) assert.ok(ids.includes(id), `missing layer ${id}`);
    assert.equal(new Set(ids).size, ids.length, 'duplicate layer id');
  });

  it('omits only the cluster layers when clustering is off', () => {
    const ids = specs('light', false).map((l) => l.id);
    assert.ok(!ids.includes(LAYERS.clusters));
    assert.ok(!ids.includes(LAYERS.clusterCount));
    assert.ok(ids.includes(LAYERS.points));
  });

  it('keeps the points layer above the cluster layers', () => {
    const ids = specs('light', true).map((l) => l.id);
    assert.ok(ids.indexOf(LAYERS.points) > ids.indexOf(LAYERS.clusters));
  });

  it('queries the point layer before the line hit layer', () => {
    assert.equal(HIT_LAYERS[0], LAYERS.points);
  });

  it('draws points and clusters from mutually exclusive filters', () => {
    const byId = new Map(specs('light', true).map((l) => [l.id, l]));
    assert.deepEqual(byId.get(LAYERS.clusters).filter, ['has', 'point_count']);
    assert.deepEqual(byId.get(LAYERS.points).filter, ['!', ['has', 'point_count']]);
  });
});

describe('zoom stop expressions', () => {
  it('pointRadius folds an expression addend into every stop', () => {
    const expr = pointRadius(['case', ['boolean', ['feature-state', 'hover'], false], 1.5, 0]);
    assert.equal(expr[0], 'interpolate');
    // ["interpolate", ["linear"], ["zoom"], z1, v1, z2, v2, …]
    const stops = expr.slice(3);
    assert.equal(stops.length % 2, 0);
    for (let i = 1; i < stops.length; i += 2) {
      assert.equal(stops[i][0], '+');
      assert.deepEqual(stops[i].at(-1), ['case', ['boolean', ['feature-state', 'hover'], false], 1.5, 0]);
    }
    assert.deepEqual(checkPropertyValue('points', 'circle-radius', expr), []);
  });

  it('pointRadius grows with zoom for a fixed severity', () => {
    const expr = pointRadius();
    const zooms = expr.filter((_, i) => i >= 3 && (i - 3) % 2 === 0);
    assert.deepEqual(zooms, [...zooms].sort((a, b) => a - b));
  });

  it('lineWidth stays a single zoom interpolate for every argument shape', () => {
    for (const value of [lineWidth(), lineWidth(3), lineWidth(0, 0.42), lineWidth(2.5, 1.1)]) {
      assert.deepEqual(checkPropertyValue('l', 'line-width', value), []);
    }
  });
});

describe('clustering', () => {
  it('clusters below zoom 9 and shows individual features from zoom 9', () => {
    // MapLibre clusters every tile zoom <= clusterMaxZoom, so the last clustered zoom is 8.
    assert.equal(CLUSTER_MAX_ZOOM, 8);
    const src = layers.pointSourceSpec({ type: 'FeatureCollection', features: [] }, true);
    assert.equal(src.cluster, true);
    assert.equal(src.clusterMaxZoom, 8);
  });

  it('leaves clustering off when not requested', () => {
    const src = layers.pointSourceSpec({ type: 'FeatureCollection', features: [] }, false);
    assert.ok(!('cluster' in src) || src.cluster !== true);
  });
});

describe('splitFeatures', () => {
  const pt = (id) => ({ type: 'Feature', id, properties: { id, cat: 'werk' }, geometry: { type: 'Point', coordinates: [5, 52] } });
  const line = (id) => ({
    type: 'Feature',
    id,
    properties: { id, cat: 'werk' },
    geometry: { type: 'LineString', coordinates: [[5, 52], [5.1, 52.1]] },
  });

  it('routes Point features to the point source and lines to the line source', () => {
    const { lines, points } = splitFeatures([pt('a'), line('b'), pt('c')]);
    assert.deepEqual(points.features.map((f) => f.id), ['a', 'c']);
    assert.deepEqual(lines.features.map((f) => f.id), ['b']);
  });

  it('sets the GeoJSON id from properties.id so feature-state works', () => {
    const raw = { ...pt('x'), id: undefined };
    const { points } = splitFeatures([raw]);
    assert.equal(points.features[0].id, 'x');
  });
});
