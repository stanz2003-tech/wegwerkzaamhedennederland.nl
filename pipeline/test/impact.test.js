import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../src/classify.js';
import { impactOf, vehicleGroup } from '../src/impact.js';
import { mergeSituation } from '../src/merge.js';
import { parseFixture } from './helpers.js';

/** Real records of a fixture, reduced the way item.js hands them to impactOf(). */
async function measuresOf(name, roadType = 'lokaal') {
  const situation = await parseFixture(name);
  const m = mergeSituation(situation);
  const cls = classify(situation, 'planning');
  return {
    recs: m.measures,
    ctx: { cat: cls.cat, roadType, delay: m.delay, hasPeriods: m.periods !== undefined, lanes: m.lanes, speed: m.speed },
  };
}

const lane = (type, extra = {}) => ({ type: 'RoadOrCarriagewayOrLaneManagement', lane: type, ...extra });
const speed = (kmh) => ({ type: 'SpeedManagement', speedType: 'speedRestrictionInOperation', speed: kmh });
const reroute = (vehicles) => ({ type: 'ReroutingManagement', rerouteType: 'useIntersectionOrJunction', ...(vehicles ? { vehicles } : {}) });
const WORK = { type: 'MaintenanceWorks' };

test('dicht: a roadClosed for bicycles on a cycle path (real Almelo record) → dicht + veh [bicycle], no per', async () => {
  const { recs, ctx } = await measuresOf('fiets_dicht.xml');
  assert.equal(ctx.cat, 'afsluiting');
  assert.deepEqual(recs[1], lane('roadClosed', { vehicles: ['bicycle'] }));
  assert.equal(ctx.hasPeriods, false, 'the whole window published twice is not a recurring measure');
  assert.deepEqual(impactOf(recs, ctx), { imp: 'dicht', veh: ['bicycle'] });
  assert.deepEqual(impactOf(recs, { ...ctx, hasPeriods: true }), { imp: 'dicht', veh: ['bicycle'], per: true });
});

test('dicht: MaintenanceWorks parent with a roadClosed child (real Breda record) — all records count', async () => {
  const { recs, ctx } = await measuresOf('werk_roadclosed.xml');
  assert.equal(recs[0].type, 'MaintenanceWorks');
  assert.deepEqual(impactOf(recs, ctx), { imp: 'dicht' });
  // the parent alone, as a werk item with Melvin's default delay band, is only hinder
  assert.deepEqual(impactOf([recs[0]], { cat: 'werk', roadType: 'lokaal', delay: 'upToTenMinutes' }), { imp: 'hinder' });
});

test('carriagewayClosures: rijbaan on an A- or N-road, dicht on a local street, stadsroute or unknown road', async () => {
  const { recs } = await measuresOf('afsl.xml');
  assert.deepEqual(recs, [lane('carriagewayClosures')]);
  for (const roadType of ['A', 'N']) assert.equal(impactOf(recs, { cat: 'afsluiting', roadType }).imp, 'rijbaan', roadType);
  for (const roadType of ['lokaal', 'S', 'E', undefined]) assert.equal(impactOf(recs, { cat: 'afsluiting', roadType }).imp, 'dicht', String(roadType));
});

test('rijbaan: the A348 closure (real Gelderland record) with lane measures and a detour stays rijbaan', async () => {
  const { recs, ctx } = await measuresOf('rijbaan_omleiding.xml', 'A');
  assert.ok(recs.some((r) => r.lane === 'useOfSpecifiedLanesOrCarriagewaysAllowed'));
  assert.ok(recs.some((r) => r.type === 'ReroutingManagement'));
  assert.deepEqual(impactOf(recs, ctx), { imp: 'rijbaan', per: true });
});

test('hinder: laneClosures with lanes closed → hinder + lc; lanes.closed 0 gives no lc', () => {
  const out = impactOf([WORK, lane('laneClosures', { lanesRestricted: 2 })], { cat: 'werk', roadType: 'A', lanes: { closed: 2, open: 1, total: 3 } });
  assert.deepEqual(out, { imp: 'hinder', lc: 2 });
  const none = impactOf([lane('laneClosures', { lanesRestricted: 0 })], { cat: 'werk', roadType: 'A', lanes: { closed: 0, open: 1, total: 1 } });
  assert.deepEqual(none, { imp: 'hinder' });
});

test('hinder: RWS lane closure + speed limit (rws_plan) → hinder + spd 30, no lc', async () => {
  const { recs, ctx } = await measuresOf('rws_plan.xml', 'A');
  assert.deepEqual(impactOf(recs, ctx), { imp: 'hinder', spd: 30 });
});

test('hinder: a temporary speed limit alone, or verkeersregelaars (and01) → hinder + spd', async () => {
  assert.deepEqual(impactOf([speed(50)], { cat: 'overig', speed: 50 }), { imp: 'hinder', spd: 50 });
  const { recs, ctx } = await measuresOf('and01.xml');
  assert.ok(recs.some((r) => r.gnm === 'trafficBeingManuallyDirected'));
  assert.deepEqual(impactOf(recs, ctx), { imp: 'hinder', spd: 30 });
  assert.equal(impactOf([{ type: 'GeneralNetworkManagement', gnm: 'temporaryTrafficLights' }], { cat: 'werk' }).imp, 'hinder');
});

test('hinder: every lane measure type that leaves the road passable', () => {
  for (const type of ['laneClosures', 'lanesDeviated', 'narrowLanes', 'useOfSpecifiedLanesOrCarriagewaysAllowed', 'hardShoulderRunningInOperation']) {
    assert.equal(impactOf([lane(type)], { cat: 'overig', roadType: 'A' }).imp, 'hinder', type);
  }
  // an unknown lane measure says nothing
  assert.equal(impactOf([lane('other')], { cat: 'overig', roadType: 'A' }).imp, 'onbekend');
});

test('hinder: files and incidents, a signed detour without a closure, and delay bands on works', () => {
  assert.equal(impactOf([{ type: 'AbnormalTraffic' }], { cat: 'file' }).imp, 'hinder');
  assert.equal(impactOf([{ type: 'Accident' }], { cat: 'incident' }).imp, 'hinder');
  assert.equal(impactOf([WORK, reroute()], { cat: 'werk' }).imp, 'hinder');
  for (const delay of ['upToTenMinutes', 'betweenTenMinutesAndThirtyMinutes', 'betweenThirtyMinutesAndOneHour', 'longerThanThreeHours']) {
    assert.equal(impactOf([WORK], { cat: 'werk', delay }).imp, 'hinder', delay);
  }
});

test('geen: negligible delay without measures; events without any traffic measure', async () => {
  const { recs, ctx } = await measuresOf('event_geen.xml');
  assert.equal(ctx.cat, 'evenement');
  assert.equal(ctx.delay, 'negligible');
  assert.deepEqual(impactOf(recs, ctx), { imp: 'geen' });
  assert.equal(impactOf([WORK], { cat: 'werk', delay: 'negligible' }).imp, 'geen');
  // Melvin's default "up to ten minutes" on an event without a measure is still geen …
  assert.equal(impactOf([{ type: 'PublicEvent' }], { cat: 'evenement', delay: 'upToTenMinutes' }).imp, 'geen');
  assert.equal(impactOf([{ type: 'PublicEvent' }], { cat: 'evenement' }).imp, 'geen');
  // … but ten minutes or more is hinder, and so is a detour
  assert.equal(impactOf([{ type: 'PublicEvent' }], { cat: 'evenement', delay: 'betweenTenMinutesAndThirtyMinutes' }).imp, 'hinder');
  assert.equal(impactOf([{ type: 'PublicEvent' }, reroute()], { cat: 'evenement', delay: 'negligible' }).imp, 'hinder');
});

test('onbekend: nothing applies', () => {
  assert.deepEqual(impactOf([WORK], { cat: 'werk' }), { imp: 'onbekend' });
  assert.deepEqual(impactOf([], { cat: 'overig' }), { imp: 'onbekend' });
  assert.deepEqual(impactOf([{ type: 'VehicleObstruction' }], { cat: 'overig', delay: 'unknownBand' }), { imp: 'onbekend' });
});

test('precedence: dicht > rijbaan > hinder > geen, with spd/lc still attached', () => {
  const all = [WORK, lane('roadClosed'), lane('carriagewayClosures'), lane('laneClosures', { lanesRestricted: 1 }), speed(30)];
  const ctx = { cat: 'afsluiting', roadType: 'A', delay: 'negligible', lanes: { closed: 1 }, speed: 30 };
  assert.deepEqual(impactOf(all, ctx), { imp: 'dicht', spd: 30, lc: 1 });
  assert.deepEqual(impactOf(all.slice(2), ctx), { imp: 'rijbaan', spd: 30, lc: 1 });
  assert.deepEqual(impactOf(all.slice(3), ctx), { imp: 'hinder', spd: 30, lc: 1 });
  assert.deepEqual(impactOf([WORK], { cat: 'werk', delay: 'negligible' }), { imp: 'geen' });
  // a bridge opening is dicht even without a closure record
  assert.equal(impactOf([{ type: 'GeneralNetworkManagement', gnm: 'bridgeSwingInOperation' }], { cat: 'brug' }).imp, 'dicht');
});

test('veh: union over the winning records, DATEX types mapped to groups, stable order', () => {
  const recs = [lane('roadClosed', { vehicles: ['moped', 'bicycle'] }), lane('roadClosed', { vehicles: ['heavyGoodsVehicle', 'agriculturalVehicle', 'constructionOrMaintenanceVehicle', 'bicycle'] })];
  assert.deepEqual(impactOf(recs, { cat: 'afsluiting' }).veh, ['lorry', 'bicycle', 'moped', 'agricultural', 'other']);
  assert.equal(vehicleGroup('heavyVehicle'), 'lorry');
  assert.equal(vehicleGroup('lorry'), 'lorry');
  assert.equal(vehicleGroup('car'), 'car');
  assert.equal(vehicleGroup('bus'), 'bus');
  assert.equal(vehicleGroup('anythingElse'), 'other');
});

test('veh: only the records of the winning level count, and one unrestricted record means everyone', () => {
  // a lane closure for lorries next to a roadClosed for everyone: the road is closed for everyone
  assert.equal(impactOf([lane('roadClosed'), lane('laneClosures', { vehicles: ['lorry'] })], { cat: 'afsluiting' }).veh, undefined);
  // two roadClosed records, one restricted, one not → everyone
  assert.equal(impactOf([lane('roadClosed', { vehicles: ['bicycle'] }), lane('roadClosed')], { cat: 'afsluiting' }).veh, undefined);
  // the hinder level: a restricted lane measure alone keeps its vehicles
  assert.deepEqual(impactOf([lane('laneClosures', { vehicles: ['lorry'] })], { cat: 'werk', roadType: 'A' }).veh, ['lorry']);
  // no vehicle list anywhere → absent
  assert.equal(impactOf([lane('roadClosed')], { cat: 'afsluiting' }).veh, undefined);
});

test('a closure without a vehicle list of its own is closed to everyone — the list of the detour does not narrow it (real Almere record)', async () => {
  // Until 2026-09-23 the detour's audience was taken as the closure's; on that day's feed that made
  // 225 closures, nearly all "Weg dicht in beide richtingen", read "Geldt niet voor auto's".
  const { recs, ctx } = await measuresOf('reroute_veh_only.xml');
  assert.equal(recs.find((r) => r.lane === 'carriagewayClosures')?.vehicles, undefined);
  assert.deepEqual(recs.find((r) => r.type === 'ReroutingManagement')?.vehicles, ['bicycle']);
  assert.deepEqual(impactOf(recs, ctx), { imp: 'dicht' });
  // the closure's own list wins over the detour's list
  const own = [lane('roadClosed', { vehicles: ['moped'] }), reroute(['bicycle'])];
  assert.deepEqual(impactOf(own, { cat: 'afsluiting' }).veh, ['moped']);
  // a bicycle detour next to a detour for everyone must not narrow the closure
  assert.equal(impactOf([lane('roadClosed'), reroute(['bicycle']), reroute()], { cat: 'afsluiting' }).veh, undefined);
  // a lone detour IS the measure: its list is the measure's list, no fallback involved
  assert.deepEqual(impactOf([WORK, reroute(['bicycle'])], { cat: 'werk' }), { imp: 'hinder', veh: ['bicycle'] });
  assert.deepEqual(impactOf([WORK, reroute()], { cat: 'werk' }), { imp: 'hinder' });
});

test('the published vehicle list is never rewritten from the free text', () => {
  // A heuristic that turned a bare ['car'] into ['bicycle'] whenever the description mentioned a
  // fietspad was removed on 2026-09-21. It touched 37 situations and was right for about five.
  // The commonest phrasing it hit inverts the meaning outright, so that case is locked down here.
  const closed = lane('roadClosed', { vehicles: ['car'] });

  const omgekeerd = ['Herstel lekkage stadsverwarming. | Verkeersbelemmering: Algemeen - rijbaan dicht muv fietsers en voetgangers'];
  assert.deepEqual(impactOf([WORK, closed], { cat: 'werk', texts: omgekeerd }), { imp: 'dicht', veh: ['car'] });

  // A genuine cycle-path closure that the publisher filed as ['car'] stays as published: the
  // source is the only thing that actually knows, and guessing costs more than it saves.
  const fietspad = ['Langdurige afsluiting fietspad Merwedebrug westzijde i.v.m. met de bouw van de nieuwe brug.'];
  assert.deepEqual(impactOf([WORK, closed], { cat: 'werk', texts: fietspad }), { imp: 'dicht', veh: ['car'] });

  // A list the publisher really did restrict on the closure itself is still honoured.
  assert.deepEqual(impactOf([WORK, lane('roadClosed', { vehicles: ['bicycle'] })], { cat: 'werk' }).veh, ['bicycle']);
  // …and a detour's list never narrows a closure that has none of its own.
  assert.equal(impactOf([WORK, lane('roadClosed'), reroute(['bicycle'])], { cat: 'werk' }).veh, undefined);
});

test('"De A6 is dicht" plus a detour outweighs the absence of a closure record (RWS parent situations)', () => {
  const texts = ['groot onderhoud A6 HRR Emmeloord-Lemmer nachtafsluiting fase 4A De A6 is dicht.'];
  // On a dual carriageway road the other direction stays open, so this is `rijbaan`…
  assert.deepEqual(impactOf([WORK, reroute()], { cat: 'werk', roadType: 'A', texts }), { imp: 'rijbaan' });
  // …and on a road with a single carriageway it really is shut.
  assert.deepEqual(impactOf([WORK, reroute()], { cat: 'werk', roadType: 'lokaal', texts }), { imp: 'dicht' });

  // Without a detour record there is nothing but prose; that is not enough.
  assert.equal(impactOf([WORK], { cat: 'werk', roadType: 'A', texts }).imp, 'onbekend');
  // And a real closure record still decides on its own.
  assert.equal(impactOf([WORK, lane('roadClosed'), reroute()], { cat: 'werk', roadType: 'A', texts }).imp, 'dicht');
});

test('"dicht bij" means NEAR in Dutch and must not read as a closure', () => {
  const texts = ['Werkzaamheden aan de rotonde, de afrit is dicht bij Hank'];
  assert.equal(impactOf([WORK, reroute()], { cat: 'werk', roadType: 'A', texts }).imp, 'hinder');
});

test('a closure read from the text is closed to everyone, whatever the detour is for', () => {
  // "De A6 is dicht" next to a detour for lorries must not become "alleen vrachtverkeer".
  assert.deepEqual(impactOf([WORK, reroute(['lorry'])], { cat: 'werk', roadType: 'lokaal', texts: ['De A6 is dicht.'] }), { imp: 'dicht' });
});
