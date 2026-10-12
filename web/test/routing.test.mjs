/**
 * Unit tests for the pure parts of web/src/data/routing.ts: the Valhalla request body, the
 * polyline decoder and the response parser (no network).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routing } from './helpers/src.mjs';

const { MAX_ALTERNATES, RoutingError, buildRouteBody, decodePolyline6, parseRouteResponse } = routing;

/** Google's polyline algorithm at precision 6 — the encoder Valhalla uses. */
function encode6(coords) {
  let out = '';
  let pLat = 0;
  let pLon = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * 1e6);
    const lo = Math.round(lon * 1e6);
    out += enc(la - pLat) + enc(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out;
}

const FROM = { name: 'Almkerk', lon: 4.96979, lat: 51.77115 };
const TO = { name: 'Montfoort', lon: 4.9524, lat: 52.044 };

describe('buildRouteBody', () => {
  it('asks for a car route without turn-by-turn text', () => {
    const body = buildRouteBody({ from: FROM, to: TO, mode: 'auto' });
    assert.equal(body.costing, 'auto');
    assert.equal(body.directions_type, 'none');
    assert.deepEqual(body.locations[0], { lat: 51.77115, lon: 4.96979, type: 'break' });
    assert.equal('alternates' in body, false);
    assert.equal('exclude_locations' in body, false);
  });

  it('maps the vehicle modes to Valhalla costings', () => {
    assert.equal(buildRouteBody({ from: FROM, to: TO, mode: 'vracht' }).costing, 'truck');
    assert.equal(buildRouteBody({ from: FROM, to: TO, mode: 'fiets' }).costing, 'bicycle');
  });

  it('caps the alternates and passes the points to avoid as lat/lon', () => {
    const body = buildRouteBody({ from: FROM, to: TO, mode: 'auto', alternates: 9, avoid: [[4.9405, 51.817]] });
    assert.equal(body.alternates, MAX_ALTERNATES);
    assert.deepEqual(body.exclude_locations, [{ lat: 51.817, lon: 4.9405 }]);
  });
});

describe('decodePolyline6', () => {
  it('round-trips coordinates at six decimals', () => {
    const coords = [[4.96979, 51.77115], [4.958123, 51.802], [5.1, 52.044]];
    assert.deepEqual(decodePolyline6(encode6(coords)), coords);
  });

  it('stops at a truncated string instead of inventing a point', () => {
    const s = encode6([[5, 52], [5.1, 52.1]]);
    assert.equal(decodePolyline6(s.slice(0, -2)).length, 1);
  });
});

describe('parseRouteResponse', () => {
  const trip = (coords, km, s) => ({ legs: [{ shape: encode6(coords) }], summary: { length: km, time: s } });

  it('returns the main trip first, then the alternates', () => {
    const json = { trip: trip([[5, 52], [5.1, 52.1]], 12.3, 900), alternates: [{ trip: trip([[5, 52], [5.2, 52.1]], 15, 1000) }] };
    const routes = parseRouteResponse(json);
    assert.equal(routes.length, 2);
    assert.deepEqual(routes[0], { coords: [[5, 52], [5.1, 52.1]], distanceM: 12300, durationS: 900 });
    assert.equal(routes[1].distanceM, 15000);
  });

  it('joins the legs of a trip without repeating the shared point', () => {
    const json = { trip: { legs: [{ shape: encode6([[5, 52], [5.1, 52]]) }, { shape: encode6([[5.1, 52], [5.2, 52]]) }], summary: { length: 2, time: 60 } } };
    assert.equal(parseRouteResponse(json)[0].coords.length, 3);
  });

  it('turns "no path" into a RoutingError of kind none', () => {
    assert.throws(
      () => parseRouteResponse({ error_code: 442, error: 'No path could be found for input' }),
      (err) => err instanceof RoutingError && err.kind === 'none',
    );
  });

  it('turns other errors and garbage into kind failed', () => {
    assert.throws(() => parseRouteResponse({ error_code: 500, error: 'boom' }), (err) => err.kind === 'failed');
    assert.throws(() => parseRouteResponse(null), (err) => err.kind === 'failed');
    assert.throws(() => parseRouteResponse({ trip: { legs: [{ shape: 42 }], summary: { length: 1, time: 1 } } }), (err) => err.kind === 'failed');
  });
});
