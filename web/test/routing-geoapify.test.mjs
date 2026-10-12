/**
 * Unit tests for web/src/data/routing-geoapify.ts (the router for when the site carries ads) and
 * the provider choice in web/src/data/routing.ts. No network: the answers follow the GeoJSON
 * documented at apidocs.geoapify.com/docs/routing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routing, routingGeoapify } from './helpers/src.mjs';

const { buildGeoapifyUrl, geoapifyError, isGeoapify, parseGeoapifyResponse } = routingGeoapify;
const { RoutingError, routingProvider } = routing;

const ENDPOINT = 'https://api.geoapify.com/v1/routing?apiKey=test-key';
const FROM = { name: 'Almkerk', lon: 4.96979, lat: 51.77115 };
const TO = { name: 'Montfoort', lon: 4.9524, lat: 52.044 };

describe('provider', () => {
  it('recognises Geoapify by its host, FOSSGIS by its address, anything else as Valhalla', () => {
    assert.equal(isGeoapify(ENDPOINT), true);
    assert.equal(isGeoapify('not a url'), false);
    assert.equal(routingProvider(ENDPOINT), 'geoapify');
    assert.equal(routingProvider('https://valhalla1.openstreetmap.de/route'), 'fossgis');
    assert.equal(routingProvider('https://api.stadiamaps.com/route/v1?api_key=x'), 'valhalla');
  });
});

describe('buildGeoapifyUrl', () => {
  it('keeps the key and asks lat,lon waypoints for a car', () => {
    const url = new URL(buildGeoapifyUrl(ENDPOINT, { from: FROM, to: TO, mode: 'auto' }));
    assert.equal(url.searchParams.get('apiKey'), 'test-key');
    assert.equal(url.searchParams.get('waypoints'), '51.77115,4.96979|52.04400,4.95240');
    assert.equal(url.searchParams.get('mode'), 'drive');
    assert.equal(url.searchParams.get('units'), 'metric');
    assert.equal(url.searchParams.has('avoid'), false);
  });

  it('maps lorry and bicycle and lists the points to avoid', () => {
    const lorry = new URL(buildGeoapifyUrl(ENDPOINT, { from: FROM, to: TO, mode: 'vracht', avoid: [[4.9405, 51.817], [4.95, 51.82]] }));
    assert.equal(lorry.searchParams.get('mode'), 'truck');
    assert.equal(lorry.searchParams.get('avoid'), 'location:51.81700,4.94050|location:51.82000,4.95000');
    assert.equal(new URL(buildGeoapifyUrl(ENDPOINT, { from: FROM, to: TO, mode: 'fiets' })).searchParams.get('mode'), 'bicycle');
  });
});

describe('parseGeoapifyResponse', () => {
  const feature = (coordinates, props = {}) => ({
    type: 'Feature',
    properties: { distance: 53076, distance_units: 'meters', time: 2543.2, ...props },
    geometry: { type: 'MultiLineString', coordinates },
  });

  it('joins the legs, keeps lon,lat and reads metres and seconds', () => {
    const json = { type: 'FeatureCollection', features: [feature([[[4.97, 51.77], [4.96, 51.8]], [[4.96, 51.8], [4.95, 52.04]]])] };
    assert.deepEqual(parseGeoapifyResponse(json), [{ coords: [[4.97, 51.77], [4.96, 51.8], [4.95, 52.04]], distanceM: 53076, durationS: 2543 }]);
  });

  it('converts miles when the answer says so', () => {
    const json = { features: [feature([[[4.97, 51.77], [4.95, 52.04]]], { distance: 10, distance_units: 'miles' })] };
    assert.equal(parseGeoapifyResponse(json)[0].distanceM, 16093);
  });

  it('drops a route with points far outside the Netherlands or broken numbers', () => {
    assert.throws(() => parseGeoapifyResponse({ features: [feature([[[4.97, 51.77], [40, 10]]])] }), (e) => e instanceof RoutingError);
    assert.throws(() => parseGeoapifyResponse({ features: [feature([[[4.97, 51.77], [4.95, 52.04]]], { time: 'x' })] }), (e) => e instanceof RoutingError);
    assert.throws(() => parseGeoapifyResponse({ error: 'x' }), (e) => e.kind === 'failed');
  });
});

describe('geoapifyError', () => {
  it('tells "no route" apart from a broken service', () => {
    assert.equal(geoapifyError(400, { statusCode: 400, error: 'Bad Request', message: 'No path could be found for input' }).kind, 'none');
    assert.equal(geoapifyError(400, { message: 'Invalid waypoints' }).kind, 'failed');
    assert.match(geoapifyError(401, null).message, /sleutel/);
    assert.match(geoapifyError(429, null).message, /druk/);
    assert.equal(geoapifyError(500, null).kind, 'failed');
  });
});
