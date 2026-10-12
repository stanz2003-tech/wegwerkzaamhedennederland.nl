/**
 * Unit tests for web/src/ui/route-view.ts: what the list, the map and the card get from a judged
 * route plan.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routePlan, routeView } from './helpers/src.mjs';

const { assessRoute, rankRoutes } = routePlan;
const { drawingOf, fastestPlain, pendingSelection, routeSelection, viaPointsFor, whenKeyOf } = routeView;

const NOW = Date.parse('2026-10-11T12:00:30Z');
const LAT = 52.0;
const straight = (lat) => Array.from({ length: 51 }, (_, i) => [5.0 + i * 0.001, lat]);
const FAST = { coords: straight(LAT), distanceM: 3400, durationS: 1000 };
const DETOUR = { coords: [[5.0, LAT], ...straight(52.01), [5.05, LAT]], distanceM: 5600, durationS: 1300 };
const STOPS = { from: { name: 'W', lon: 5.0, lat: LAT }, to: { name: 'O', lon: 5.05, lat: LAT } };

const item = (id, coords, over = {}) => ({
  type: 'Feature',
  id,
  properties: { id, cat: 'afsluiting', sev: 3, title: `N999 · ${id}`, start: '2026-10-01T00:00Z', src: 'P', imp: 'dicht', ...over },
  geometry: { type: 'LineString', coordinates: coords },
});

const q = { mode: 'auto', when: { kind: 'moment', at: NOW }, now: NOW };

describe('routeSelection', () => {
  it('lists the items on the route in driving order and judges over the trip', () => {
    const items = [item('later', [[5.04, LAT], [5.045, LAT]]), item('first', [[5.005, LAT], [5.01, LAT]]), item('away', [[6, 53], [6.01, 53]])];
    const route = assessRoute(FAST, items, new Map(), q);
    const sel = routeSelection(route, items, q.when, NOW);
    assert.deepEqual(sel.order(sel.base).map((f) => f.properties.id), ['first', 'later']);
    assert.deepEqual(sel.window, { from: NOW, to: NOW + 1_000_000 });
    assert.equal(sel.pending, null);
  });

  it('keeps the map key stable within a minute', () => {
    const route = assessRoute(FAST, [], new Map(), q);
    const a = routeSelection(route, [], { kind: 'moment', at: NOW }, NOW).key;
    const b = routeSelection(route, [], { kind: 'moment', at: NOW + 20_000 }, NOW + 20_000).key;
    assert.equal(a, b);
  });

  it('a pending route has no items and says why', () => {
    const sel = pendingSelection('error', NOW);
    assert.deepEqual(sel.base, []);
    assert.equal(sel.pending, 'error');
  });
});

describe('via points and drawing', () => {
  const closure = item('dicht', [[5.02, LAT], [5.03, LAT]]);
  const plan = rankRoutes([assessRoute(FAST, [closure], new Map(), q), assessRoute(DETOUR, [closure], new Map(), q, true)]);

  it('the fastest route goes to Google without via points, the detour with points on the detour', () => {
    assert.equal(fastestPlain(plan).option, FAST);
    assert.deepEqual(viaPointsFor(plan.routes[0], plan), []);
    const via = viaPointsFor(plan.routes[1], plan);
    assert.ok(via.length > 0);
    for (const [, lat] of via) assert.ok(lat > LAT + 0.005);
  });

  it('draws every route with the chosen one marked, plus both stops', () => {
    const d = drawingOf(STOPS, plan, 1);
    assert.deepEqual(d.routes.map((r) => r.selected), [false, true]);
    assert.deepEqual(d.to, [5.05, LAT]);
    assert.equal(drawingOf(null, plan, 0), null);
    assert.deepEqual(drawingOf(STOPS, null, 0).routes, []);
  });
});

describe('whenKeyOf', () => {
  it('stays the same for "nu" while the clock runs, changes with the chosen moment', () => {
    const nu = { time: 'nu', moment: null, day: null, part: null };
    assert.equal(whenKeyOf(nu), whenKeyOf({ ...nu }));
    assert.notEqual(whenKeyOf(nu), whenKeyOf({ ...nu, moment: NOW }));
  });
});
