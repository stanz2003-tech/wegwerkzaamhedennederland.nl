import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clean, mergeSituation } from '../src/merge.js';
import { parseFixture } from './helpers.js';

test('RWS planning: parent supplies period/source/status, children supply lanes/speed', async () => {
  const m = mergeSituation(await parseFixture('rws_plan.xml'));
  assert.equal(m.mainType, 'MaintenanceWorks');
  assert.equal(m.start, '2026-08-28T09:05:31Z');
  assert.equal(m.end, '2026-09-18T14:00:00Z');
  assert.equal(m.src, 'NN-W [RWS Noord-Nederland District West]');
  assert.equal(m.status, 'running');
  assert.equal(m.prob, 'certain');
  assert.equal(m.works, 'resurfacingWork');
  assert.deepEqual(m.lanes, { closed: 0, open: 1, total: 1 });
  assert.equal(m.speed, 30);
  assert.equal(m.delay, 'upToTenMinutes');
  assert.equal(m.delaySec, 300);
  assert.equal(m.queueM, undefined);
  assert.deepEqual(m.alertC, { p: '10139', s: '10139', dir: 'negative', pOff: 100, sOff: 100 });
  assert.equal(m.periods, undefined);
  assert.equal(m.comment, undefined);
  assert.equal(m.upd, '2026-08-28T09:05:35Z');
  assert.ok(m.locations.length >= 2);
  assert.equal(m.locations[0].kind, 'line');
});

test('Melvin: warning comment → title input, other comments → desc, urls, detours, hindrance', async () => {
  const m = mergeSituation(await parseFixture('melvin_multi.xml'));
  assert.equal(m.comment, 'Weg dicht in een richting');
  assert.equal(m.desc, 'Contactinformatie: Coen Lauwers, Heijmans Infra BV, clauwers@heijmans.nl');
  assert.equal(m.causeDesc, 'Asfalteringswerkzaamheden, , PCMN-Z');
  assert.equal(m.hind, 'C');
  assert.equal(m.status, 'published');
  assert.equal(m.url, 'https://melvin.ndw.nu/attachment/0f1b1f15-b435-4955-a4a2-08768810c47d');
  assert.equal(m.detour, 'Omleiding 1\nOmleiding 2');
  assert.equal(m.works, 'resurfacingWork');
  // raw pass-through of sit:roadOrJunctionNumber; roads.js decides whether it is a usable road number
  assert.equal(m.roadNr, '002 Rijksweg 2');
  assert.ok(!JSON.stringify(m).includes('internalNote'));
  // rerouting record locations are not part of the item geometry
  assert.ok(m.locations.every((l) => l.kind !== 'alertc' || l.alertC));
});

test('single period equal to the overall window is dropped; distinct periods kept sorted', async () => {
  const and01 = mergeSituation(await parseFixture('and01.xml'));
  assert.equal(and01.periods, undefined);
  assert.equal(and01.comment?.startsWith('Vanuit het Raamcontract'), true);
  assert.equal(and01.desc, undefined);
  assert.equal(and01.speed, 30);
  assert.equal(and01.hind, 'E');
  assert.equal(and01.works, 'installationWork');
  const s = {
    id: 'P',
    recs: [
      {
        id: 'P_1',
        type: 'MaintenanceWorks',
        start: '2026-09-01T00:00:00Z',
        end: '2026-09-30T00:00:00Z',
        periods: [
          ['2026-09-20T20:00:00Z', '2026-09-21T05:00:00Z'],
          ['2026-09-10T20:00:00Z', '2026-09-11T05:00:00Z'],
        ],
        locs: [],
      },
    ],
  };
  assert.deepEqual(mergeSituation(s).periods, [
    ['2026-09-10T20:00:00Z', '2026-09-11T05:00:00Z'],
    ['2026-09-20T20:00:00Z', '2026-09-21T05:00:00Z'],
  ]);
});

test('files: queue/delay from the AbnormalTraffic record; open end stays open', async () => {
  const m = mergeSituation(await parseFixture('abnormal.xml'));
  assert.equal(m.queueM, 3600);
  assert.equal(m.delaySec, 555);
  assert.equal(m.delay, 'upToTenMinutes');
  assert.equal(m.end, undefined);
  assert.equal(m.alertC?.p, '10572');
});

test('start = min over records, end = max when the main record has an end; vehicles and roadNr from children', () => {
  const s = {
    id: 'S',
    ver: '2026-09-01T00:00:00Z',
    recs: [
      { id: 'S_1', type: 'MaintenanceWorks', start: '2026-09-02T00:00:00Z', end: '2026-09-03T00:00:00Z', src: 'Gemeente X', locs: [] },
      { id: 'S_2', type: 'ReroutingManagement', start: '2026-09-01T00:00:00Z', end: '2026-09-04T00:00:00Z', roadNr: 'N33', vehicles: ['lorry', 'bus'], detour: 'Volg de borden', locs: [] },
      { id: 'S_3', type: 'ReroutingManagement', vehicles: ['bus'], detour: 'Volg de borden', urls: ['https://example.org'], locs: [] },
    ],
  };
  const m = mergeSituation(s);
  assert.equal(m.start, '2026-09-01T00:00:00Z');
  assert.equal(m.end, '2026-09-04T00:00:00Z');
  assert.deepEqual(m.vehicles, ['lorry', 'bus']);
  assert.equal(m.roadNr, 'N33');
  assert.equal(m.detour, 'Volg de borden');
  assert.equal(m.url, 'https://example.org');
  assert.equal(m.src, 'Gemeente X');
  assert.equal(m.lanes, undefined);
  assert.equal(m.works, undefined);
});

test('a situation without records still merges', () => {
  const m = mergeSituation({ id: 'E', recs: [] });
  assert.equal(m.id, 'E');
  assert.equal(m.mainType, 'Unknown');
  assert.deepEqual(m.locations, []);
});

test('clean strips HTML, decodes entities, collapses whitespace, caps description', () => {
  assert.equal(clean('<p>Hallo&nbsp;<b>wereld</b></p><br/>K&amp;L  werk'), 'Hallo wereld\nK&L werk');
  assert.equal(clean('   '), undefined);
  assert.equal(clean(undefined), undefined);
  assert.equal(clean('a\r\n\n\n\nb'), 'a\nb');
  assert.equal(clean('<div>een</div><li>twee</li>'), 'een\ntwee');
  const long = mergeSituation({
    id: 'L',
    recs: [{ id: 'L_1', type: 'MaintenanceWorks', comments: [{ type: 'other', text: 'x'.repeat(3000) }], locs: [] }],
  });
  assert.equal(long.desc?.length, 2000);
  assert.ok(long.desc?.endsWith('…'));
});
