import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildItem, finalizeItem } from '../src/item.js';
import { createVild } from '../src/vild.js';
import { fixture, parseSnippet, VILD_SAMPLE } from './helpers.js';

const NOW_MS = Date.parse('2026-09-10T12:00:00Z');
/** No AlertC in these fixtures, so the VILD table is never consulted. */
const NO_VILD = { point: () => undefined, describe: () => undefined };

/**
 * The real Zwolle `carriagewayClosures` record (afsl.xml) with the publisher's text
 * replaced by the 's-Gravenhage wording: a local street whose comment names a motorway.
 * @param {string} src
 */
async function localStreetMentioningMotorway(src) {
  const [situation] = await parseSnippet(fixture('afsl.xml').replace('Gemeente Zwolle', src));
  situation.recs[0].comments = [
    { type: 'warning', text: 'A4 · Breedtebeperking < 2m' },
    { type: 'other', text: 'Vrachtverkeer > ? Ton, grote omleiding Snelweg A4zuid -> Zonweg' },
  ];
  const built = buildItem(situation, 'planning', { vild: NO_VILD, nowMs: NOW_MS });
  assert.ok(built.item, 'fixture builds an item');
  return built.item;
}

const GEO = { straat: 'Binckhorstlaan', woonplaats: "'s-Gravenhage", gemeente: "'s-Gravenhage", prov: 'Zuid-Holland', provCode: 'PV28' };

test("a gemeente closure of a local street that mentions the A4 is lokaal and therefore dicht (NDW03_232949, Gemeente 's-Gravenhage)", async () => {
  // Arrange
  const item = await localStreetMentioningMotorway("Gemeente 's-Gravenhage");

  // Act
  finalizeItem(item, GEO, NOW_MS);

  // Assert
  assert.equal(item.props.road, undefined, 'the A4 is a landmark in the text, not the road');
  assert.equal(item.props.roadType, 'lokaal');
  assert.equal(item.props.imp, 'dicht', 'one carriageway on a local street: the street is closed');
  assert.equal(item.props.src, "Gemeente 's-Gravenhage");
  // the publisher's own short comment stays the title (with the place appended, as for every local item)
  assert.equal(item.props.title, "A4 · Breedtebeperking < 2m, 's-Gravenhage");
});

test('the same record published by Rijkswaterstaat keeps the A4 from its text: roadType A, imp rijbaan', async () => {
  const item = await localStreetMentioningMotorway('WNZ [RWS West-Nederland Zuid]');

  finalizeItem(item, GEO, NOW_MS);

  assert.equal(item.props.src, 'Rijkswaterstaat');
  assert.equal(item.props.road, 'A4');
  assert.equal(item.props.roadType, 'A');
  assert.equal(item.props.imp, 'rijbaan');
  assert.match(item.props.title, /^A4/);
});

test('a gemeente item that was not geocoded still never lands on a motorway — a gemeente does not manage the A4', async () => {
  const item = await localStreetMentioningMotorway("Gemeente 's-Gravenhage");

  finalizeItem(item, undefined, NOW_MS);

  assert.equal(item.props.road, undefined);
  assert.equal(item.props.roadType, 'lokaal');
});

test('a live measure gets no timeline: what the live feed publishes is in force now (RWS01_SM1174006_D2_WWA)', async () => {
  // The real shape: a closure record whose validPeriod — the planned slot — ended at 18:00, still in
  // the live feed at 18:04. With a timeline the site read "Geen hinder · buiten werktijden".
  const [situation] = await parseSnippet(fixture('afsl.xml'));
  const rec = situation.recs[0];
  rec.start = '2026-09-10T09:00:00Z';
  rec.end = undefined;
  rec.periods = [['2026-09-10T10:00:00Z', '2026-09-10T11:00:00Z']];
  const now = Date.parse('2026-09-10T11:04:00Z');
  const built = buildItem(situation, 'live', { vild: NO_VILD, nowMs: now });
  assert.ok(built.item, 'still published: the live feed says it is in force');

  finalizeItem(built.item, GEO, now);

  assert.equal(built.item.props.per, undefined);
  assert.equal(built.item.detail.periods, undefined);
  assert.equal(built.item.detail.tl, undefined);
  assert.equal(built.item.props.imp, 'dicht');
});

test('a planning item whose closure phase runs today is active, even when the main record lists no block today', async () => {
  // AND01_32A834BD256640AD8DAD3C850DA52ACC on 2026-09-23: the roadClosed record runs 14 Sep to
  // 9 Oct, the main record's blocks only start on 12 Oct. Reading the main record alone filed the
  // item under "gepland", off the map for "Nu".
  const [situation] = await parseSnippet(fixture('afsl.xml'));
  const main = situation.recs[0];
  main.start = '2026-09-01T05:00:00Z';
  main.end = '2026-10-30T15:00:00Z';
  main.periods = [['2026-10-12T05:00:00Z', '2026-10-30T15:00:00Z']];
  const closure = { ...main, id: `${main.id}_closure`, type: 'RoadOrCarriagewayOrLaneManagement', lane: 'roadClosed', start: '2026-09-01T05:00:00Z', end: '2026-10-09T15:00:00Z', periods: undefined, comments: [] };
  situation.recs.push(closure);

  const built = buildItem(situation, 'planning', { vild: NO_VILD, nowMs: NOW_MS });

  assert.equal(built.item?.state, 'active');
});

test('RWS title and from/to follow the direction of travel: real A27 twin closures (NLRWS_0005459577 / NLRWS_0005454210)', async () => {
  // actueel_beeld 2026-10-12: one lorry ban per carriageway between Werkendam and Avelingen.
  // AlertC primary = head (downstream), secondary = tail; the gml line runs tail → head.
  // 5459577: p=8318 Avelingen, s=8316 Werkendam, positive, line south → north = northbound.
  const situations = await parseSnippet(fixture('rws_direction.xml'));
  const now = Date.parse('2026-10-12T12:00:00Z');
  const vild = createVild(VILD_SAMPLE);
  const byId = Object.fromEntries(
    situations.map((s) => {
      const built = buildItem(s, 'live', { vild, nowMs: now });
      assert.ok(built.item, `${s.id} builds an item`);
      finalizeItem(built.item, undefined, now);
      return [s.id, built.item];
    }),
  );
  const north = byId.NLRWS_0005459577;
  const south = byId.NLRWS_0005454210;

  assert.equal(north.props.title, 'A27 · Werkendam → Industriegebied Avelingen');
  assert.equal(north.detail.from, 'Werkendam');
  assert.equal(north.detail.to, 'Industriegebied Avelingen');
  assert.equal(north.detail.dir, 'positive');
  assert.equal(south.props.title, 'A27 · Industriegebied Avelingen → Werkendam');
  assert.equal(south.detail.from, 'Industriegebied Avelingen');
  assert.equal(south.detail.to, 'Werkendam');
  // the line itself runs from → to: the northbound one starts in the south
  const [nStart, nEnd] = [north.geometry.coordinates[0], north.geometry.coordinates.at(-1)];
  assert.ok(nStart[1] < nEnd[1], 'northbound line starts at Werkendam (south)');
  const [sStart, sEnd] = [south.geometry.coordinates[0], south.geometry.coordinates.at(-1)];
  assert.ok(sStart[1] > sEnd[1], 'southbound line starts at Avelingen (north)');
});

test('Melvin\'s "Weg dicht in beide richtingen" without a closure record closes the street and is kept for the site (NDW03_615169, Delft)', async () => {
  // Arrange: the real Zwolle record, reduced to what the Delft situation publishes — a works record
  // with Melvin's label and a speed limit, no closure record.
  const [situation] = await parseSnippet(fixture('afsl.xml'));
  const [rec] = situation.recs;
  situation.recs = [
    { ...rec, type: 'MaintenanceWorks', lane: undefined, comments: [{ type: 'warning', text: 'Weg dicht in beide richtingen' }, { type: 'other', text: 'Werkvakken max 40 meter' }] },
    { ...rec, id: `${rec.id}_S`, type: 'SpeedManagement', lane: undefined, speed: 30, comments: [] },
  ];
  const built = buildItem(situation, 'planning', { vild: NO_VILD, nowMs: NOW_MS });
  assert.ok(built.item);

  // Act
  const item = finalizeItem(built.item, GEO, NOW_MS);

  // Assert
  assert.equal(item.props.imp, 'dicht');
  assert.equal(item.detail.gevolg, 'Weg dicht in beide richtingen');
  assert.deepEqual(item.qa?.gevolg, { key: 'weg dicht in beide richtingen', text: 'Weg dicht in beide richtingen' });
  assert.equal(item.qa?.by, 'gevolg');
});

/**
 * Review 2026-10-16: a works record with Melvin's label, one working period and an umbrella over the
 * rest of the month, plus closure records built from the real Zwolle record (afsl.xml). NOW_MS
 * (10 September) lies after the working period, under the umbrella.
 */
async function umbrellaSituation({ label = true, closures }) {
  const [situation] = await parseSnippet(fixture('afsl.xml'));
  const [rec] = situation.recs;
  const window = { start: '2026-09-08T05:00:00Z', end: '2026-09-30T15:00:00Z' };
  const periods = [
    ['2026-09-08T05:00:00Z', '2026-09-30T15:00:00Z'],
    ['2026-09-09T05:00:00Z', '2026-09-09T14:00:00Z'],
  ];
  const comments = label ? [{ type: 'warning', text: 'Weg dicht in beide richtingen' }] : [];
  situation.recs = [
    { ...rec, ...window, periods, type: 'MaintenanceWorks', lane: undefined, comments },
    ...closures.map((c, i) => ({ ...rec, ...window, id: `${rec.id}_${i}`, comments: [], ...c })),
  ];
  const built = buildItem(situation, 'planning', { vild: NO_VILD, nowMs: NOW_MS });
  assert.ok(built.item);
  return finalizeItem(built.item, GEO, NOW_MS);
}

test('review 2026-10-16: "weg dicht" + one working period + umbrella reads dicht after that period (Voorweg), and says so', async () => {
  const periods = [
    ['2026-09-08T05:00:00Z', '2026-09-30T15:00:00Z'],
    ['2026-09-09T05:00:00Z', '2026-09-09T14:00:00Z'],
  ];
  const closures = [{ lane: 'carriagewayClosures', periods }];
  const filled = await umbrellaSituation({ closures });
  assert.equal(filled.props.imp, 'dicht');
  assert.equal(filled.props.veh, undefined);
  assert.equal(filled.qa?.periode, true);
  // Without the label the umbrella stays unknown, as before.
  const plain = await umbrellaSituation({ label: false, closures });
  assert.equal(plain.props.imp, 'onbekend');
  assert.equal(plain.qa?.periode, undefined);
});

test('review 2026-10-16: an umbrella over a closure for only some vehicles is never filled — no "Geldt niet voor auto\'s" where it read "onduidelijk"', async () => {
  // The umbrella sits on a closure for heavy traffic; the closure for cars has no periods of its own and
  // only applies in the working period. Filling the umbrella with the heavy-traffic closure would tell
  // drivers the road is open to them after that period.
  const periods = [
    ['2026-09-08T05:00:00Z', '2026-09-30T15:00:00Z'],
    ['2026-09-09T05:00:00Z', '2026-09-09T14:00:00Z'],
  ];
  const item = await umbrellaSituation({
    closures: [
      { lane: 'carriagewayClosures', vehicles: ['lorry', 'bus', 'agriculturalVehicle'], periods },
      { lane: 'roadClosed', vehicles: ['car', 'bus', 'bicycle', 'lorry'], periods: undefined },
    ],
  });
  assert.equal(item.props.imp, 'onbekend');
  assert.equal(item.props.veh, undefined, 'unknown for every kind of traffic');
  assert.equal(item.qa?.periode, undefined);
});
