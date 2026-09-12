import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, mainRecord, severityOf } from '../src/classify.js';
import { parseFixture } from './helpers.js';

/** @param {Partial<import('../src/parse.js').SituationRecord>[]} recs @param {string} [sev] */
const situation = (recs, sev = 'medium') => ({ id: 'T', sev, recs: recs.map((r, i) => ({ id: `T_${i}`, type: 'Unknown', locs: [], ...r })) });

test('severity mapping', () => {
  assert.equal(severityOf('none'), 0);
  assert.equal(severityOf('lowest'), 0);
  assert.equal(severityOf('low'), 1);
  assert.equal(severityOf('medium'), 2);
  assert.equal(severityOf('unknown'), 2);
  assert.equal(severityOf(undefined), 2);
  assert.equal(severityOf('high'), 3);
  assert.equal(severityOf('highest'), 4);
  assert.equal(severityOf('garbage'), 2);
});

test('file: AbnormalTraffic only from the live feed', async () => {
  const s = await parseFixture('abnormal.xml');
  assert.deepEqual(classify(s, 'live'), { cat: 'file', sub: 'stationaryTraffic', sev: 0, closed: false, unknown: [] });
  const planning = classify(s, 'planning');
  assert.notEqual(planning.cat, 'file');
  assert.equal(planning.cat, 'overig');
  assert.equal(planning.sub, 'stationaryTraffic');
});

test('planning feed: MaintenanceWorks with expected AbnormalTraffic child is werk', () => {
  const s = situation([{ type: 'MaintenanceWorks', maint: 'resurfacingWork' }, { type: 'AbnormalTraffic', traffic: 'stationaryTraffic' }]);
  assert.equal(classify(s, 'planning').cat, 'werk');
  assert.equal(classify(s, 'planning').sub, 'resurfacingWork');
});

test('incident: accident, vehicle obstruction, general/environmental obstruction', async () => {
  const acc = classify(await parseFixture('accident.xml'), 'live');
  assert.equal(acc.cat, 'incident');
  assert.equal(acc.sub, 'accident'); // accidentType "other" → record type
  const veh = classify(await parseFixture('srti.xml'), 'live');
  assert.equal(veh.cat, 'incident');
  assert.equal(veh.sub, 'vehicleObstruction');
  assert.equal(classify(situation([{ type: 'VehicleObstruction', vehObs: 'brokenDownVehicle' }]), 'live').sub, 'brokenDownVehicle');
  assert.equal(classify(situation([{ type: 'GeneralObstruction', obstruction: 'objectOnTheRoad' }]), 'live').sub, 'objectOnTheRoad');
  assert.equal(classify(situation([{ type: 'EnvironmentalObstruction', envObs: 'flooding' }]), 'live').sub, 'flooding');
  assert.equal(classify(situation([{ type: 'GeneralObstruction' }]), 'live').sub, 'generalObstruction');
});

test('brug: bridgeSwingInOperation', async () => {
  const b = classify(await parseFixture('bridge.xml'), 'live');
  assert.equal(b.cat, 'brug');
  assert.equal(b.sub, 'bridgeSwingInOperation');
  const other = classify(situation([{ type: 'GeneralNetworkManagement', gnm: 'trafficBeingManuallyDirected' }]), 'planning');
  assert.equal(other.cat, 'overig');
  assert.equal(other.sub, 'trafficBeingManuallyDirected');
});

test('evenement: PublicEvent main record or causeType publicEvent, even when closed', () => {
  const ev = classify(situation([{ type: 'PublicEvent', event: 'festival' }, { type: 'RoadOrCarriagewayOrLaneManagement', lane: 'roadClosed' }]), 'planning');
  assert.equal(ev.cat, 'evenement');
  assert.equal(ev.sub, 'festival');
  assert.equal(ev.closed, true);
  const cause = classify(situation([{ type: 'RoadOrCarriagewayOrLaneManagement', lane: 'laneClosures', cause: 'publicEvent' }]), 'planning');
  assert.equal(cause.cat, 'evenement');
  assert.equal(cause.sub, 'publicEvent');
});

test('afsluiting: roadClosed / carriagewayClosures set the closed flag and win over werk', async () => {
  const a = classify(await parseFixture('afsl.xml'), 'live');
  assert.deepEqual(a, { cat: 'afsluiting', sub: 'carriagewayClosures', sev: 3, closed: true, unknown: [] });
  const m = classify(await parseFixture('melvin_multi.xml'), 'planning');
  assert.equal(m.cat, 'afsluiting');
  assert.equal(m.closed, true);
  const road = classify(situation([{ type: 'MaintenanceWorks' }, { type: 'RoadOrCarriagewayOrLaneManagement', lane: 'carriagewayClosures' }, { type: 'RoadOrCarriagewayOrLaneManagement', lane: 'roadClosed' }]), 'planning');
  assert.equal(road.sub, 'roadClosed');
});

test('werk: parent record types, or measures caused by road maintenance / construction', async () => {
  assert.equal(classify(await parseFixture('rws_plan.xml'), 'planning').sub, 'resurfacingWork');
  const rwsLive = classify(await parseFixture('rws_live.xml'), 'live');
  assert.equal(rwsLive.cat, 'werk');
  assert.equal(rwsLive.sub, 'speedRestrictionInOperation');
  assert.equal(classify(await parseFixture('alertonly.xml'), 'live').sub, 'laneClosures');
  const construction = classify(situation([{ type: 'ConstructionWorks' }]), 'planning');
  assert.equal(construction.cat, 'werk');
  assert.equal(construction.sub, 'constructionWork');
  const noType = classify(situation([{ type: 'MaintenanceWorks' }]), 'planning');
  assert.equal(noType.sub, 'maintenanceWork');
  const lane = classify(situation([{ type: 'RoadOrCarriagewayOrLaneManagement', lane: 'lanesDeviated', cause: 'constructionWork' }]), 'live');
  assert.equal(lane.cat, 'werk');
  assert.equal(lane.sub, 'lanesDeviated');
});

test('overig: spitsstrook, lone rerouting/speed, unknown record types are reported', () => {
  const hard = classify(situation([{ type: 'RoadOrCarriagewayOrLaneManagement', lane: 'hardShoulderRunningInOperation' }]), 'live');
  assert.equal(hard.cat, 'overig');
  assert.equal(hard.sub, 'spitsstrook');
  const speed = classify(situation([{ type: 'SpeedManagement', speedType: 'speedRestrictionInOperation', cause: 'other' }]), 'live');
  assert.equal(speed.cat, 'overig');
  assert.equal(speed.sub, 'speedRestrictionInOperation');
  const reroute = classify(situation([{ type: 'ReroutingManagement', rerouteType: 'followDiversionSigns' }]), 'live');
  assert.equal(reroute.sub, 'followDiversionSigns');
  const unknown = classify(situation([{ type: 'WinterDrivingManagement' }, { type: 'MaintenanceWorks' }]), 'planning');
  assert.deepEqual(unknown.unknown, ['WinterDrivingManagement']);
  assert.equal(unknown.cat, 'werk');
  const lone = classify(situation([{ type: 'WinterDrivingManagement' }]), 'planning');
  assert.equal(lone.cat, 'overig');
  assert.equal(lone.sub, 'winterDrivingManagement');
  assert.equal(classify({ id: 'E', recs: [] }, 'planning').sub, undefined);
});

test('mainRecord prefers works/event parents, then non-measure records', () => {
  const recs = situation([{ type: 'ReroutingManagement' }, { type: 'SpeedManagement' }, { type: 'MaintenanceWorks' }]).recs;
  assert.equal(mainRecord(recs)?.type, 'MaintenanceWorks');
  const measures = situation([{ type: 'SpeedManagement' }, { type: 'RoadOrCarriagewayOrLaneManagement' }]).recs;
  assert.equal(mainRecord(measures)?.type, 'SpeedManagement');
  const incident = situation([{ type: 'ReroutingManagement' }, { type: 'Accident' }]).recs;
  assert.equal(mainRecord(incident)?.type, 'Accident');
  assert.equal(mainRecord([]), undefined);
});
