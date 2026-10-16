import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAIN_BST_CODES, chainLines, mainLines, roadLineFile, simplifyLine } from '../src/road-lines.js';

/** A wegvak as the NWB WFS returns it (GeoJSON, WGS 84). */
const wegvak = (bstCode, coordinates, type = 'MultiLineString') => ({
  properties: { bstCode },
  geometry: { type, coordinates: type === 'MultiLineString' ? [coordinates] : coordinates },
});

test('simplifyLine drops points within the tolerance and keeps both ends and real bends', () => {
  // A straight line with a 2 m wobble in the middle, then a 100 m bend.
  const line = [
    [5.0, 52.0],
    [5.001, 52.00001],
    [5.002, 52.0],
    [5.003, 52.001],
  ];
  const out = simplifyLine(line, 15);
  assert.deepEqual(out[0], [5.0, 52.0]);
  assert.deepEqual(out.at(-1), [5.003, 52.001]);
  assert.ok(!out.some((c) => c[0] === 5.001), 'the 1 m wobble is gone');
  assert.ok(out.some((c) => c[0] === 5.002), 'the bend stays');
  assert.deepEqual(simplifyLine([[5, 52], [5.1, 52.1]], 15), [[5, 52], [5.1, 52.1]], 'two points stay two points');
});

test('chainLines joins pieces end to end in either direction, and stops at a fork', () => {
  const a = [[5.0, 52.0], [5.1, 52.0]];
  const b = [[5.2, 52.0], [5.1, 52.0]]; // reversed: its end meets a's end
  const c = [[5.2, 52.0], [5.3, 52.0]];
  const joined = chainLines([a, b, c]);
  assert.equal(joined.length, 1);
  assert.deepEqual(joined[0], [[5.0, 52.0], [5.1, 52.0], [5.2, 52.0], [5.3, 52.0]]);

  // Three pieces meet at 5.1: none of them may swallow another.
  const fork = chainLines([a, [[5.1, 52.0], [5.1, 52.1]], [[5.1, 52.0], [5.1, 51.9]]]);
  assert.equal(fork.length, 3);
});

test('chainLines survives a closed loop and drops one-point lines', () => {
  const loop = chainLines([
    [[5.0, 52.0], [5.1, 52.0]],
    [[5.1, 52.0], [5.0, 52.0]],
    [[6, 52]],
  ]);
  assert.equal(loop.length, 1);
  assert.equal(loop[0].length, 3);
});

test('mainLines keeps the road itself and leaves ramps, parallel roads and cycle paths out', () => {
  const features = [
    wegvak('HR', [[5.0, 52.0], [5.1, 52.0]]),
    wegvak('NRB', [[5.1, 52.0], [5.2, 52.0]], 'LineString'),
    wegvak('AFR', [[5.1, 52.0], [5.1, 52.05]]),
    wegvak('PAR', [[5.0, 52.01], [5.2, 52.01]]),
    wegvak('FP', [[5.0, 52.02], [5.2, 52.02]]),
    { properties: { bstCode: 'HR' }, geometry: null },
  ];
  assert.equal(mainLines(features).length, 2);
  for (const code of ['HR', 'NRB', 'GRB']) assert.ok(MAIN_BST_CODES.includes(code));
  for (const code of ['AFR', 'OPR', 'PAR', 'PST', 'FP', 'BUS', 'PKP']) assert.ok(!MAIN_BST_CODES.includes(code));
});

test('roadLineFile chains, simplifies and rounds; null without a main carriageway', () => {
  const file = roadLineFile(
    'A2',
    [wegvak('HR', [[5.000001, 52.000001], [5.1, 52.0]]), wegvak('HR', [[5.1, 52.0], [5.2, 52.0000001]])],
    '2026-10-16',
  );
  assert.ok(file);
  assert.equal(file.road, 'A2');
  assert.match(file.source, /^NWB-Wegen \(PDOK, CC0\) 2026-10-16$/);
  assert.deepEqual(file.lines, [[[5, 52], [5.2, 52]]]);
  assert.equal(roadLineFile('N999', [wegvak('FP', [[5, 52], [5.1, 52]])], 'x'), null);
});
