import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCorrections, loadCorrections } from '../src/corrections.js';

const ID = 'AND01_C1020D9C0FA84C228DBBA388E93364CB';
const VER = '2026-05-14T19:00:22Z';
const MERWEDE = {
  id: ID,
  ver: VER,
  van: ['car'],
  naar: ['bicycle'],
  reden: 'De wegbeheerder schrijft zelf "afsluiting fietspad Merwedebrug westzijde".',
};

/** The Merwedebrug situation as Waterschap Rivierenland publishes it (records reduced). */
const situation = (ver = VER, vehicles = ['car']) => ({
  id: ID,
  ver,
  recs: [
    { id: `${ID}_BASE`, type: 'MaintenanceWorks', locs: [] },
    { id: `${ID}_BC5E`, type: 'RoadOrCarriagewayOrLaneManagement', lane: 'roadClosed', vehicles, locs: [] },
    { id: `${ID}_AB`, type: 'ReroutingManagement', vehicles: ['bicycle'], locs: [] },
  ],
});

test('a correction rewrites the vehicle list of the closure it names, on a copy', () => {
  const corrections = createCorrections([MERWEDE]);
  const original = situation();
  const { situation: fixed, reden } = corrections.apply(original);
  assert.deepEqual(fixed.recs[1].vehicles, ['bicycle']);
  assert.deepEqual(fixed.recs[2].vehicles, ['bicycle'], 'the detour is left alone');
  assert.equal(reden, MERWEDE.reden);
  assert.deepEqual(original.recs[1].vehicles, ['car'], 'the parsed situation is not mutated');
  assert.deepEqual(corrections.stats(), { applied: [ID], expired: [] });
});

test('a correction expires as soon as the publisher changes the melding', () => {
  // A new version: whatever the publisher changed, the correction no longer knows it.
  const newer = createCorrections([MERWEDE]);
  const v2 = newer.apply(situation('2026-11-01T08:00:00Z'));
  assert.deepEqual(v2.situation.recs[1].vehicles, ['car']);
  assert.equal(v2.reden, undefined);
  assert.deepEqual(newer.stats(), { applied: [], expired: [ID] });

  // Same version but the closure no longer reads ['car'] (fixed at the source): nothing to do.
  const fixedAtSource = createCorrections([MERWEDE]);
  const same = fixedAtSource.apply(situation(VER, ['bicycle']));
  assert.equal(same.reden, undefined);
  assert.deepEqual(fixedAtSource.stats(), { applied: [], expired: [ID] });
});

test('other situations pass untouched and a correction never seen is not reported as expired', () => {
  const corrections = createCorrections([MERWEDE]);
  const other = { id: 'X', ver: VER, recs: [] };
  assert.equal(corrections.apply(other).situation, other);
  assert.deepEqual(corrections.stats(), { applied: [], expired: [] });
});

test('the committed correction file is valid', () => {
  const list = loadCorrections();
  assert.ok(list.length >= 1);
  for (const c of list) {
    assert.match(c.id, /^\S+$/);
    assert.ok(!Number.isNaN(Date.parse(c.ver)), `${c.id}: ver`);
    assert.ok(Array.isArray(c.van) && c.van.length > 0 && Array.isArray(c.naar) && c.naar.length > 0, `${c.id}: van/naar`);
    assert.ok(c.reden.length > 20, `${c.id}: reden`);
  }
  assert.throws(() => createCorrections([{ ...MERWEDE, naar: [] }]), /naar/);
});
