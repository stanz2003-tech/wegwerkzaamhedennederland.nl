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
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { mapSelection, urlState } from './helpers/src.mjs';

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

/* ----------------------- clusters: coloured by the worst verdict ----------------------- */

/**
 * A tiny evaluator for the expression subset the cluster specs use (get, coalesce, match, max),
 * so the tests can assert what MapLibre will compute without a browser.
 */
function evaluate(expr, props) {
  if (!Array.isArray(expr)) return expr;
  const [op, ...args] = expr;
  if (op === 'get') return props[args[0]] ?? null;
  if (op === 'coalesce') {
    for (const a of args) {
      const v = evaluate(a, props);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }
  if (op === 'match') {
    const input = evaluate(args[0], props);
    for (let i = 1; i < args.length - 1; i += 2) if (args[i] === input) return evaluate(args[i + 1], props);
    return evaluate(args.at(-1), props);
  }
  throw new Error(`unsupported op ${op}`);
}

const { verdict: verdictMod, categories: categoriesMod } = await import('./helpers/src.mjs');
const { CLUSTER_HEX } = categoriesMod;

function contrast(a, b) {
  const lum = (h) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('cluster worst verdict', () => {
  const src = layers.pointSourceSpec({ type: 'FeatureCollection', features: [] }, true);
  const [agg, rankExpr] = src.clusterProperties.worst;
  const rank = (v) => evaluate(rankExpr, v === undefined ? {} : { v });

  it('aggregates the rank with max, so the heaviest verdict in a cluster wins', () => {
    assert.equal(agg, 'max');
    assert.deepEqual(rankExpr[1], ['get', 'v'], 'reads the v property that main.ts withVerdict sets');
  });

  it('ranks follow VERDICT_SEVERITY: every level is heavier than the ones after it', () => {
    const order = verdictMod.VERDICT_SEVERITY; // worst first
    for (let i = 0; i + 1 < order.length; i++) {
      assert.ok(rank(order[i]) > rank(order[i + 1]), `${order[i]} must outrank ${order[i + 1]}`);
    }
  });

  it('a missing or unknown v counts as onbekend (3), never lighter', () => {
    assert.equal(rank(undefined), 3);
    assert.equal(rank('iets-nieuws'), 3);
    assert.equal(rank('onbekend'), 3);
    assert.ok(rank(undefined) > rank('geen'), 'a cluster must not turn green because an item had no verdict');
  });

  it('is not part of the unclustered source', () => {
    const plain = layers.pointSourceSpec({ type: 'FeatureCollection', features: [] }, false);
    assert.equal(plain.clusterProperties, undefined);
  });

  for (const theme of THEMES) {
    const byId = new Map(specs(theme, true).map((l) => [l.id, l]));
    const fill = byId.get(LAYERS.clusters).paint['circle-color'];
    const text = byId.get(LAYERS.clusterCount).paint['text-color'];

    it(`${theme}: the circle and the count are coloured by the worst property`, () => {
      assert.equal(fill[0], 'match');
      assert.ok(JSON.stringify(fill[1]).includes('"worst"'), 'circle-color reads worst');
      assert.ok(JSON.stringify(text[1]).includes('"worst"'), 'text-color reads worst');
      for (const level of ['dicht', 'rijbaan', 'hinder', 'onbekend', 'geen', 'nvt']) {
        const props = { worst: rank(level) };
        assert.equal(evaluate(fill, props), CLUSTER_HEX[theme][level].fill, `${level} fill`);
        assert.equal(evaluate(text, props), CLUSTER_HEX[theme][level].text, `${level} text`);
      }
      assert.equal(evaluate(fill, {}), CLUSTER_HEX[theme].onbekend.fill, 'no worst → onbekend colour');
    });

    it(`${theme}: every cluster count is readable on its fill (≥ 4.5:1)`, () => {
      for (const [level, { fill: f, text: t }] of Object.entries(CLUSTER_HEX[theme])) {
        const c = contrast(t, f);
        assert.ok(c >= 4.5, `${theme} ${level}: ${t} on ${f} = ${c.toFixed(2)}:1`);
      }
    });
  }
});

describe('sending the map only what changed (featureDiff, INP)', () => {
  const { featureDiff } = layers;
  const read = (f) => JSON.parse(readFileSync(new URL(`../fixtures/data/${f}`, import.meta.url), 'utf8')).features;
  const items = [...read('live.geojson'), ...read('werk-actueel.geojson'), ...read('werk-gepland.geojson')];
  const NOW = Date.parse('2026-09-23T10:00:00Z');

  /** MapLibre's applySourceDiff: remove, then add (overwrites by id), then property updates. */
  const apply = (collection, diff) => {
    const out = new Map(collection.features.map((f) => [f.properties.id, f]));
    for (const id of diff.remove ?? []) out.delete(id);
    for (const f of diff.add ?? []) out.set(f.properties.id, f);
    for (const u of diff.update ?? []) {
      const old = out.get(u.id);
      if (!old) continue;
      const properties = { ...old.properties };
      for (const k of u.removeProperties ?? []) delete properties[k];
      for (const { key, value } of u.addOrUpdateProperties ?? []) properties[key] = value;
      out.set(u.id, { ...old, properties });
    }
    return out;
  };
  const same = (got, want, label) => {
    assert.deepEqual([...got.keys()].sort(), want.features.map((f) => f.properties.id).sort(), label);
    for (const f of want.features) {
      const g = got.get(f.properties.id);
      assert.deepEqual(g.properties, f.properties, `${label} ${f.properties.id}`);
      assert.equal(g.geometry, f.geometry, `${label} ${f.properties.id} geometry`);
    }
  };
  /** What main.ts render() hands the map for one question. */
  const mapData = (mode, q) => {
    const { base } = mapSelection.selectForQuestion(items, { ...urlState.DEFAULT_URL_STATE, ...q }, null, NOW);
    const judged = mapSelection.judge(base, mode, q.moment ?? NOW, null).filter((j) => j.level !== 'nvt');
    return splitFeatures(judged.map(mapSelection.withVerdict));
  };

  it('turns every chip and vehicle tap into exactly the next map data', () => {
    const steps = [];
    for (const time of ['nu', 'vandaag', 'morgen', 'weekend']) for (const mode of ['auto', 'vracht', 'fiets']) steps.push({ mode, q: { time } });
    steps.push({ mode: 'auto', q: { moment: NOW + 40 * 3600_000 } }, { mode: 'fiets', q: { time: 'nu' } });
    let diffs = 0;
    for (let i = 1; i < steps.length; i++) {
      const prev = mapData(steps[i - 1].mode, steps[i - 1].q);
      const next = mapData(steps[i].mode, steps[i].q);
      for (const key of ['lines', 'points']) {
        const diff = featureDiff(prev[key], next[key]);
        const label = `${JSON.stringify(steps[i - 1])} → ${JSON.stringify(steps[i])} ${key}`;
        if (diff === null) continue; // setData: trivially exact
        diffs += 1;
        same(apply(prev[key], diff), next[key], label);
        for (const f of diff.add ?? []) assert.ok(!prev[key].features.some((p) => p.properties.id === f.properties.id && p.geometry === f.geometry), `${label}: unchanged geometry is not re-sent`);
      }
    }
    assert.ok(diffs > 20, `${diffs} diffs checked`);
  });

  it('re-sends an item whose geometry is a new object, and drops a property that went away', () => {
    const a = { type: 'Feature', id: 'x', geometry: { type: 'Point', coordinates: [5, 52] }, properties: { id: 'x', cat: 'werk', sev: 2, v: 'geen', sub: 'roadworks' } };
    const keep = { type: 'Feature', id: 'k', geometry: { type: 'Point', coordinates: [5, 52] }, properties: { id: 'k', cat: 'werk', sev: 2, v: 'geen' } };
    const prev = { type: 'FeatureCollection', features: [a, keep] };
    const moved = { ...a, geometry: { type: 'Point', coordinates: [6, 52] } };
    assert.deepEqual(featureDiff(prev, { type: 'FeatureCollection', features: [moved, keep] }).add, [moved]);
    const noSub = { ...a, properties: { id: 'x', cat: 'werk', sev: 2, v: 'dicht' } };
    const diff = featureDiff(prev, { type: 'FeatureCollection', features: [noSub, keep] });
    assert.deepEqual(diff, { update: [{ id: 'x', removeProperties: ['sub'], addOrUpdateProperties: [{ key: 'v', value: 'dicht' }] }] });
    assert.deepEqual(featureDiff(prev, prev), {}, 'nothing to send');
  });

  it('falls back to a full setData for duplicate ids or when most items are new', () => {
    const f = (id) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [5, 52] }, properties: { id, cat: 'werk', sev: 1, v: 'geen' } });
    const fc = (...features) => ({ type: 'FeatureCollection', features });
    assert.equal(featureDiff(fc(f('a')), fc(f('b'), f('b'))), null, 'duplicate ids');
    assert.equal(featureDiff(fc(), fc(f('a'), f('b'))), null, 'first fill');
    assert.equal(featureDiff(fc(f('a'), f('b'), f('c')), fc(f('a'), f('b'), f('c'))), null, 'every geometry a new object: the refresh');
  });
});
