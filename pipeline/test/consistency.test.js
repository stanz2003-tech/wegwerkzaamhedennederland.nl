import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annotateConsistency, checkItem, gevolgOf, VISIBLE_CHECKS } from '../src/consistency.js';

const MERWEDEBRUG = 'Langdurige afsluiting fietspad Merwedebrug westzijde i.v.m. met de bouw van de nieuwe brug.';

test('gevolgOf finds the Melvin label among the comments, verbatim, the heaviest first', () => {
  assert.deepEqual(gevolgOf(['Projectmelding tbv reconstructie Banneweg', 'Omleiding 1\nWeg dicht in beide richtingen']), {
    key: 'weg dicht in beide richtingen',
    text: 'Weg dicht in beide richtingen',
  });
  assert.deepEqual(gevolgOf(['Geen gevolgen voor verkeer.', 'Weg dicht in een richting']), {
    key: 'weg dicht in een richting',
    text: 'Weg dicht in een richting',
  });
  assert.equal(gevolgOf(['Het fietspad is dicht', undefined]), undefined);
  // Only the whole line counts: a sentence that contains the words is prose.
  assert.equal(gevolgOf(['Let op: weg dicht in beide richtingen tot vrijdag']), undefined);
});

test('the Merwedebrug: a cycle-path text under "dicht voor auto\'s" gets a visible note, the verdict stays', () => {
  const checks = checkItem({ imp: 'dicht', veh: ['car'], texts: [MERWEDEBRUG, 'Omleiding 1'] });
  assert.deepEqual(checks, [{ c: 'tekst-fietspad', q: MERWEDEBRUG.replace(/\.$/, '') }]);
  assert.ok(VISIBLE_CHECKS.has('tekst-fietspad'));
});

test('a road closure that merely mentions cyclists is not a cycle-path conflict', () => {
  const roadTexts = [
    'Wegafsluiting tbv nutsaansluitingen met omleiding voor fietsers en voetgangers.',
    'Verkeersbelemmering: Algemeen - rijbaan dicht muv fietsers en voetgangers',
    'Het voetpad, fietspad, parkeervakken en de rijbaan worden afgezet.',
  ];
  for (const text of roadTexts) assert.deepEqual(checkItem({ imp: 'dicht', texts: [text] }), [], text);
  // Melvin's own "Weg dicht in beide richtingen" says the road, whatever the prose adds.
  assert.deepEqual(checkItem({ imp: 'dicht', texts: [MERWEDEBRUG], gevolg: { key: 'weg dicht in beide richtingen', text: 'Weg dicht in beide richtingen' } }), []);
  // A path closure that is called off is not one (AND01, Jupiterweg Leeuwarden).
  assert.deepEqual(checkItem({ imp: 'dicht', veh: ['car'], texts: ['Afsluiting fietspad komt bij deze kabeltrek te vervallen'] }), []);
  // Not for cars anyway: nothing to warn a driver about.
  assert.deepEqual(checkItem({ imp: 'dicht', veh: ['bicycle'], texts: [MERWEDEBRUG] }), []);
});

test('a verdict read from the label or the text is explained with its source', () => {
  const gevolg = { key: 'weg dicht in beide richtingen', text: 'Weg dicht in beide richtingen' };
  assert.deepEqual(checkItem({ imp: 'dicht', by: 'gevolg', gevolg, texts: [] }), [{ c: 'gevolg-dicht', q: 'Weg dicht in beide richtingen' }]);
  const a15 = 'De A15 is afgesloten tussen Gorinchem en Deil. Verkeer wordt omgeleid via A27-A59-A2.';
  assert.deepEqual(checkItem({ imp: 'rijbaan', by: 'tekst', texts: [a15] }), [{ c: 'tekst-dicht', q: 'De A15 is afgesloten tussen Gorinchem en Deil' }]);
});

test('a label that contradicts a published closure is shown; the closure is kept', () => {
  const geen = { key: 'geen gevolgen voor verkeer', text: 'Geen gevolgen voor verkeer' };
  assert.deepEqual(checkItem({ imp: 'dicht', gevolg: geen, texts: [] }), [{ c: 'gevolg-geen', q: 'Geen gevolgen voor verkeer' }]);
  const langzaam = { key: 'beperking voor langzaam verkeer', text: 'Beperking voor langzaam verkeer' };
  assert.deepEqual(checkItem({ imp: 'dicht', gevolg: langzaam, texts: [] }), [{ c: 'gevolg-langzaam', q: 'Beperking voor langzaam verkeer' }]);
  assert.deepEqual(checkItem({ imp: 'dicht', veh: ['bicycle'], gevolg: langzaam, texts: [] }), []);
  assert.deepEqual(checkItem({ imp: 'hinder', gevolg: geen, texts: [] }), []);
});

test('report-only checks: label vs vehicle list, hinder class, a speed only the text names', () => {
  const dicht = { key: 'weg dicht in beide richtingen', text: 'Weg dicht in beide richtingen' };
  assert.deepEqual(checkItem({ imp: 'dicht', veh: ['bicycle'], gevolg: dicht, texts: [] }), [{ c: 'gevolg-fiets', q: 'Weg dicht in beide richtingen' }]);
  assert.deepEqual(checkItem({ imp: 'dicht', hind: 'E', texts: [] }), [{ c: 'hinderklasse', q: 'E' }]);
  assert.deepEqual(checkItem({ imp: 'hinder', texts: ['A2 Snelheidsbeperking 90 km/uur'] }), [{ c: 'snelheid', q: '90 km/u' }]);
  assert.deepEqual(checkItem({ imp: 'hinder', spd: 90, texts: ['A2 Snelheidsbeperking 90 km/uur'] }), []);
  for (const c of ['gevolg-fiets', 'hinderklasse', 'snelheid']) assert.equal(VISIBLE_CHECKS.has(c), false, c);
});

test('annotateConsistency writes only visible checks to the detail and counts every check', () => {
  const item = (id, props, qa) => ({ id, props: { id, ...props }, detail: { id }, qa });
  const items = [
    item('merwede', { imp: 'dicht', veh: ['car'], hind: 'E' }, { texts: [MERWEDEBRUG] }),
    item('a2', { imp: 'hinder' }, { texts: ['Snelheidsbeperking 90 km/uur'] }),
    item('clean', { imp: 'dicht' }, { texts: ['Weg dicht'] }),
  ];
  const report = annotateConsistency(items);
  assert.deepEqual(items[0].detail.chk, [{ c: 'tekst-fietspad', q: MERWEDEBRUG.replace(/\.$/, '') }]);
  assert.equal(items[1].detail.chk, undefined);
  assert.equal(items[2].detail.chk, undefined);
  assert.deepEqual(report.counts, { 'tekst-fietspad': 1, hinderklasse: 1, snelheid: 1 });
  assert.deepEqual(report.ids['tekst-fietspad'], ['merwede']);
  assert.equal(items[0].qa, undefined, 'the working copy of the texts is dropped');
});

test('a verdict raised later by a related closure record is not explained as read from the words', () => {
  const item = { id: 'a6', props: { id: 'a6', imp: 'dicht' }, detail: { id: 'a6' }, qa: { texts: ['De A6 is dicht.'], by: 'tekst', imp: 'rijbaan' } };
  annotateConsistency([item]);
  assert.equal(item.detail.chk, undefined);
  const same = { id: 'b', props: { id: 'b', imp: 'rijbaan' }, detail: { id: 'b' }, qa: { texts: ['De A6 is dicht.'], by: 'tekst', imp: 'rijbaan' } };
  annotateConsistency([same]);
  assert.deepEqual(same.detail.chk, [{ c: 'tekst-dicht', q: 'De A6 is dicht' }]);
});

test('"afsluiting van de weg en het fietspad" is a road closure, not a cycle-path conflict', () => {
  assert.deepEqual(checkItem({ imp: 'dicht', texts: ['Afsluiting van de weg en het fietspad i.v.m. riolering.'] }), []);
});

test('a hand-corrected item says so first, and its old conflict is gone', () => {
  const reden = 'Wij hebben de afsluiting op fietsers gezet.';
  const item = { id: 'm', props: { id: 'm', imp: 'dicht', veh: ['bicycle'] }, detail: { id: 'm' }, correction: reden, qa: { texts: [MERWEDEBRUG] } };
  const report = annotateConsistency([item]);
  assert.deepEqual(item.detail.chk, [{ c: 'correctie', q: reden }]);
  assert.equal(report.counts.correctie, 1);
});
