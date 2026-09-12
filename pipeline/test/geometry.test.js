import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bboxOf, buildGeometry, inNl, midpoint, NL_BBOX, parsePosList, round5, roundCoord } from '../src/geometry.js';
import { createVild } from '../src/vild.js';
import { VILD_SAMPLE } from './helpers.js';

const vild = createVild(VILD_SAMPLE);
const vildPoint = (a) => vild.point(a.p) ?? vild.point(a.s);

test('posList is lat-first and becomes [lon, lat]', () => {
  assert.deepEqual(parsePosList('52.1 4.9 52.2 5.0'), [
    [4.9, 52.1],
    [5.0, 52.2],
  ]);
  assert.deepEqual(parsePosList(' 52.1   4.9 '), [[4.9, 52.1]]);
  assert.deepEqual(parsePosList('52.1 4.9 53'), [[4.9, 52.1]]);
  assert.deepEqual(parsePosList('abc'), []);
});

test('rounding to 5 decimals', () => {
  assert.equal(round5(4.9473721234), 4.94737);
  assert.deepEqual(roundCoord([5.123456789, 52.987654321]), [5.12346, 52.98765]);
});

test('bbox membership', () => {
  assert.equal(inNl([5, 52]), true);
  assert.equal(inNl([3.31, 47.97]), false);
  assert.deepEqual([...NL_BBOX], [3.2, 50.5, 7.3, 53.7]);
});

test('single line → LineString, rounded, consecutive duplicates removed', () => {
  const { geometry, dropped } = buildGeometry([
    { kind: 'line', line: [[4.9473721, 52.2860171], [4.947372, 52.286017], [4.9455, 52.286]] },
  ]);
  assert.deepEqual(geometry, { type: 'LineString', coordinates: [[4.94737, 52.28602], [4.9455, 52.286]] });
  assert.equal(dropped, 0);
});

test('several distinct lines → MultiLineString; identical lines de-duplicated', () => {
  const a = [[4.9, 52.1], [4.95, 52.15]];
  const b = [[5.1, 52.3], [5.2, 52.4], [5.3, 52.5]];
  const { geometry } = buildGeometry([
    { kind: 'line', line: a },
    { kind: 'line', line: a },
    { kind: 'line', line: b },
  ]);
  assert.equal(geometry?.type, 'MultiLineString');
  assert.equal(geometry?.coordinates.length, 2);
});

test('lines win over points; points used when there is no line', () => {
  const both = buildGeometry([
    { kind: 'point', point: [4.9, 52.1] },
    { kind: 'line', line: [[4.9, 52.1], [4.95, 52.15]] },
  ]);
  assert.equal(both.geometry?.type, 'LineString');
  const onlyPoint = buildGeometry([{ kind: 'point', point: [4.9123456, 52.1] }]);
  assert.deepEqual(onlyPoint.geometry, { type: 'Point', coordinates: [4.91235, 52.1] });
});

test('vertices outside NL are clipped and counted; whole line outside is dropped', () => {
  const clipped = buildGeometry([{ kind: 'line', line: [[3.31, 47.97], [4.9, 52.1], [4.95, 52.15]] }]);
  assert.deepEqual(clipped.geometry?.coordinates, [[4.9, 52.1], [4.95, 52.15]]);
  assert.equal(clipped.dropped, 1);
  const gone = buildGeometry([{ kind: 'line', line: [[3.31, 47.97], [3.32, 47.98]] }]);
  assert.equal(gone.geometry, null);
  assert.equal(gone.dropped, 1);
  const pointOutside = buildGeometry([{ kind: 'point', point: [10, 48] }]);
  assert.equal(pointOutside.geometry, null);
  assert.equal(pointOutside.dropped, 1);
});

test('AlertC-only records fall back to the VILD point of the primary location', () => {
  const r = buildGeometry([{ kind: 'alertc', alertC: { p: '22370', dir: 'positive' } }], vildPoint);
  assert.deepEqual(r.geometry, { type: 'Point', coordinates: [5.71723, 50.84086] });
  assert.equal(r.fallback, true);
  const secondary = buildGeometry([{ kind: 'alertc', alertC: { p: '8888', s: '10568' } }], vildPoint);
  assert.deepEqual(secondary.geometry?.coordinates, [4.94287, 52.29207]);
  const outside = buildGeometry([{ kind: 'alertc', alertC: { p: '9999' } }], vildPoint);
  assert.equal(outside.geometry, null);
  const unknown = buildGeometry([{ kind: 'alertc', alertC: { p: '1' } }], vildPoint);
  assert.equal(unknown.geometry, null);
  const noResolver = buildGeometry([{ kind: 'alertc', alertC: { p: '22370' } }]);
  assert.equal(noResolver.geometry, null);
});

test('midpoint: point itself, half-length of a line, longest part of a multi line', () => {
  assert.deepEqual(midpoint({ type: 'Point', coordinates: [5, 52] }), [5, 52]);
  assert.deepEqual(midpoint({ type: 'LineString', coordinates: [[4, 52], [6, 52]] }), [5, 52]);
  assert.deepEqual(midpoint({ type: 'LineString', coordinates: [[4, 52], [4.5, 52], [6, 52]] }), [5, 52]);
  const multi = midpoint({ type: 'MultiLineString', coordinates: [[[4, 52], [4.1, 52]], [[6, 53], [7, 53]]] });
  assert.deepEqual(multi, [6.5, 53]);
  assert.deepEqual(midpoint({ type: 'LineString', coordinates: [[4, 52]] }), [4, 52]);
});

test('bboxOf', () => {
  assert.deepEqual(bboxOf({ type: 'Point', coordinates: [5, 52] }), [5, 52, 5, 52]);
  assert.deepEqual(bboxOf({ type: 'LineString', coordinates: [[4, 51], [6, 53]] }), [4, 51, 6, 53]);
  assert.deepEqual(bboxOf({ type: 'MultiLineString', coordinates: [[[4, 51], [5, 52]], [[6, 53], [3.5, 50.6]]] }), [3.5, 50.6, 6, 53]);
});
