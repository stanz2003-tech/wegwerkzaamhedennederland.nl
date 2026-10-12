/**
 * Unit tests for web/src/ui/route-card.ts (the route card's HTML, wording and Google Maps link)
 * and for the route stops in the URL (web/src/data/url-state.ts).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeCard, urlState } from './helpers/src.mjs';

const { adviceLine, besideLine, renderRouteCard, routeAnnouncement, routeHeadline, routeMapsUrl, tripDistance, tripDuration } = routeCard;
const { DEFAULT_URL_STATE, formatStopParam, parseStopParam, parseUrlState, serializeUrlState } = urlState;

const FROM = { name: 'Almkerk', lon: 4.96979, lat: 51.77115 };
const TO = { name: 'Montfoort', lon: 4.9524, lat: 52.044 };
const COORDS = Array.from({ length: 11 }, (_, i) => [4.96 + i * 0.001, 51.77 + i * 0.02]);
const NOW = Date.parse('2026-10-11T12:00:00Z');

const answer = (level, headline = 'x') => ({
  level, headline, timePhrase: '', subline: '', specifics: [], moreCount: 0, items: [], hidden: [],
  counts: { dicht: 0, rijbaan: 0, hinder: 0, geen: 0, nvt: 0, onbekend: 0 },
  closedPlaces: 0, closedRoads: 0, beyondHorizon: false, horizonMs: null,
});

const choice = (durationS, level, avoiding = false, headline = 'A27 dicht tussen Werkendam en Gorinchem') => ({
  option: { coords: COORDS, distanceM: 53_000, durationS },
  answer: answer(level, headline),
  avoiding,
  blocked: level === 'dicht' || level === 'rijbaan',
  via: avoiding ? [[4.99, 51.9]] : [],
});

const ready = (over = {}) => ({
  status: 'ready', from: FROM, to: TO, mode: 'auto', questionWhen: 'nu', departAt: NOW,
  choices: [choice(2520, 'dicht'), choice(2880, 'hinder', true, 'Doorrijden mogelijk')],
  selected: 1, recommended: 1, noClearRoute: false, beside: { count: 0, closures: [] }, updating: false, ...over,
});

describe('route card wording', () => {
  it('formats trip time and distance in Dutch', () => {
    assert.equal(tripDuration(2520), '42 min');
    assert.equal(tripDuration(6420), '1 u 47 min');
    assert.equal(tripDuration(7200), '2 u');
    assert.equal(tripDistance(53_000), '53 km');
    assert.equal(tripDistance(8_400), '8,4 km');
  });

  it('never says "geen hinder" when nothing was judged: an empty route says nothing is reported', () => {
    assert.equal(routeHeadline(answer(null)), 'Geen werkzaamheden op je route gemeld');
    assert.equal(routeHeadline(answer('geen')), 'Geen hinder op je route');
    assert.equal(routeHeadline(answer('dicht', 'A27 dicht')), 'A27 dicht');
  });

  it('explains why the slower route is recommended', () => {
    assert.match(adviceLine(ready()), /snelste route heeft een afsluiting.*\+6 min/);
    assert.equal(adviceLine(ready({ recommended: 0, selected: 0 })), '');
    assert.match(adviceLine(ready({ noClearRoute: true })), /geen route zonder afsluiting/);
  });

  it('shows the chosen route, every option and the arrival time', () => {
    const html = renderRouteCard(ready());
    assert.match(html, /Doorrijden mogelijk/);
    assert.match(html, /data-route-opt="0"/);
    assert.match(html, /data-route-opt="1" aria-pressed="true"/);
    assert.match(html, /Om de afsluiting heen · aanbevolen/);
    assert.match(html, /\+6 min/);
    assert.match(html, /aankomst ± /);
    assert.match(html, /openstreetmap\.org\/fixthemap/);
  });

  it('escapes the stop names (they come from the URL)', () => {
    const html = renderRouteCard(ready({ to: { ...TO, name: '<img src=x onerror=alert(1)>' } }));
    assert.equal(html.includes('<img'), false);
    assert.match(html, /&lt;img/);
  });

  it('has a loading and an error state with retry', () => {
    assert.match(renderRouteCard({ status: 'loading', from: FROM, to: TO, mode: 'auto' }), /Route berekenen/);
    const err = renderRouteCard({ status: 'error', from: FROM, to: TO, mode: 'fiets', message: 'Geen route gevonden.' });
    assert.match(err, /data-route-retry/);
    assert.match(err, /voor fietsers/);
  });

  it('names a closure beside the route instead of only counting it', () => {
    assert.equal(besideLine({ count: 0, closures: [] }), '');
    const line = besideLine({ count: 3, closures: ['A27 · Werkendam → Gorinchem'] });
    assert.match(line, /3 meldingen liggen naast je route/);
    assert.match(line, /Daarvan dicht: A27 · Werkendam → Gorinchem\./);
  });

  it('speaks the verdict and the travel time', () => {
    assert.equal(routeAnnouncement(ready()), "Route naar Montfoort, voor auto's: Doorrijden mogelijk. 48 minuten.");
  });
});

describe('routeMapsUrl', () => {
  it('sends the fastest route without via points, so Google weighs its own traffic', () => {
    const url = routeMapsUrl(FROM, TO, [], 'auto');
    assert.equal(url, 'https://www.google.com/maps/dir/?api=1&origin=51.77115,4.96979&destination=52.04400,4.95240&travelmode=driving');
  });

  it('sends another route with its via points, lat first', () => {
    const url = routeMapsUrl(FROM, TO, [[4.9, 51.8], [4.95, 51.9]], 'vracht');
    assert.match(url, /&waypoints=51\.80000,4\.90000%7C51\.90000,4\.95000&travelmode=driving$/);
  });

  it('asks Google for a cycling route in bicycle mode', () => {
    assert.match(routeMapsUrl(FROM, TO, [], 'fiets'), /travelmode=bicycling$/);
  });

  it('the card links the chosen route with its via points', () => {
    assert.match(renderRouteCard(ready()), /waypoints=51\.90000,4\.99000/);
    assert.equal(renderRouteCard(ready({ selected: 0 })).includes('waypoints='), false);
  });
});

describe('route stops in the URL', () => {
  it('round-trips both stops, names with commas included', () => {
    const route = { from: FROM, to: { ...TO, name: 'Lange Kerkstraat 1, 3417HK Montfoort' } };
    const qs = serializeUrlState({ ...DEFAULT_URL_STATE, route });
    assert.match(qs, /van=4\.96979,51\.77115,Almkerk/);
    assert.deepEqual(parseUrlState(`?${qs}`).route, route);
  });

  it('a route wins over road and place', () => {
    const s = parseUrlState('?weg=a27&plaats=almkerk&van=4.97,51.77,A&naar=4.95,52.04,B');
    assert.equal(s.road, null);
    assert.equal(s.place, null);
    assert.equal(s.route?.to.name, 'B');
    assert.equal(serializeUrlState({ ...s, road: 'A27' }).includes('weg='), false);
    assert.equal(parseUrlState('?q=a2&van=4.97,51.77,A&naar=4.95,52.04,B').query, '');
  });

  it('rejects malformed stops and stops far outside the Netherlands', () => {
    assert.equal(parseStopParam('abc'), null);
    assert.equal(parseStopParam('0,0,Null Island'), null);
    assert.equal(parseStopParam('4.9;51.7'), null);
    assert.equal(parseUrlState('?van=4.97,51.77,A').route, null);
  });

  it('names a stop without a name by its coordinates, and trims a long one', () => {
    assert.equal(parseStopParam('4.9,51.7')?.name, '51.7000, 4.9000');
    assert.equal(parseStopParam(`4.9,51.7,${'x'.repeat(500)}`)?.name.length, 80);
  });

  it('keeps place and address names, drops what a forged link could use to write a message', () => {
    assert.equal(parseStopParam("4.9,51.7,'s-Hertogenbosch")?.name, "'s-Hertogenbosch");
    assert.equal(parseStopParam('4.9,51.7,Lange Kerkstraat 1, 3417HK Montfoort')?.name, 'Lange Kerkstraat 1, 3417HK Montfoort');
    assert.equal(parseStopParam('4.9,51.7,Bel nu: https://x.example <b>!</b>')?.name, 'Bel nu https//x.example b/b');
    assert.equal(formatStopParam(FROM), '4.96979,51.77115,Almkerk');
  });
});
