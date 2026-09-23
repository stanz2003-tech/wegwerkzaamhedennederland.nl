import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildItem, finalizeItem } from '../src/item.js';
import { fixture, parseSnippet } from './helpers.js';

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
