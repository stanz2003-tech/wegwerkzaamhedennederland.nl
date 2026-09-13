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

test('a gemeente item that was not geocoded keeps the road from its text — nothing contradicts it', async () => {
  const item = await localStreetMentioningMotorway("Gemeente 's-Gravenhage");

  finalizeItem(item, undefined, NOW_MS);

  assert.equal(item.props.road, 'A4');
  assert.equal(item.props.roadType, 'A');
});
