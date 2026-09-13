/**
 * Unit tests for web/src/data/answer.ts with the fixture roads (web/fixtures/data/roads/*.json):
 * the headline a driver can act on, the specifics, the area sentence and the hidden-count line.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadFixtureData, readJson } from './helpers/fixtures.mjs';
import { answer as answerMod } from './helpers/src.mjs';

const { answerFor, areaSentence, hiddenSentence, itemName, itemSection, placeLabel, specificLine } = answerMod;

const data = loadFixtureData();
const NOW = data.now;
const road = (slug) => readJson(`roads/${slug}.json`).items;
const nowMoment = { kind: 'moment', at: NOW };

describe('answerFor on the fixture roads', () => {
  it('A2 for cars right now: the rijbaan closure leads, the resurfacing work follows as a specific', () => {
    const a = answerFor(road('a2'), 'auto', nowMoment, { kind: 'road', name: 'A2' });
    assert.equal(a.level, 'rijbaan');
    assert.equal(a.headline, 'Rijbaan dicht tussen Hintham en Vught, richting Vught');
    assert.equal(a.specifics.length, 2);
    assert.equal(a.specifics[0], 'Hintham–Vught: rijbaan dicht · richting Vught');
    assert.equal(a.specifics[1], 'Vinkeveen–Holendrecht: 1 rijstrook dicht · max 70 km/u · 8 min vertraging');
    assert.equal(a.counts.rijbaan, 1);
    assert.equal(a.counts.hinder, 1);
    assert.equal(a.hidden.length, 0);
    assert.equal(a.closedRoads, 1);
  });

  it('A12 for cars: the lorry-only measure is hidden; for lorries it is a specific', () => {
    const auto = answerFor(road('a12'), 'auto', nowMoment, { kind: 'road', name: 'A12' });
    assert.equal(auto.level, 'hinder');
    assert.equal(auto.headline, 'Doorrijden mogelijk');
    assert.deepEqual(auto.hidden.map((x) => x.item.f.properties.id), ['NDW03_2100004']);
    assert.equal(auto.hidden[0].verdict.label, "Geldt niet voor auto's");
    assert.equal(auto.hidden[0].verdict.detail, 'alleen vrachtverkeer');
    const vracht = answerFor(road('a12'), 'vracht', nowMoment, { kind: 'road', name: 'A12' });
    assert.equal(vracht.hidden.length, 0);
    assert.ok(vracht.specifics.some((s) => s === 'Bij Duiven: max 90 km/u'), vracht.specifics.join(' | '));
  });

  it('the nightly A12 work is dicht inside a period and geen outside it', () => {
    const items = road('a12');
    const night = items.find((it) => it.f.properties.id === 'NDW03_2200001');
    const [first] = night.d.periods[0];
    const inside = Date.parse(first) + 60 * 60_000;
    const a = answerFor(items, 'auto', { kind: 'moment', at: inside }, { kind: 'road', name: 'A12' });
    assert.equal(a.level, 'dicht');
    assert.equal(a.headline, 'Dicht tussen Bunnik en Driebergen, richting Driebergen');
    assert.match(a.specifics[0], /^Bunnik–Driebergen: weg dicht · richting Driebergen · dagelijks 21:00–05:00$/);
    const noon = Date.parse(first) + 18 * 60 * 60_000; // 15:00 the next day: inside the span, between two nightly periods
    const b = answerFor(items, 'auto', { kind: 'moment', at: noon }, { kind: 'road', name: 'A12' });
    const nightly = b.items.find((x) => x.item.f.properties.id === 'NDW03_2200001');
    assert.ok(nightly, 'the item is active in its span');
    assert.equal(nightly.verdict.level, 'geen');
    assert.match(nightly.verdict.detail, /^buiten werktijden/);
  });

  it('a window answer includes what starts inside the window', () => {
    const a = answerFor(road('a9'), 'auto', { kind: 'window', from: NOW, to: NOW + 3 * 86_400_000 }, { kind: 'road', name: 'A9' });
    assert.equal(a.level, 'dicht');
    assert.equal(a.headline, 'Dicht bij Badhoevedorp');
    const none = answerFor(road('a9'), 'auto', nowMoment, { kind: 'road', name: 'A9' });
    assert.equal(none.level, null);
    assert.equal(none.headline, 'Geen hinder gemeld');
  });

  it('a gemeente subject names the street', () => {
    const items = readJson('gemeenten/rotterdam.json').items;
    const a = answerFor(items, 'auto', nowMoment, { kind: 'gemeente', name: 'Rotterdam' });
    assert.equal(a.level, 'dicht');
    assert.equal(a.headline, 'Coolsingel dicht');
    const utrecht = answerFor(readJson('gemeenten/utrecht.json').items, 'auto', nowMoment, { kind: 'gemeente', name: 'Utrecht' });
    assert.ok(utrecht.hidden.some((x) => x.item.f.properties.id === 'AND01_2100016'), 'the closed cycle path is hidden for cars');
    const fiets = answerFor(readJson('gemeenten/utrecht.json').items, 'fiets', nowMoment, { kind: 'gemeente', name: 'Utrecht' });
    assert.equal(fiets.level, 'dicht');
    assert.equal(fiets.headline, 'Fietspad Vechtdijk dicht dicht'.replace(' dicht dicht', ' dicht'));
  });
});

describe('wording helpers', () => {
  const x = (props, d = null, level = 'hinder', detail = '1 rijstrook dicht') => ({
    item: { f: { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 52] }, properties: { id: 'x', cat: 'werk', sev: 1, start: '2026-09-01T00:00:00Z', src: 's', imp: 'hinder', title: 'A27 · Lunetten → Utrecht-Noord', road: 'A27', ...props } }, d },
    verdict: { level, label: level === 'dicht' ? 'Weg dicht' : 'Doorrijden mogelijk', detail },
  });

  it('a generic title ("Overige") never becomes the headline', () => {
    const generic = x({ title: 'Overige', road: undefined, imp: 'dicht', woonplaats: 'Vleuten', gemeente: 'Utrecht' }).item;
    const a = answerFor([generic], 'auto', nowMoment, { kind: 'gemeente', name: 'Utrecht' });
    assert.equal(a.headline, 'Weg dicht in Vleuten');
    assert.equal(a.specifics[0], 'Vleuten: weg dicht');
    const noPlace = x({ title: 'Met name hinder', road: undefined, imp: 'dicht', woonplaats: 'Utrecht', gemeente: 'Utrecht' }).item;
    const b = answerFor([noPlace], 'auto', nowMoment, { kind: 'gemeente', name: 'Utrecht' });
    assert.equal(b.headline, 'Weg dicht in Utrecht');
    assert.equal(b.specifics[0], 'Weg dicht');
  });

  it('itemName / itemSection', () => {
    assert.equal(itemName(x({}).item), 'A27');
    assert.equal(itemName(x({ title: 'Croeselaan, Utrecht', road: undefined }).item), 'Croeselaan');
    assert.equal(itemSection(x({}).item), 'Lunetten → Utrecht-Noord');
    assert.equal(itemSection(x({ title: 'Los werk', road: undefined }).item), 'Los werk');
  });

  it('placeLabel prefers from–to, then the woonplaats, then the section', () => {
    const roadS = { kind: 'road', name: 'A27' };
    assert.equal(placeLabel(x({}, { from: 'Hank', to: 'Werkendam' }), roadS), 'Hank–Werkendam');
    assert.equal(placeLabel(x({ woonplaats: 'Hank' }), roadS), 'Bij Hank');
    assert.equal(placeLabel(x({}), roadS), 'Lunetten → Utrecht-Noord');
    assert.equal(placeLabel(x({ woonplaats: 'Hank' }), { kind: 'gebied', name: '' }), 'A27 bij Hank');
  });

  it('specificLine puts the place first and capitalises a bare line', () => {
    assert.equal(specificLine(x({ woonplaats: 'Hank' }), { kind: 'road', name: 'A27' }), 'Bij Hank: 1 rijstrook dicht');
    assert.equal(specificLine(x({ title: 'x', road: undefined }, null, 'hinder', 'max 50 km/u'), { kind: 'road', name: 'A27' }), 'Max 50 km/u');
    assert.equal(specificLine(x({}, { to: 'Breda' }, 'dicht', 'richting Breda'), { kind: 'road', name: 'A27' }), 'Lunetten → Utrecht-Noord: weg dicht · richting Breda');
  });
});

describe('sentences', () => {
  it('areaSentence names every number', () => {
    const a = answerFor(readJson('roads/a2.json').items, 'auto', nowMoment, { kind: 'gebied', name: '' });
    assert.equal(areaSentence(a, 'auto', false), 'In beeld: 1 weg dicht, 1 plek met hinder');
    const b = answerFor(readJson('roads/a12.json').items, 'auto', nowMoment, { kind: 'gebied', name: '' });
    assert.equal(areaSentence(b, 'auto', false), "In beeld: 1 plek met hinder, 1 melding geldt niet voor auto's (verborgen)");
    assert.equal(areaSentence(b, 'auto', true), "In beeld: 1 plek met hinder, 1 melding geldt niet voor auto's (vervaagd)");
    assert.equal(areaSentence(answerFor([], 'auto', nowMoment, { kind: 'gebied', name: '' }), 'auto', false), 'In beeld: geen meldingen');
  });

  it('hiddenSentence names who the hidden items are for', () => {
    const b = answerFor(readJson('roads/a12.json').items, 'auto', nowMoment, { kind: 'gebied', name: '' });
    assert.equal(hiddenSentence(b.hidden, 'auto'), '1 melding alleen voor vrachtverkeer verborgen');
    const u = answerFor(readJson('gemeenten/utrecht.json').items, 'auto', nowMoment, { kind: 'gebied', name: '' });
    assert.match(hiddenSentence(u.hidden, 'auto'), /^\d+ meldingen alleen voor fietsers verborgen$/);
    assert.equal(hiddenSentence([], 'auto'), '');
  });
});
