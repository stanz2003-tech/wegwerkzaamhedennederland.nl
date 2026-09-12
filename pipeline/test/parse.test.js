import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeed, wrapFixture } from '../src/parse.js';
import { chunked, fixture, parseFixture, parseSnippet } from './helpers.js';

test('parses record types, ids, versions and severity', async () => {
  const s = await parseFixture('rws_plan.xml');
  assert.equal(s.id, 'RWS01_SM1172098_D2');
  assert.equal(s.sev, 'medium');
  assert.equal(s.ver, '2026-08-28T09:05:35Z');
  assert.deepEqual(
    s.recs.map((r) => r.type),
    ['MaintenanceWorks', 'SpeedManagement', 'RoadOrCarriagewayOrLaneManagement', 'RoadOrCarriagewayOrLaneManagement'],
  );
  const main = s.recs[0];
  assert.equal(main.id, 'RWS01_M1172098_MAIN_ROADWORKS_D2');
  assert.equal(main.maint, 'resurfacingWork');
  assert.equal(main.status, 'running');
  assert.equal(main.prob, 'certain');
  assert.equal(main.src, 'NN-W [RWS Noord-Nederland District West]');
  assert.equal(main.start, '2026-08-28T09:05:31Z');
  assert.equal(main.end, '2026-09-18T14:00:00Z');
  assert.equal(main.delayBand, 'upToTenMinutes');
  assert.equal(main.delaySec, 300);
  assert.equal(s.recs[1].speed, 30);
  assert.equal(s.recs[1].speedType, 'speedRestrictionInOperation');
  assert.equal(s.recs[2].lane, 'laneClosures');
  assert.equal(s.recs[2].lanesRestricted, 0);
  assert.equal(s.recs[2].lanesOperational, 1);
  assert.equal(s.recs[2].locs[0].lanesTotal, 1);
  assert.equal(s.recs[3].lane, 'lanesDeviated');
});

test('publication time is captured from the container', async () => {
  let count = 0;
  const result = await parseFeed(chunked(wrapFixture(fixture('afsl.xml')), 97), () => {
    count++;
  });
  assert.equal(result.publicationTime, '2026-09-08T16:00:00Z');
  assert.equal(result.count, 1);
  assert.equal(count, 1);
});

test('comments: warning/other kept in order, internalNote never emitted', async () => {
  const s = await parseFixture('and01.xml');
  const main = s.recs[0];
  assert.ok(main.comments);
  assert.deepEqual(
    main.comments.map((c) => c.type),
    ['warning'],
  );
  assert.ok(main.comments[0].text.startsWith('Vanuit het Raamcontract'));
  assert.ok(!JSON.stringify(s).includes('internalNote'));
  assert.ok(!JSON.stringify(s).includes('Slaperdijkweg K&L'));
  assert.equal(main.hind, 'E');
  assert.equal(main.subject, 'buriedCables');
  assert.equal(main.causeDesc, 'Leggen van kabels en leidingen');
  assert.equal(main.cause, 'other');
});

test('comments without commentType count as public "other"', async () => {
  const s = await parseFixture('srti.xml');
  assert.deepEqual(s.recs[0].comments, [{ type: 'other', text: 'Pijlwagen' }]);
  assert.equal(s.recs[0].vehObs, 'other');
  assert.equal(s.recs[0].mobility, 'stationary');
});

test('validity periods and multi-value Melvin situation', async () => {
  const s = await parseFixture('melvin_multi.xml');
  const main = s.recs[0];
  assert.equal(main.type, 'MaintenanceWorks');
  assert.deepEqual(main.periods, [['2026-09-24T19:00:00Z', '2026-09-25T03:00:00Z']]);
  assert.equal(main.urls?.length, 5);
  assert.equal(main.urls?.[0], 'https://melvin.ndw.nu/attachment/0f1b1f15-b435-4955-a4a2-08768810c47d');
  assert.equal(main.comments?.length, 2);
  assert.equal(main.comments?.[0].type, 'warning');
  assert.equal(main.comments?.[1].type, 'other');
  const detours = s.recs.filter((r) => r.type === 'ReroutingManagement');
  assert.equal(detours.length, 2);
  assert.ok(detours[0].detour);
});

test('alertC linear + line geometry in one itinerary, lat/lon swapped', async () => {
  const s = await parseFixture('abnormal.xml');
  const rec = s.recs[0];
  assert.equal(rec.type, 'AbnormalTraffic');
  assert.equal(rec.traffic, 'stationaryTraffic');
  assert.equal(rec.queue, 3600);
  assert.equal(rec.delaySec, 555);
  assert.equal(rec.delayBand, 'upToTenMinutes');
  assert.equal(rec.end, undefined);
  assert.equal(rec.locs.length, 2);
  assert.equal(rec.locs[0].kind, 'line');
  assert.deepEqual(rec.locs[0].line?.[0], [4.947372, 52.286017]);
  assert.equal(rec.locs[1].kind, 'alertc');
  assert.deepEqual(rec.locs[1].alertC, { p: '10572', s: '10568', dir: 'positive', pOff: 1289, sOff: 2011 });
});

test('alertC point only (no coordinates) is kept as alertc location', async () => {
  const s = await parseFixture('alertonly.xml');
  assert.equal(s.recs[0].locs.length, 1);
  assert.equal(s.recs[0].locs[0].kind, 'alertc');
  assert.equal(s.recs[0].locs[0].alertC?.p, '22370');
  assert.equal(s.recs[0].locs[0].alertC?.dir, 'positive');
  assert.deepEqual(s.rel, ['RWS01_SM1139403_D2']);
});

test('RIS code and point for bridges', async () => {
  const s = await parseFixture('bridge.xml');
  const loc = s.recs[0].locs[0];
  assert.equal(s.recs[0].gnm, 'bridgeSwingInOperation');
  assert.equal(loc.kind, 'point');
  assert.equal(loc.ris, 'NLHAR000220358500022');
  assert.deepEqual(loc.point, [5.4436, 53.177433]);
});

test('accident point with bearing and unknown extension elements', async () => {
  const s = await parseFixture('accident.xml');
  assert.equal(s.recs[0].accident, 'other');
  assert.deepEqual(s.recs[0].locs[0].point, [6.9176493, 52.197468]);
});

test('alternativeRoute of rerouting records is never parsed as a location', async () => {
  const s = await parseFixture('rws_initial.xml');
  const rerouting = s.recs.filter((r) => r.type === 'ReroutingManagement');
  assert.ok(rerouting.length >= 2);
  for (const r of rerouting) {
    assert.ok(r.locs.length <= 1);
    assert.ok(r.locs.every((l) => l.kind === 'point'));
  }
  assert.equal(rerouting[0].rerouteType, 'followDiversionSigns');
});

test('unknown elements, missing values and multiple situations are tolerated', async () => {
  const xml =
    '<sit:situation id="X1"><sit:overallSeverity>high</sit:overallSeverity><sit:weird><sit:deeper>1</sit:deeper></sit:weird>' +
    '<sit:situationRecord xsi:type="sit:FutureType" id="X1_1" version="1"><sit:probabilityOfOccurrence>certain</sit:probabilityOfOccurrence>' +
    '<sit:locationReference xsi:type="loc:AreaLocation"><loc:something/></sit:locationReference></sit:situationRecord></sit:situation>' +
    '<sit:situation id="X2"><sit:situationRecord xsi:type="sit:Accident" id="X2_1" version="1"><sit:generalPublicComment><sit:comment><com:values>' +
    '<com:value lang="en">English</com:value><com:value lang="nl">Nederlands</com:value></com:values></sit:comment><sit:commentType>other</sit:commentType></sit:generalPublicComment>' +
    '</sit:situationRecord></sit:situation>';
  const list = await parseSnippet(xml);
  assert.equal(list.length, 2);
  assert.equal(list[0].recs[0].type, 'FutureType');
  assert.deepEqual(list[0].recs[0].locs, []);
  assert.equal(list[1].recs[0].comments?.[0].text, 'Nederlands');
  assert.equal(list[1].sev, undefined);
});

test('malformed XML rejects', async () => {
  await assert.rejects(parseFeed(chunked('<mc:messageContainer><sit:situation id="1">', 5), () => {}));
});
