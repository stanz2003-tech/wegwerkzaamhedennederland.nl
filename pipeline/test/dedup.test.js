import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  absorb,
  baseId,
  DEDUP_MAX_M,
  DEDUP_PROVEN_MAX_M,
  dedupeDoublePublications,
  isSamePublication,
  metersBetween,
  spread,
  windowsOverlap,
} from '../src/dedup.js';

/**
 * Minimal finalized item: only what the de-duplication looks at.
 * @param {object} input
 */
function item(input) {
  const { id, role, start = '2026-09-01T00:00:00Z', end = '2026-09-30T00:00:00Z', mid = [5.4, 53.09], src = 'Rijkswaterstaat', cat = 'werk', rel } = input;
  const road = 'road' in input ? input.road : 'A7';
  return {
    id,
    role,
    state: 'active',
    cat,
    geometry: { type: 'Point', coordinates: mid },
    mid,
    rel,
    props: { id, cat, sev: 2, title: id, road, start, end, src },
    detail: { id, src, upd: start },
  };
}

/** Metres east at 53° N (used to place items a known distance apart). */
const east = (/** @type {number} */ m) => 5.4 + m / (111320 * Math.cos((53.09 * Math.PI) / 180));

// --- path B: the publisher declared the pair --------------------------------

test('the RWS double publication merges: the actual measure survives', () => {
  const actual = item({ id: 'RWS01_SM1013188_D2_WWA', role: 'live' });
  const planning = item({ id: 'RWS01_SM1013188_D2', role: 'planning' });
  const { items, stats } = dedupeDoublePublications([planning, actual]);
  assert.deepEqual(items.map((i) => i.id), ['RWS01_SM1013188_D2_WWA']);
  assert.equal(stats.merged, 1);
  assert.equal(stats.sameIdBase, 1);
  assert.deepEqual(stats.unproven, []);
  assert.deepEqual(actual.detail.related, ['RWS01_SM1013188_D2']);
});

test('a declared pair needs no road number and may be further apart', () => {
  // the real "RWS01_SM1174659_D2(_WWA)" case: identical spot, no road number
  const noRoad = dedupeDoublePublications([
    item({ id: 'RWS01_SM1174659_D2', role: 'planning', road: undefined }),
    item({ id: 'RWS01_SM1174659_D2_WWA', role: 'live', road: undefined }),
  ]);
  assert.equal(noRoad.stats.merged, 1);

  // the real "RWS01_SM1149515_D2(_WWA)" case: 362 m between the two midpoints
  const far = dedupeDoublePublications([
    item({ id: 'RWS01_SM1149515_D2', role: 'planning', mid: [east(362), 53.09] }),
    item({ id: 'RWS01_SM1149515_D2_WWA', role: 'live' }),
  ]);
  assert.equal(far.stats.merged, 1);
  assert.equal(far.stats.distances[0], 362);

  // beyond the proven threshold the link alone is not enough
  const tooFar = dedupeDoublePublications([
    item({ id: 'RWS01_SM1_D2', role: 'planning', mid: [east(DEDUP_PROVEN_MAX_M + 100), 53.09] }),
    item({ id: 'RWS01_SM1_D2_WWA', role: 'live' }),
  ]);
  assert.equal(tooFar.stats.merged, 0);
});

test('a relatedSituation link is accepted as proof, even without matching ids', () => {
  const actual = item({ id: 'RWS01_ACTUAL', role: 'live', rel: ['RWS01_PLAN'] });
  const plan = item({ id: 'RWS01_PLAN', role: 'planning' });
  const noise = item({ id: 'RWS01_NOISE', role: 'planning', mid: [east(600), 53.09] });
  const { items, stats } = dedupeDoublePublications([noise, plan, actual]);
  assert.equal(stats.merged, 1);
  assert.equal(stats.declaredRelated, 1);
  assert.deepEqual(items.map((i) => i.id).sort(), ['RWS01_ACTUAL', 'RWS01_NOISE']);
  assert.equal(isSamePublication(actual, plan), true);
  assert.equal(isSamePublication(actual, noise), false);
});

test('even a declared pair keeps the publisher, window and road conditions', () => {
  const cases = [
    ['other publisher', item({ id: 'RWS01_SM1_D2', role: 'planning', src: 'Gemeente Harlingen' })],
    ['window elsewhere', item({ id: 'RWS01_SM1_D2', role: 'planning', road: undefined, start: '2027-01-01T00:00:00Z', end: '2027-02-01T00:00:00Z' })],
    ['contradicting road', item({ id: 'RWS01_SM1_D2', role: 'planning', road: 'A6' })],
  ];
  for (const [why, planning] of cases) {
    const { stats } = dedupeDoublePublications([planning, item({ id: 'RWS01_SM1_D2_WWA', role: 'live' })]);
    assert.equal(stats.merged, 0, `merged anyway: ${why}`);
  }
});

// --- path A: no declared link, so all four conditions must hold -------------

test('without a declared link all four conditions are required', () => {
  // the real NDW18/NDW03 shape: actueel_beeld republishes a Melvin closure
  const actual = () => item({ id: 'NDW18_uuid_SIT', role: 'live', src: 'Provincie Zuid-Holland' });
  const plan = (/** @type {object} */ over) => item({ id: 'NDW03_597833', role: 'planning', src: 'Provincie Zuid-Holland', ...over });
  const cases = [
    ['different road', plan({ road: 'A6' })],
    ['no road on the planning item', plan({ road: undefined })],
    ['window before', plan({ start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' })],
    ['window after', plan({ start: '2027-01-01T00:00:00Z', end: '2027-02-01T00:00:00Z' })],
    ['too far away', plan({ mid: [east(400), 53.09] })],
    ['other publisher', plan({ src: 'Gemeente Rotterdam' })],
  ];
  for (const [why, planning] of cases) {
    const a = actual();
    const { items, stats } = dedupeDoublePublications([planning, a]);
    assert.equal(stats.merged, 0, `merged anyway: ${why}`);
    assert.equal(items.length, 2, why);
    assert.equal(a.detail.related, undefined, why);
  }
  // all four satisfied: it merges, and is reported as resting on geometry alone
  const a = actual();
  const ok = dedupeDoublePublications([plan({ mid: [east(200), 53.09] }), a]);
  assert.equal(ok.stats.merged, 1);
  assert.deepEqual(ok.stats.unproven, ['NDW18_uuid_SIT<-NDW03_597833@200m']);
  assert.deepEqual(a.detail.related, ['NDW03_597833']);
});

test('ambiguous sets without a declared link are left alone', () => {
  // two unrelated planning items at the same spot: merging either could hide a
  // real closure, so nothing is merged
  const live = item({ id: 'NDW18_uuid_SIT', role: 'live' });
  const { items, stats } = dedupeDoublePublications([item({ id: 'NDW03_1', role: 'planning' }), item({ id: 'NDW03_2', role: 'planning' }), live]);
  assert.equal(stats.multiCandidate, 1);
  assert.equal(stats.ambiguousSkipped, 1);
  assert.equal(stats.merged, 0);
  assert.equal(items.length, 3);

  // with a declared twin among them, that one wins and the stranger stays
  const twinLive = item({ id: 'RWS01_SM1013188_D2_WWA', role: 'live' });
  const withTwin = dedupeDoublePublications([item({ id: 'RWS01_SM9999999_D2', role: 'planning' }), item({ id: 'RWS01_SM1013188_D2', role: 'planning' }), twinLive]);
  assert.equal(withTwin.stats.merged, 1);
  assert.deepEqual(withTwin.items.map((i) => i.id).sort(), ['RWS01_SM1013188_D2_WWA', 'RWS01_SM9999999_D2']);
});

test('live items without a road and without a declared twin are never merged', () => {
  const actual = item({ id: 'NDW18_uuid_SIT', role: 'live', road: undefined });
  const planning = item({ id: 'NDW03_1', role: 'planning' });
  const { items, stats } = dedupeDoublePublications([planning, actual]);
  assert.equal(stats.merged, 0);
  assert.equal(stats.nearMissNoRoad, 1);
  assert.equal(items.length, 2);
});

test('near misses are recorded so the 250 m threshold can be judged', () => {
  const actual = item({ id: 'NDW18_uuid_SIT', role: 'live' });
  const far = item({ id: 'NDW03_1', role: 'planning', mid: [east(600), 53.09] });
  const { stats } = dedupeDoublePublications([far, actual]);
  assert.equal(stats.merged, 0);
  assert.equal(stats.nearMissM.length, 1);
  assert.ok(Math.abs(stats.nearMissM[0] - 600) < 10, `${stats.nearMissM[0]} m`);
  assert.match(spread(stats.nearMissM), /^n=1 min=\d+/);
  assert.equal(spread([]), 'none');
});

// --- shared behaviour -------------------------------------------------------

test('an open-ended window overlaps anything that starts before its end', () => {
  assert.equal(windowsOverlap({ start: '2026-01-01T00:00:00Z' }, { start: '2030-01-01T00:00:00Z', end: undefined }), true);
  assert.equal(windowsOverlap({ start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' }, { start: '2026-01-15T00:00:00Z' }), true);
  assert.equal(windowsOverlap({ start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' }, { start: '2026-03-01T00:00:00Z' }), false);
  // unparseable times are treated as open, never as an error
  assert.equal(windowsOverlap({ start: 'nonsense' }, { start: '2026-01-01T00:00:00Z' }), true);
});

test('one planning item is consumed at most once and lists stay stable', () => {
  const a = item({ id: 'RWS01_SM1_D2_WWA', role: 'live' });
  const b = item({ id: 'RWS01_SM1_D2_SM', role: 'live' });
  const plan = item({ id: 'RWS01_SM1_D2', role: 'planning' });
  const { items, stats } = dedupeDoublePublications([plan, a, b]);
  assert.equal(stats.merged, 1);
  assert.equal(items.length, 2, 'both actual measures survive, the planning item is dropped once');
  assert.equal(items.filter((i) => i.role === 'planning').length, 0);
});

test('the survivor absorbs what only the planning item knew, and nothing else', () => {
  const actual = item({ id: 'RWS01_SM1_D2_WWA', role: 'live', cat: 'werk' });
  actual.props.sub = 'laneClosures';
  actual.detail.speed = 70;
  const planning = item({ id: 'RWS01_SM1_D2', role: 'planning', cat: 'afsluiting' });
  Object.assign(planning.props, { hind: 'C', prob: 'probable', gemeente: 'Harlingen', woonplaats: 'Harlingen', prov: 'Friesland', closed: true, sub: 'roadClosed', sev: 4 });
  Object.assign(planning.detail, { desc: 'Groot onderhoud', detour: 'Volg de gele borden', url: 'https://melvin.ndw.nu/x', status: 'running', speed: 30 });

  const { stats } = dedupeDoublePublications([planning, actual]);
  assert.equal(stats.merged, 1);
  assert.equal(stats.enriched, 1);
  assert.equal(stats.crossCategory, 1);
  // filled in, because the survivor had nothing there
  assert.equal(actual.props.hind, 'C');
  assert.equal(actual.props.gemeente, 'Harlingen');
  assert.equal(actual.detail.desc, 'Groot onderhoud');
  assert.equal(actual.detail.detour, 'Volg de gele borden');
  assert.equal(actual.detail.url, 'https://melvin.ndw.nu/x');
  assert.equal(actual.detail.status, 'running');
  // never overwritten: the survivor describes what is happening right now
  assert.equal(actual.detail.speed, 70);
  assert.equal(actual.props.sub, 'laneClosures');
  assert.equal(actual.cat, 'werk');
  assert.equal(actual.props.sev, 2);
  assert.equal(actual.props.closed, undefined, 'a planning closed flag must not leak onto a lane closure');
  assert.equal(actual.props.title, 'RWS01_SM1_D2_WWA', 'the title stays the survivor’s own');
  // absorb() itself is idempotent
  assert.equal(absorb(actual, planning), false);
});

test('helpers: baseId strips only the actual-measure suffix; distance is metres', () => {
  assert.equal(baseId('RWS01_SM1013188_D2_WWA'), 'RWS01_SM1013188_D2');
  assert.equal(baseId('RWS01_SM1013188_D2'), 'RWS01_SM1013188_D2');
  assert.equal(baseId('NDW03_606942'), 'NDW03_606942');
  assert.equal(DEDUP_MAX_M, 250);
  assert.ok(DEDUP_PROVEN_MAX_M > DEDUP_MAX_M);
  assert.ok(Math.abs(metersBetween([5.4, 53.09], [east(250), 53.09]) - 250) < 2);
  assert.equal(Math.round(metersBetween([5.4, 53.09], [5.4, 53.09])), 0);
});
