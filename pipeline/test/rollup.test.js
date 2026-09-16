/**
 * Tests for src/rollup.js — the pass that lifts a parent situation's verdict to that of the
 * children carrying its actual closure records.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rollUpRelatedImpact } from '../src/rollup.js';

/** @param {string} id @param {string} imp @param {object} extra */
const item = (id, imp, extra = {}) => ({ id, rel: extra.rel, props: { imp, ...(extra.veh ? { veh: extra.veh } : {}) } });

test('a parent that only carries the description inherits the closure of its children', () => {
  // The real shape of RWS01_SP468092_D2: a detour + a description, two children with the closures.
  const parent = item('SP468092', 'hinder', { rel: ['SM1171623', 'SM1171624'] });
  const items = [parent, item('SM1171623', 'rijbaan'), item('SM1171624', 'hinder')];

  const stats = rollUpRelatedImpact(items);

  assert.equal(parent.props.imp, 'rijbaan');
  assert.deepEqual(stats, { raised: 1, byImpact: { rijbaan: 1 } });
});

test('the pass only ever raises: a lighter child never softens the parent', () => {
  const parent = item('P', 'dicht', { rel: ['C'] });
  rollUpRelatedImpact([parent, item('C', 'hinder')]);
  assert.equal(parent.props.imp, 'dicht');
});

test('the vehicle restriction of the winning child travels with the verdict', () => {
  // A closure that only bans lorries must not turn the parent into a closure for everyone.
  const parent = item('P', 'hinder', { rel: ['C'] });
  rollUpRelatedImpact([parent, item('C', 'dicht', { veh: ['lorry'] })]);
  assert.equal(parent.props.imp, 'dicht');
  assert.deepEqual(parent.props.veh, ['lorry']);

  // …and an unrestricted closure clears a narrower restriction the parent already had.
  const parent2 = item('P2', 'hinder', { rel: ['C2'], veh: ['bicycle'] });
  rollUpRelatedImpact([parent2, item('C2', 'dicht')]);
  assert.equal(parent2.props.imp, 'dicht');
  assert.equal('veh' in parent2.props, false);
});

test('the winning child is copied, not shared: later edits cannot leak between items', () => {
  const parent = item('P', 'hinder', { rel: ['C'] });
  const child = item('C', 'dicht', { veh: ['lorry'] });
  rollUpRelatedImpact([parent, child]);
  parent.props.veh.push('car');
  assert.deepEqual(child.props.veh, ['lorry']);
});

test('the result does not depend on the order of the list', () => {
  // `rel` is symmetric in the feed, so without a snapshot a verdict could cascade differently
  // depending on iteration order — and the output is byte-compared to decide what to upload.
  const build = () => [
    item('A', 'hinder', { rel: ['B', 'C'] }),
    item('B', 'dicht', { rel: ['A'] }),
    item('C', 'geen', { rel: ['A'] }),
  ];
  const forward = build();
  rollUpRelatedImpact(forward);
  const reversed = build().reverse();
  rollUpRelatedImpact(reversed);

  const verdicts = (list) => Object.fromEntries(list.map((i) => [i.id, i.props.imp]));
  // C rises to A's *original* 'hinder', not to the 'dicht' A itself just inherited from B: the
  // snapshot stops one closure from washing through a whole chain of related situations.
  assert.deepEqual(verdicts(forward), { A: 'dicht', B: 'dicht', C: 'hinder' });
  assert.deepEqual(verdicts(forward), verdicts([...reversed].reverse()));
});

test('a rel pointing outside the feed is ignored rather than fatal', () => {
  // 109 of the 245 parents on 2026-09-16 point at a child that is not in the current window.
  const parent = item('P', 'hinder', { rel: ['bestaat-niet', 'C'] });
  const stats = rollUpRelatedImpact([parent, item('C', 'dicht')]);
  assert.equal(parent.props.imp, 'dicht');
  assert.equal(stats.raised, 1);
});

test('items without rel are left alone and cost nothing', () => {
  const solo = item('S', 'hinder');
  const stats = rollUpRelatedImpact([solo, item('X', 'dicht')]);
  assert.equal(solo.props.imp, 'hinder');
  assert.deepEqual(stats, { raised: 0, byImpact: {} });
});

test('an unknown verdict never outranks a known one', () => {
  const parent = item('P', 'hinder', { rel: ['C'] });
  rollUpRelatedImpact([parent, item('C', 'onbekend')]);
  assert.equal(parent.props.imp, 'hinder');
});
