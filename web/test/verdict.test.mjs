/**
 * Unit tests for web/src/data/verdict.ts: every impact level, every vehicle mode, the vehicle
 * gate (`nvt`), recurring periods and the specifics line.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verdict } from './helpers/src.mjs';

const {
  VERDICT_META, VERDICT_SEVERITY, appliesToMode, cleanVehicles, countLevels, countsLine, isImpact, isRelevantFor,
  isVehicleMode, modeNoun, onlyForLabel, periodHint, verdictFor, worseLevel,
} = verdict;

const NOW = Date.parse('2026-09-09T12:00:00Z');
const item = (over = {}) => ({ cat: 'werk', imp: 'hinder', ...over });

describe('vehicle gate', () => {
  it('a measure without vehicle groups applies to everyone', () => {
    for (const mode of ['auto', 'vracht', 'fiets']) assert.equal(appliesToMode(undefined, mode), true, mode);
    assert.equal(appliesToMode([], 'auto'), true);
  });

  it('maps the modes to their groups: car / lorry / bicycle+moped', () => {
    assert.equal(appliesToMode(['car'], 'auto'), true);
    assert.equal(appliesToMode(['car'], 'vracht'), false);
    assert.equal(appliesToMode(['lorry'], 'vracht'), true);
    assert.equal(appliesToMode(['lorry'], 'auto'), false);
    assert.equal(appliesToMode(['bicycle'], 'fiets'), true);
    assert.equal(appliesToMode(['moped'], 'fiets'), true);
    assert.equal(appliesToMode(['bicycle', 'moped'], 'auto'), false);
    assert.equal(appliesToMode(['bus'], 'auto'), false);
  });

  it('returns nvt with a label naming the mode and a detail naming who it IS for', () => {
    const cycle = verdictFor(item({ imp: 'dicht', veh: ['bicycle', 'moped'] }), 'auto');
    assert.deepEqual(cycle, { level: 'nvt', label: "Geldt niet voor auto's", detail: 'alleen voor het fietspad' });
    assert.equal(verdictFor(item({ imp: 'dicht', veh: ['bicycle'] }), 'vracht').label, 'Geldt niet voor vrachtverkeer');
    assert.equal(verdictFor(item({ imp: 'dicht', veh: ['lorry'] }), 'fiets').label, 'Geldt niet voor fietsers');
    assert.equal(verdictFor(item({ veh: ['lorry'] }), 'auto').detail, 'alleen vrachtverkeer');
    assert.equal(verdictFor(item({ veh: ['agricultural'] }), 'auto').detail, 'alleen landbouwverkeer');
    assert.equal(onlyForLabel(['bus', 'agricultural']), 'alleen bussen en landbouwverkeer');
  });

  it('the same measure is a real verdict for the mode it applies to', () => {
    assert.equal(verdictFor(item({ imp: 'dicht', veh: ['bicycle', 'moped'] }), 'fiets').level, 'dicht');
    assert.equal(verdictFor(item({ imp: 'hinder', veh: ['lorry'], spd: 90 }), 'vracht').detail, 'max 90 km/u');
  });

  it('isRelevantFor mirrors the gate', () => {
    assert.equal(isRelevantFor(item({ veh: ['bicycle'] }), 'auto'), false);
    assert.equal(isRelevantFor(item({ veh: ['bicycle'] }), 'fiets'), true);
    assert.equal(isRelevantFor(item(), 'vracht'), true);
  });
});

describe('impact levels', () => {
  it('dicht → "Weg dicht", with the direction when known', () => {
    assert.deepEqual(verdictFor(item({ imp: 'dicht' }), 'auto'), { level: 'dicht', label: 'Weg dicht', detail: undefined });
    assert.equal(verdictFor(item({ imp: 'dicht' }), 'auto', { to: 'Utrecht' }).detail, 'richting Utrecht');
  });

  it('rijbaan → "Dicht in één richting" + richting', () => {
    const v = verdictFor(item({ imp: 'rijbaan' }), 'vracht', { to: 'Breda' });
    assert.equal(v.level, 'rijbaan');
    assert.equal(v.label, 'Dicht in één richting');
    assert.equal(v.detail, 'richting Breda');
  });

  it('hinder → "Doorrijden mogelijk" with lanes, speed and delay', () => {
    assert.equal(verdictFor(item({ lc: 1, spd: 70 }), 'auto', { delay: 'upToTenMinutes' }).detail, '1 rijstrook dicht · max 70 km/u · tot 10 min vertraging');
    assert.equal(verdictFor(item({ lc: 2 }), 'auto').detail, '2 rijstroken dicht');
    assert.equal(verdictFor(item({}), 'auto', { delaySec: 480 }).detail, '8 min vertraging');
    assert.equal(verdictFor(item({}), 'auto', { delay: 'negligible' }).detail, undefined);
    assert.equal(verdictFor(item({}), 'auto').label, 'Doorrijden mogelijk');
  });

  it('a file reads "file, <km> km, <min> min"', () => {
    const v = verdictFor(item({ cat: 'file', imp: 'hinder' }), 'auto', { queueM: 4200, delaySec: 1140 });
    assert.equal(v.detail, 'file, 4,2 km, 19 min');
    assert.equal(verdictFor(item({ cat: 'file', imp: 'hinder' }), 'auto', { queueM: 600 }).detail, 'file, 600 m');
  });

  it('geen and onbekend', () => {
    assert.deepEqual(verdictFor(item({ imp: 'geen' }), 'auto'), { level: 'geen', label: 'Geen hinder', detail: undefined });
    assert.equal(verdictFor(item({ imp: 'onbekend' }), 'auto').label, 'Gevolgen onduidelijk');
    // v2 data: no imp at all.
    assert.equal(verdictFor({ cat: 'werk' }, 'auto').level, 'onbekend');
    assert.equal(verdictFor(item({ imp: 'gesloten' }), 'auto').level, 'onbekend');
  });
});

describe('recurring periods', () => {
  const periods = [
    ['2026-09-09T19:00:00Z', '2026-09-10T03:00:00Z'],
    ['2026-09-10T19:00:00Z', '2026-09-11T03:00:00Z'],
    ['2026-09-11T19:00:00Z', '2026-09-12T03:00:00Z'],
  ];

  it('without loaded periods `per` only adds the hint', () => {
    assert.equal(verdictFor(item({ imp: 'dicht', per: true }), 'auto').detail, 'niet de hele tijd; tijden in het detail');
    assert.equal(verdictFor(item({ imp: 'dicht', per: 1 }), 'auto', { now: NOW }).level, 'dicht');
  });

  it('with periods and a moment: dicht inside, geen outside', () => {
    const inside = Date.parse('2026-09-09T22:00:00Z');
    const v = verdictFor(item({ imp: 'dicht', per: true }), 'auto', { periods, now: inside });
    assert.equal(v.level, 'dicht');
    assert.equal(v.detail, 'alleen wo–vr 21:00–05:00');
    const outside = verdictFor(item({ imp: 'dicht', per: true }), 'auto', { periods, now: NOW });
    assert.equal(outside.level, 'geen');
    assert.equal(outside.detail, 'buiten werktijden (wo–vr 21:00–05:00)');
  });

  it('without a moment the pattern is appended, never a false "geen"', () => {
    const v = verdictFor(item({ imp: 'rijbaan', per: true }), 'auto', { periods, to: 'Utrecht' });
    assert.equal(v.level, 'rijbaan');
    assert.equal(v.detail, 'richting Utrecht · alleen wo–vr 21:00–05:00');
  });

  it('periodHint falls back to the generic hint for an irregular list', () => {
    assert.equal(periodHint([['2026-09-09T19:00:00Z', '2026-09-10T03:00:00Z']], NOW), 'niet de hele tijd; tijden in het detail');
    assert.equal(periodHint(null, NOW), 'niet de hele tijd; tijden in het detail');
  });
});

describe('helpers', () => {
  it('worseLevel follows the severity order and nvt never wins', () => {
    assert.equal(worseLevel(null, 'geen'), 'geen');
    assert.equal(worseLevel('geen', 'hinder'), 'hinder');
    assert.equal(worseLevel('hinder', 'rijbaan'), 'rijbaan');
    assert.equal(worseLevel('rijbaan', 'dicht'), 'dicht');
    assert.equal(worseLevel('dicht', 'geen'), 'dicht');
    assert.equal(worseLevel('onbekend', 'geen'), 'onbekend');
    assert.equal(worseLevel('geen', 'nvt'), 'geen');
    assert.deepEqual(VERDICT_SEVERITY, ['dicht', 'rijbaan', 'hinder', 'onbekend', 'geen', 'nvt']);
  });

  it('countLevels / countsLine', () => {
    const counts = countLevels(['dicht', 'hinder', 'hinder', 'nvt', 'geen']);
    assert.equal(counts.hinder, 2);
    assert.equal(countsLine(counts), '1 dicht · 2 hinder · 1 geen');
    assert.equal(countsLine(countLevels([])), '');
  });

  it('type guards and labels', () => {
    assert.equal(isImpact('rijbaan'), true);
    assert.equal(isImpact('closed'), false);
    assert.equal(isVehicleMode('fiets'), true);
    assert.equal(isVehicleMode('boot'), false);
    assert.deepEqual(cleanVehicles(['car', 'tank', 'car']), ['car']);
    assert.equal(cleanVehicles(['tank']), null);
    assert.equal(cleanVehicles('car'), null);
    assert.equal(modeNoun('vracht'), 'vrachtverkeer');
    for (const level of VERDICT_SEVERITY) {
      assert.ok(VERDICT_META[level].label.length > 0);
      assert.match(VERDICT_META[level].color, /^--v-/);
    }
  });
});

describe('2026-11-12: what exactly is closed', () => {
  const base = { cat: 'afsluiting', imp: 'hinder' };

  it('a closed ramp, connector or parallel carriageway names itself in the pill and stays passable', () => {
    const cases = {
      entrySlipRoadClosed: 'Oprit dicht',
      exitSlipRoadClosed: 'Afrit dicht',
      slipRoadsClosed: 'Op- en afrit dicht',
      connectingCarriagewayClosed: 'Verbindingsweg dicht',
      parallelCarriagewayClosed: 'Parallelbaan dicht',
      sideCarriagewayClosed: 'Op- of afrit dicht',
    };
    for (const [sub, label] of Object.entries(cases)) {
      const v = verdictFor({ ...base, sub }, 'auto');
      assert.equal(v.level, 'hinder', sub);
      assert.equal(v.label, label, sub);
    }
  });

  it('the part only shows while the verdict is "doorrijden mogelijk"', () => {
    assert.equal(verdictFor({ ...base, sub: 'laneClosures' }, 'auto').label, 'Doorrijden mogelijk');
    assert.equal(verdictFor({ ...base, sub: 'toString' }, 'auto').label, 'Doorrijden mogelijk', 'an inherited key is not a sub type');
    // A related situation closed the carriageway: the heavier verdict speaks.
    assert.equal(verdictFor({ cat: 'afsluiting', imp: 'rijbaan', sub: 'entrySlipRoadClosed' }, 'auto').label, 'Dicht in één richting');
    // A ramp closed for lorries does not concern a car.
    assert.equal(verdictFor({ ...base, sub: 'exitSlipRoadClosed', veh: ['lorry'] }, 'auto').level, 'nvt');
    assert.equal(verdictFor({ ...base, sub: 'exitSlipRoadClosed', veh: ['lorry'] }, 'vracht').label, 'Afrit dicht');
  });

  it('a ramp closure keeps its own detail', () => {
    const v = verdictFor({ ...base, sub: 'exitSlipRoadClosed', spd: 70 }, 'auto');
    assert.equal(v.label, 'Afrit dicht');
    assert.equal(v.detail, 'max 70 km/u');
  });

  it('"weg dicht" for both directions says so instead of naming one direction', () => {
    assert.equal(verdictFor({ cat: 'afsluiting', imp: 'dicht' }, 'auto', { to: 'Utrecht', both: true }).detail, 'beide richtingen');
    assert.equal(verdictFor({ cat: 'afsluiting', imp: 'dicht' }, 'auto', { to: 'Utrecht' }).detail, 'richting Utrecht');
    // One direction stays one direction, whatever the flag says.
    assert.equal(verdictFor({ cat: 'afsluiting', imp: 'rijbaan' }, 'auto', { to: 'Utrecht', both: true }).detail, 'richting Utrecht');
  });
});

describe('verdictMeaning: the verdict in one plain sentence (detail view)', () => {
  const { verdictMeaning } = verdict;
  const closure = (imp, sub) => ({ cat: 'afsluiting', imp, ...(sub ? { sub } : {}) });

  it('a closed ramp: only the ramp, the road itself stays open', () => {
    const item = closure('hinder', 'entrySlipRoadClosed');
    assert.equal(
      verdictMeaning(verdictFor(item, 'auto'), item, {}, 'A27'),
      'Alleen de oprit is dicht. Op de A27 zelf rijd je door, tenzij een andere melding iets anders zegt.',
    );
    const both = closure('hinder', 'slipRoadsClosed');
    assert.match(verdictMeaning(verdictFor(both, 'auto'), both, {}, 'A27'), /^Alleen de op- en afrit zijn dicht\./);
    const connector = closure('hinder', 'connectingCarriagewayClosed');
    assert.match(verdictMeaning(verdictFor(connector, 'auto'), connector, {}, null), /^Alleen de verbindingsweg is dicht\. Op de weg zelf rijd je door/);
  });

  it('one direction: which one, and that the other way is open', () => {
    const item = closure('rijbaan');
    assert.equal(
      verdictMeaning(verdictFor(item, 'auto', { to: 'Utrecht' }), item, { to: 'Utrecht' }, 'A27'),
      'De A27 is richting Utrecht dicht. De andere kant op kun je door, tenzij daar een eigen melding voor staat.',
    );
    assert.match(verdictMeaning(verdictFor(item, 'auto'), item, {}, 'A27'), /^Eén rijrichting is dicht\./);
    assert.match(verdictMeaning(verdictFor(item, 'auto', { to: 'Utrecht' }), item, { to: 'Utrecht' }, null), /^De weg is richting Utrecht dicht\./);
  });

  it('closed: nobody gets through, and both directions when the data says so', () => {
    const item = closure('dicht');
    assert.equal(verdictMeaning(verdictFor(item, 'auto'), item, {}, 'N57'), 'Je kunt er niet langs; volg de omleiding.');
    assert.match(verdictMeaning(verdictFor(item, 'auto', { both: true }), item, { both: true }, 'N57'), /^De weg is in beide richtingen dicht\./);
  });

  it('says nothing where the pill already says it all', () => {
    const work = { cat: 'werk', imp: 'hinder' };
    assert.equal(verdictMeaning(verdictFor(work, 'auto'), work), '');
    // A ramp closed for lorries does not concern a car: no sentence about the ramp.
    const lorries = { ...closure('hinder', 'exitSlipRoadClosed'), veh: ['lorry'] };
    assert.equal(verdictMeaning(verdictFor(lorries, 'auto'), lorries, {}, 'A27'), '');
  });
});
