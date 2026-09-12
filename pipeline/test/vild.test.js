import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { createVild, DEFAULT_VILD_PATH, loadVild } from '../src/vild.js';
import { VILD_SAMPLE } from './helpers.js';

const vild = createVild(VILD_SAMPLE);

test('lookup returns typed rows and caches them', () => {
  const row = vild.lookup(21728);
  assert.equal(row?.type, 'P3.4');
  assert.equal(row?.road, 'A7');
  assert.equal(row?.roadName, 'Afsluitdijk');
  assert.equal(row?.name1, 'Monument-Rechts');
  assert.deepEqual(row?.lonlat, [5.10789, 52.96873]);
  assert.equal(row?.linRef, 3411);
  assert.equal(row?.hectoPos, 770);
  assert.equal(vild.lookup('21728'), row);
  assert.equal(vild.lookup('nope'), undefined);
  assert.equal(vild.lookup(undefined), undefined);
  assert.equal(vild.size, Object.keys(VILD_SAMPLE).length);
});

test('route names follow linRef to the first named L row', () => {
  assert.equal(vild.routeName(21728), 'Den Oever → Knooppunt Zurich');
  assert.equal(vild.routeName(10139), 'Knooppunt Zurich → Ring-Sneek-West'); // via unnamed L3.0 3402
  assert.equal(vild.routeName(22370), 'Europaplein → Kruisdonk');
  assert.equal(vild.routeName(8888), undefined);
  assert.equal(vild.routeRow(3411)?.nr, '3411');
});

test('describe: road, roadName, from/to, direction, point', () => {
  const linear = vild.describe({ p: '10572', s: '10568', dir: 'positive' });
  assert.deepEqual(linear, {
    road: 'A9',
    from: 'Amstelveen',
    to: 'Holendrecht',
    dir: 'positive',
    route: 'Diemen → Amstelveen',
    point: [4.8793, 52.29664],
  });
  const point = vild.describe({ p: '21728', dir: 'weird' });
  assert.equal(point?.roadName, 'Afsluitdijk');
  assert.equal(point?.from, 'Monument-Rechts');
  assert.equal(point?.to, undefined);
  assert.equal(point?.dir, undefined);
  const same = vild.describe({ p: '10139', s: '10139' });
  assert.equal(same?.to, undefined);
  assert.equal(vild.describe(undefined), undefined);
  assert.equal(vild.describe({ p: '1', s: '2' }), undefined);
  const onlySecondary = vild.describe({ s: '10568' });
  assert.equal(onlySecondary?.road, 'A9');
});

test('rows() iterates every row', () => {
  const rows = [...vild.rows()];
  assert.equal(rows.length, Object.keys(VILD_SAMPLE).length);
  assert.ok(rows.some((r) => r.nr === '7031' && r.type === 'P3.2' && r.name2 === 'Eem'));
});

test('the committed static table loads and contains the documented example', { skip: !existsSync(DEFAULT_VILD_PATH) }, () => {
  const real = loadVild();
  assert.ok(real.size > 11000);
  const row = real.lookup(21728);
  assert.equal(row?.roadName, 'Afsluitdijk');
  assert.equal(real.routeName(21728), 'Den Oever → Knooppunt Zurich');
  assert.throws(() => createVild(/** @type {any} */ (null)) && loadVild('/nonexistent/vild.json'));
});
