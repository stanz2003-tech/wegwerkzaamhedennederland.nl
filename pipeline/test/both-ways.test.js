import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_APART_M, raiseBothWayPairs } from '../src/both-ways.js';

/** One finalized item: a one-direction closure on the N57 at Dampoort, unless overridden. */
function item(id, dir, over = {}) {
  return {
    id,
    mid: over.mid ?? [3.6, 51.52],
    props: { imp: 'rijbaan', road: 'N57', start: '2026-11-25T19:00Z', end: '2026-11-26T05:00Z', ...(over.props ?? {}) },
    detail: { dir, ...(over.detail ?? {}) },
    qa: { texts: [] },
  };
}

test('two one-direction closures, same road, same times, same place, opposite directions → both dicht', () => {
  // Arrange
  const a = item('RWS01_A', 'positive');
  const b = item('RWS01_B', 'negative');

  // Act
  const result = raiseBothWayPairs([a, b]);

  // Assert
  assert.deepEqual(result, { raised: 2 });
  assert.equal(a.props.imp, 'dicht');
  assert.equal(b.props.imp, 'dicht');
  assert.equal(a.qa.pair, 'RWS01_B');
  assert.equal(b.qa.pair, 'RWS01_A');
});

test('the one-direction stretches of the timeline are raised too; other stretches keep their verdict', () => {
  const tl = () => [
    ['2026-11-25T19:00Z', '2026-11-25T21:00Z', 'hinder'],
    ['2026-11-25T21:00Z', '2026-11-26T05:00Z', 'rijbaan'],
  ];
  const a = item('A', 'positive', { detail: { tl: tl() } });
  const b = item('B', 'negative', { detail: { tl: tl() } });
  raiseBothWayPairs([a, b]);
  assert.deepEqual(a.detail.tl, [
    ['2026-11-25T19:00Z', '2026-11-25T21:00Z', 'hinder'],
    ['2026-11-25T21:00Z', '2026-11-26T05:00Z', 'dicht'],
  ]);
});

test('mirrored stretch names count as the same place, however far the midpoints lie apart', () => {
  const a = item('A', 'positive', { mid: [3.6, 51.52], detail: { from: 'Gapinge', to: 'Arnestein' } });
  const b = item('B', 'negative', { mid: [3.7, 51.6], detail: { from: 'Arnestein', to: 'Gapinge' } });
  assert.equal(raiseBothWayPairs([a, b]).raised, 2);
});

test('not a pair: same direction, another road, other times, another place, or a closure for some vehicles', () => {
  const far = [3.6, 51.52 + (MAX_APART_M * 3) / 111_320];
  const cases = {
    'same direction': [item('A', 'positive'), item('B', 'positive')],
    'another road': [item('A', 'positive'), item('B', 'negative', { props: { road: 'A58' } })],
    'another end': [item('A', 'positive'), item('B', 'negative', { props: { end: '2026-11-26T06:00Z' } })],
    'other working periods': [item('A', 'positive'), item('B', 'negative', { detail: { periods: [['2026-11-25T19:00Z', '2026-11-25T23:00Z']] } })],
    'another place': [item('A', 'positive'), item('B', 'negative', { mid: far })],
    'for lorries only': [item('A', 'positive'), item('B', 'negative', { props: { veh: ['lorry'] } })],
    'no direction': [item('A', 'positive'), item('B', undefined)],
    'already heavier or lighter': [item('A', 'positive'), item('B', 'negative', { props: { imp: 'hinder' } })],
  };
  for (const [name, pair] of Object.entries(cases)) {
    assert.deepEqual(raiseBothWayPairs(pair), { raised: 0 }, name);
    assert.equal(pair[0].props.imp, 'rijbaan', name);
    assert.equal(pair[0].qa.pair, undefined, name);
  }
});

test('a third closure in the same direction at the same place is raised along with its twin', () => {
  const items = [item('A', 'positive'), item('B', 'negative'), item('C', 'positive')];
  assert.equal(raiseBothWayPairs(items).raised, 3);
  assert.deepEqual(items.map((i) => i.props.imp), ['dicht', 'dicht', 'dicht']);
});

test('a closed ramp that a related situation raised to "one direction" is never half of a pair', () => {
  const a = item('A', 'positive', { props: { sub: 'entrySlipRoadClosed' } });
  const b = item('B', 'negative');
  assert.deepEqual(raiseBothWayPairs([a, b]), { raised: 0 });
});
