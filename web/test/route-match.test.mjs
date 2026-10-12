/**
 * Unit tests for web/src/data/route-match.ts: which items lie ON a route, which only beside it
 * (the other carriageway), and which merely cross or touch it.
 *
 * Geometry: a straight route eastwards along latitude 52.0 from lon 5.00 to lon 5.05 (~3.4 km).
 * Driving east, LEFT is north. 1 m north ≈ 0.000009° of latitude.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeMatch } from './helpers/src.mjs';

const { AVOID_SPACING_M, MAX_AVOID_POINTS, avoidPoints, createRouteMatcher, deviatingPoints, matchRoute, pointAlong, sideOf } = routeMatch;

const LAT = 52.0;
const M_LAT = 1 / 110_574;
const ROUTE = Array.from({ length: 51 }, (_, i) => [5.0 + i * 0.001, LAT]);
const north = (m) => LAT + m * M_LAT;
const line = (id, coords) => ({ properties: { id }, geometry: { type: 'LineString', coordinates: coords } });
const point = (id, c) => ({ properties: { id }, geometry: { type: 'Point', coordinates: c } });

describe('matchRoute', () => {
  it('finds a closure that lies on the route, with its position along it', () => {
    const [m] = matchRoute(ROUTE, [line('on', [[5.01, LAT], [5.02, LAT]])]);
    assert.equal(m?.id, 'on');
    assert.equal(m?.side, 'op');
    // 0.01° of longitude at 52°N is ~685 m.
    assert.ok(Math.abs(m.fromM - 685) < 20, `fromM ${m.fromM}`);
    assert.ok(Math.abs(m.toM - 1370) < 20, `toM ${m.toM}`);
  });

  it('reports the other carriageway (15 m to the left) as `naast`, not as on the route', () => {
    const [m] = matchRoute(ROUTE, [line('other', [[5.01, north(15)], [5.02, north(15)]])]);
    assert.equal(m?.side, 'naast');
  });

  it('keeps a line 15 m to the RIGHT on the route: the other direction never lies right', () => {
    const [m] = matchRoute(ROUTE, [line('right', [[5.01, north(-15)], [5.02, north(-15)]])]);
    assert.equal(m?.side, 'op');
  });

  it('finds a long line whose vertices all lie outside a short route', () => {
    const short = [[5.02, LAT], [5.021, LAT]];
    assert.equal(matchRoute(short, [line('long', [[5.0, LAT], [5.05, LAT]])])[0]?.id, 'long');
  });

  it('keeps a line that wanders across the route as `op`: unclear counts as on it', () => {
    const zigzag = Array.from({ length: 11 }, (_, i) => [5.01 + i * 0.001, north(i % 2 === 0 ? 10 : -10)]);
    assert.equal(matchRoute(ROUTE, [line('zig', zigzag)])[0]?.side, 'op');
  });

  it('ignores a parallel road further away than the corridor', () => {
    assert.deepEqual(matchRoute(ROUTE, [line('far', [[5.01, north(40)], [5.02, north(40)]])]), []);
  });

  it('ignores a road the route crosses (a closed street under a motorway bridge)', () => {
    assert.deepEqual(matchRoute(ROUTE, [line('cross', [[5.02, north(-300)], [5.02, north(300)]])]), []);
  });

  it('ignores a long road that only touches the route for a few metres', () => {
    const touching = [[4.99, LAT], [5.0005, LAT], [5.0005, north(400)]];
    assert.deepEqual(matchRoute(ROUTE, [line('touch', touching)]), []);
  });

  it('matches a short closure that lies wholly on the route', () => {
    assert.equal(matchRoute(ROUTE, [line('short', [[5.03, LAT], [5.0306, LAT]])])[0]?.id, 'short');
  });

  it('matches a point within 30 m and not one further away', () => {
    const hits = matchRoute(ROUTE, [point('near', [5.025, north(20)]), point('away', [5.025, north(60)])]);
    assert.deepEqual(hits.map((h) => h.id), ['near']);
  });

  it('reads MultiLineStrings and returns the matches in driving order', () => {
    const multi = { properties: { id: 'multi' }, geometry: { type: 'MultiLineString', coordinates: [[[5.04, LAT], [5.045, LAT]]] } };
    const hits = matchRoute(ROUTE, [multi, line('first', [[5.005, LAT], [5.01, LAT]])]);
    assert.deepEqual(hits.map((h) => h.id), ['first', 'multi']);
  });

  it('returns nothing for a route without length', () => {
    assert.deepEqual(matchRoute([[5, 52]], [line('x', [[5, 52], [5.01, 52]])]), []);
  });
});

describe('createRouteMatcher', () => {
  it('matches an item once, and again when its geometry changes (a growing queue)', () => {
    const match = createRouteMatcher(ROUTE);
    assert.equal(match([line('q', [[5.01, north(500)], [5.02, north(500)]])]).length, 0);
    assert.equal(match([line('q', [[5.01, north(500)], [5.02, north(500)]])]).length, 0);
    assert.equal(match([line('q', [[5.01, LAT], [5.02, LAT]])]).length, 1);
  });
});

describe('sideOf', () => {
  it('is `naast` only when nearly everything keeps to the left', () => {
    assert.equal(sideOf(100, 100), 'naast');
    assert.equal(sideOf(100, 80), 'naast');
    assert.equal(sideOf(100, 70), 'op');
    assert.equal(sideOf(0, 0), 'op');
  });
});

describe('avoidPoints', () => {
  it('puts one point on the route in the middle of a short stretch', () => {
    const [p] = avoidPoints(ROUTE, [{ id: 'a', side: 'op', fromM: 685, toM: 1370, alongM: 685 }]);
    assert.ok(Math.abs(p[1] - LAT) < 1e-5);
    assert.ok(Math.abs(p[0] - 5.015) < 1e-4, `lon ${p[0]}`);
  });

  it('spreads points over a long stretch so the router cannot join it halfway', () => {
    const pts = avoidPoints(ROUTE, [{ id: 'a', side: 'op', fromM: 0, toM: 3400, alongM: 3400 }]);
    assert.equal(pts.length, Math.floor(3400 / AVOID_SPACING_M) + 1);
  });

  it('caps the number of points', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: String(i), side: 'op', fromM: i * 10, toM: i * 10, alongM: 0 }));
    assert.equal(avoidPoints(ROUTE, many).length, MAX_AVOID_POINTS);
  });
});

describe('pointAlong', () => {
  it('walks the route in metres and stops at its end', () => {
    assert.deepEqual(pointAlong(ROUTE, 0), [5.0, LAT]);
    const end = pointAlong(ROUTE, 1e9);
    assert.ok(Math.abs(end[0] - 5.05) < 1e-9);
  });
});

describe('deviatingPoints', () => {
  it('picks via points on the stretch where a detour leaves the fastest route', () => {
    const detour = [[5.0, LAT], [5.01, LAT], [5.015, north(1000)], [5.03, north(1000)], [5.035, LAT], [5.05, LAT]];
    const pts = deviatingPoints(detour, ROUTE);
    assert.ok(pts.length >= 1 && pts.length <= 3);
    for (const [, lat] of pts) assert.ok(lat > north(500), 'every via point lies on the detour itself');
  });

  it('gives none for the same route', () => {
    assert.deepEqual(deviatingPoints(ROUTE, ROUTE), []);
  });
});
