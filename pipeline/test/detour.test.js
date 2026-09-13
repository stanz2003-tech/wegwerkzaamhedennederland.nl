import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DETOUR_MAX_POINTS, detourGeomOf, douglasPeucker, simplifyDetour, thinUniform } from '../src/detour.js';
import { NL_BBOX } from '../src/geometry.js';
import { mergeSituation } from '../src/merge.js';
import { parseFixture, parseSnippet } from './helpers.js';

const rounded5 = (n) => n === Math.round(n * 1e5) / 1e5;

test('parse: alternativeRoute lands on the rerouting record as detourLine ([lon, lat]), never in locs', async () => {
  const s = await parseFixture('rijbaan_omleiding.xml');
  const rerouting = s.recs.filter((r) => r.type === 'ReroutingManagement');
  assert.equal(rerouting.length, 1);
  const line = rerouting[0].detourLine;
  assert.ok(Array.isArray(line) && line.length > DETOUR_MAX_POINTS, 'the raw route has more than 12 points');
  for (const [lon, lat] of line) assert.ok(lon > 3 && lon < 8 && lat > 50 && lat < 54, `lat-first posList not swapped: ${lon},${lat}`);
  // the location of the rerouting record itself stays a point (where the detour starts), not the route
  assert.ok(rerouting[0].locs.every((l) => l.kind !== 'line'));
  for (const r of s.recs) if (r.type !== 'ReroutingManagement') assert.equal(r.detourLine, undefined);
});

test('parse: an itinerary of several parts is concatenated in index order; single points count too', async () => {
  const snippet = `<sit:situation id="T1"><sit:situationRecord xsi:type="sit:ReroutingManagement" id="T1_R"><sit:alternativeRoute xsi:type="loc:ItineraryByIndexedLocations">
    <loc:locationContainedInItinerary index="1"><loc:location xsi:type="loc:LinearLocation"><loc:gmlLineString><loc:posList>52.2 5.2 52.3 5.3</loc:posList></loc:gmlLineString></loc:location></loc:locationContainedInItinerary>
    <loc:locationContainedInItinerary index="0"><loc:location xsi:type="loc:PointLocation"><loc:pointByCoordinates><loc:pointCoordinates><loc:latitude>52.1</loc:latitude><loc:longitude>5.1</loc:longitude></loc:pointCoordinates></loc:pointByCoordinates></loc:location></loc:locationContainedInItinerary>
    </sit:alternativeRoute></sit:situationRecord>
    <sit:situationRecord xsi:type="sit:ReroutingManagement" id="T1_S"><sit:alternativeRoute xsi:type="loc:PointLocation"><loc:pointByCoordinates><loc:pointCoordinates><loc:latitude>52.1</loc:latitude><loc:longitude>5.1</loc:longitude></loc:pointCoordinates></loc:pointByCoordinates></sit:alternativeRoute></sit:situationRecord>
    </sit:situation>`;
  const [s] = await parseSnippet(snippet);
  assert.deepEqual(s.recs[0].detourLine, [
    [5.1, 52.1],
    [5.2, 52.2],
    [5.3, 52.3],
  ]);
  assert.equal(s.recs[1].detourLine, undefined, 'a single point is not a route');
});

test('detourGeomOf: first rerouting record with a usable route, at most 12 points, 5 decimals, first/last kept', async () => {
  const s = await parseFixture('rws_initial.xml');
  const rerouting = s.recs.filter((r) => r.type === 'ReroutingManagement');
  const first = rerouting.find((r) => r.detourLine);
  assert.ok(first && first.detourLine.length > 12);
  const geom = detourGeomOf(s.recs);
  assert.ok(geom && geom.length >= 2 && geom.length <= DETOUR_MAX_POINTS, `got ${geom?.length} points`);
  for (const [lon, lat] of geom) {
    assert.ok(rounded5(lon) && rounded5(lat), `not 5 decimals: ${lon},${lat}`);
    assert.ok(lon >= NL_BBOX[0] && lon <= NL_BBOX[2] && lat >= NL_BBOX[1] && lat <= NL_BBOX[3]);
  }
  const raw = first.detourLine;
  assert.deepEqual(geom[0], [Math.round(raw[0][0] * 1e5) / 1e5, Math.round(raw[0][1] * 1e5) / 1e5]);
  assert.deepEqual(geom.at(-1), [Math.round(raw.at(-1)[0] * 1e5) / 1e5, Math.round(raw.at(-1)[1] * 1e5) / 1e5]);
  // merge carries it as detourGeom; records without a route give nothing
  assert.deepEqual(mergeSituation(s).detourGeom, geom);
  assert.equal(detourGeomOf([{ type: 'ReroutingManagement' }, { type: 'MaintenanceWorks', detourLine: [[5, 52], [5.1, 52.1]] }]), undefined);
  assert.equal(detourGeomOf([]), undefined);
});

test('detourGeomOf: skips a rerouting record whose route falls outside NL and takes the next one', () => {
  const abroad = [[10.5, 48.2], [10.6, 48.3]];
  const home = [[5.1, 52.1], [5.2, 52.2]];
  assert.deepEqual(detourGeomOf([{ type: 'ReroutingManagement', detourLine: abroad }, { type: 'ReroutingManagement', detourLine: home }]), home);
  assert.equal(detourGeomOf([{ type: 'ReroutingManagement', detourLine: abroad }]), undefined);
});

test('simplifyDetour: clips to NL, rounds, drops consecutive duplicates, leaves short lines alone', () => {
  const line = [
    [4.123456789, 52.123456789],
    [4.123456789, 52.123456789], // duplicate after rounding
    [10.5, 48.2], // Germany → dropped
    [4.2, 52.2],
  ];
  assert.deepEqual(simplifyDetour(line), [
    [4.12346, 52.12346],
    [4.2, 52.2],
  ]);
  assert.deepEqual(simplifyDetour([]), []);
  assert.deepEqual(simplifyDetour([[10.5, 48.2]]), []);
});

test('simplifyDetour: a long, gently curving route is reduced by Douglas–Peucker to ≤ 12 points', () => {
  const line = Array.from({ length: 200 }, (_, i) => [5 + i * 0.001, 52 + Math.sin(i / 20) * 0.01]);
  const out = simplifyDetour(line);
  assert.ok(out.length >= 2 && out.length <= 12, `got ${out.length}`);
  assert.deepEqual(out[0], [5, 52]);
  assert.deepEqual(out.at(-1), [5.199, Math.round((52 + Math.sin(199 / 20) * 0.01) * 1e5) / 1e5]);
  // every kept vertex is an original (rounded) vertex, in order
  const rounded = line.map(([x, y]) => `${Math.round(x * 1e5) / 1e5},${Math.round(y * 1e5) / 1e5}`);
  let last = -1;
  for (const [x, y] of out) {
    const idx = rounded.indexOf(`${x},${y}`);
    assert.ok(idx > last, 'vertices out of order or not original');
    last = idx;
  }
  assert.equal(simplifyDetour(line, 5).length, 5);
});

test('simplifyDetour: a zigzag that Douglas–Peucker cannot reduce falls back to uniform thinning', () => {
  // 40 vertices alternating 0.3° (~33 km) north/south: no tolerance below 0.1° removes any of them
  const zigzag = Array.from({ length: 40 }, (_, i) => [4.5 + i * 0.05, i % 2 ? 52.6 : 52.3]);
  const out = simplifyDetour(zigzag);
  assert.equal(out.length, 12);
  assert.deepEqual(out[0], zigzag[0]);
  assert.deepEqual(out.at(-1), zigzag.at(-1));
});

test('douglasPeucker: collinear points collapse, corners survive, tolerance 0 keeps everything', () => {
  const straight = [[5, 52], [5.1, 52], [5.2, 52], [5.3, 52]];
  assert.deepEqual(douglasPeucker(straight, 1e-6), [[5, 52], [5.3, 52]]);
  const corner = [[5, 52], [5.1, 52], [5.1, 52.1]];
  assert.deepEqual(douglasPeucker(corner, 1e-3), corner);
  // tolerance 0 keeps every vertex that is off the chord by any amount (exactly collinear ones still go)
  const bent = [[5, 52], [5.1, 52.00001], [5.2, 52]];
  assert.deepEqual(douglasPeucker(bent, 0), bent);
  assert.deepEqual(douglasPeucker(straight, 0), [[5, 52], [5.3, 52]]);
  assert.deepEqual(douglasPeucker([[5, 52], [5, 52]], 1e-6), [[5, 52], [5, 52]]);
  // degenerate segment (first == last): the farthest point is measured from that point
  assert.deepEqual(douglasPeucker([[5, 52], [5.1, 52.1], [5, 52]], 1e-3), [[5, 52], [5.1, 52.1], [5, 52]]);
});

test('thinUniform: evenly spaced, first and last always kept', () => {
  const line = Array.from({ length: 25 }, (_, i) => [i, i]);
  const out = thinUniform(line, 12);
  assert.equal(out.length, 12);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out.at(-1), [24, 24]);
  assert.deepEqual(thinUniform(line, 30), line);
  assert.deepEqual(thinUniform(line, 1), [[0, 0], [24, 24]]);
});
