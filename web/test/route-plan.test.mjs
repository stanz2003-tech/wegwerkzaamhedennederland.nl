/**
 * Unit tests for web/src/data/route-plan.ts with a fake router: a closure on the fastest route
 * makes the planner ask for a route round it and recommend that one; a closure that is not for
 * the chosen vehicle does not; when there is no way round, the plan says so.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routePlan, routing } from './helpers/src.mjs';

const { assessRoute, planRoutes, rankRoutes, sameRoute, tripWhen } = routePlan;
const { RoutingError } = routing;

const NOW = Date.parse('2026-10-11T12:00:00Z');
const LAT = 52.0;
const FROM = { name: 'West', lon: 5.0, lat: LAT };
const TO = { name: 'Oost', lon: 5.05, lat: LAT };

const straight = (lat) => Array.from({ length: 51 }, (_, i) => [5.0 + i * 0.001, lat]);
/** Fast: straight east. Detour: up 1 km, east, down again. */
const FAST = { coords: straight(LAT), distanceM: 3400, durationS: 1000 };
const DETOUR = { coords: [[5.0, LAT], ...straight(52.01), [5.05, LAT]], distanceM: 5600, durationS: 1300 };

const closure = (over = {}) => ({
  type: 'Feature',
  id: over.id ?? 'dicht-1',
  properties: {
    id: 'dicht-1',
    cat: 'afsluiting',
    sub: 'roadClosed',
    sev: 3,
    title: 'N999 · West → Oost',
    road: 'N999',
    roadType: 'N',
    start: '2026-10-01T00:00Z',
    src: 'Provincie',
    imp: 'dicht',
    ...over,
  },
  geometry: { type: 'LineString', coordinates: [[5.02, LAT], [5.03, LAT]] },
});

function fakeRouter(answers) {
  const calls = [];
  return {
    calls,
    route: async (req) => {
      calls.push(req);
      const next = answers[calls.length - 1];
      if (next instanceof Error) throw next;
      return next ?? [];
    },
  };
}

const question = (over = {}) => ({ from: FROM, to: TO, mode: 'auto', when: { kind: 'moment', at: NOW }, now: NOW, ...over });
const deps = (router, items) => ({ route: router.route, items: () => items, details: async () => new Map() });

describe('planRoutes', () => {
  it('asks for a route round a closure on the fastest route and recommends it', async () => {
    const router = fakeRouter([[FAST], [DETOUR]]);
    const plan = await planRoutes(question(), deps(router, [closure()]));
    assert.equal(router.calls.length, 2);
    assert.equal(router.calls[0].alternates, 2);
    const avoid = router.calls[1].avoid;
    assert.ok(avoid.length >= 1);
    for (const [lon, lat] of avoid) {
      assert.ok(lon >= 5.02 && lon <= 5.03, `avoid point ${lon} lies on the closure`);
      assert.ok(Math.abs(lat - LAT) < 1e-5);
    }
    assert.deepEqual(plan.routes.map((r) => r.option.durationS), [1000, 1300]);
    assert.equal(plan.routes[0].answer.level, 'dicht');
    assert.equal(plan.routes[0].blockers.length, 1);
    assert.equal(plan.routes[1].avoiding, true);
    assert.equal(plan.recommended, 1);
    assert.equal(plan.noClearRoute, false);
  });

  it('does not detour for a closure that is not for the chosen vehicle', async () => {
    const router = fakeRouter([[FAST]]);
    const plan = await planRoutes(question(), deps(router, [closure({ veh: ['lorry'] })]));
    assert.equal(router.calls.length, 1);
    assert.equal(plan.recommended, 0);
    assert.equal(plan.routes[0].blockers.length, 0);
  });

  it('a lorry driver does get the detour for that closure', async () => {
    const router = fakeRouter([[FAST], [DETOUR]]);
    const plan = await planRoutes(question({ mode: 'vracht' }), deps(router, [closure({ veh: ['lorry'] })]));
    assert.equal(router.calls.length, 2);
    assert.equal(plan.recommended, 1);
  });

  it('says so when there is no way round', async () => {
    const router = fakeRouter([[FAST], new RoutingError('Geen route', 'none')]);
    const plan = await planRoutes(question(), deps(router, [closure()]));
    assert.equal(plan.routes.length, 1);
    assert.equal(plan.noClearRoute, true);
    assert.equal(plan.recommended, 0);
  });

  it('passes a technical router failure on', async () => {
    const router = fakeRouter([new RoutingError('kapot', 'failed')]);
    await assert.rejects(planRoutes(question(), deps(router, [])), (err) => err.kind === 'failed');
  });

  it('asks the details of the items on the routes only', async () => {
    const router = fakeRouter([[FAST], [DETOUR]]);
    const asked = [];
    const far = { ...closure({ id: 'far' }), geometry: { type: 'LineString', coordinates: [[6, 53], [6.01, 53]] } };
    await planRoutes(question(), { route: router.route, items: () => [closure(), far], details: async (ids) => (asked.push(...ids), new Map()) });
    assert.deepEqual([...new Set(asked)], ['dicht-1']);
  });
});

describe('the trip window', () => {
  it('runs from departure to arrival for a moment question', () => {
    assert.deepEqual(tripWhen({ kind: 'moment', at: NOW }, 1200), { kind: 'window', from: NOW, to: NOW + 1_200_000 });
  });

  it('keeps a window question as it is', () => {
    const w = { kind: 'window', from: NOW, to: NOW + 86_400_000 };
    assert.equal(tripWhen(w, 1200), w);
  });

  it('counts a closure that starts while you are on the road', () => {
    const later = closure({ start: new Date(NOW + 10 * 60_000).toISOString().slice(0, 16) + 'Z' });
    const assessed = assessRoute(FAST, [later], new Map(), { mode: 'auto', when: { kind: 'moment', at: NOW }, now: NOW });
    assert.equal(assessed.answer.level, 'dicht');
    // …but not one that starts after you arrived.
    const after = closure({ start: new Date(NOW + 30 * 60_000).toISOString().slice(0, 16) + 'Z' });
    assert.equal(assessRoute(FAST, [after], new Map(), { mode: 'auto', when: { kind: 'moment', at: NOW }, now: NOW }).answer.level, null);
  });

  it('does not count the other carriageway', () => {
    const other = { ...closure(), geometry: { type: 'LineString', coordinates: [[5.02, LAT + 15 / 110_574], [5.03, LAT + 15 / 110_574]] } };
    const assessed = assessRoute(FAST, [other], new Map(), { mode: 'auto', when: { kind: 'moment', at: NOW }, now: NOW });
    assert.equal(assessed.answer.level, null);
    assert.equal(assessed.beside.length, 1);
  });
});

describe('rankRoutes', () => {
  const q = { mode: 'auto', when: { kind: 'moment', at: NOW }, now: NOW };

  it('merges two copies of one route and keeps the one without a closure', () => {
    const blocked = assessRoute(FAST, [closure()], new Map(), q);
    const clear = { ...assessRoute(FAST, [], new Map(), q), avoiding: true };
    const plan = rankRoutes([blocked, clear]);
    assert.equal(plan.routes.length, 1);
    assert.equal(plan.routes[0].blockers.length, 0);
  });

  it('recognises the same route within rounding', () => {
    assert.equal(sameRoute(FAST, { ...FAST, distanceM: 3410, durationS: 1005 }), true);
    assert.equal(sameRoute(FAST, DETOUR), false);
  });
});
