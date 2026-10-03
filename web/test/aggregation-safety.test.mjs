/**
 * Safety net for every place the site folds several item verdicts into one: a strip day, the
 * answer card headline, the card's pill. Each of them must carry the HEAVIEST member verdict —
 * a day with one closure reads "dicht" even when ten other items there are harmless, and a
 * headline over a closure never reads "Doorrijden mogelijk" or "Geen hinder".
 *
 * The heaviest level is recomputed here independently, straight from itemVerdict per member,
 * so a future change to the aggregation (grouping, day parts, reordering) cannot quietly make
 * a level lighter without this file failing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureFiles, readJson } from './helpers/fixtures.mjs';
import { answer as answerMod, answerCard, forecast, panelAnswer, placeMode, verdict } from './helpers/src.mjs';

const { answerFor } = answerMod;
const { cardHeadline } = answerCard;
const { dayStrip, itemVerdict } = forecast;
const { VERDICT_SEVERITY } = verdict;

const NOW = Date.parse(readJson('meta.json').generated);
const MODES = ['auto', 'vracht', 'fiets'];
const ENTITY_FILES = fixtureFiles().filter((f) => f.startsWith('roads/') || f.startsWith('gemeenten/'));
const RELIEF = /^(?:Doorrijden mogelijk|Geen hinder|Geen hinder gemeld|Niets gemeld)$/;

const rank = (level) => VERDICT_SEVERITY.indexOf(level);

/** The heaviest relevant (non-nvt) level among `levels`, null when there is none. */
function heaviest(levels) {
  const relevant = levels.filter((l) => l !== 'nvt');
  if (relevant.length === 0) return null;
  return relevant.reduce((a, b) => (rank(b) < rank(a) ? b : a));
}

function subjectFor(file) {
  const kind = file.startsWith('roads/') ? 'road' : 'gemeente';
  return { kind, name: file.replace(/^.*\//, '').replace(/\.json$/, '').toUpperCase() };
}

describe('aggregations carry the heaviest member verdict', () => {
  it('fixture data has closures to protect', () => {
    let closures = 0;
    for (const file of ENTITY_FILES) {
      for (const it of readJson(file).items) {
        const level = itemVerdict(it, 'auto', NOW).level;
        if (level === 'dicht' || level === 'rijbaan') closures += 1;
      }
    }
    assert.ok(closures > 0, 'without a closure in the fixtures these tests prove nothing');
  });

  for (const mode of MODES) {
    it(`${mode}: every strip day equals the heaviest verdict of its items`, () => {
      let heavy = 0;
      for (const file of ENTITY_FILES) {
        const items = readJson(file).items;
        const byId = new Map(items.map((x) => [x.f.properties.id, x]));
        for (const cell of dayStrip(items, mode, NOW, 14)) {
          const window = { from: Math.max(cell.from, NOW), to: cell.to };
          const levels = cell.ids.map((id) => itemVerdict(byId.get(id), mode, undefined, window).level);
          assert.equal(cell.worst, heaviest(levels), `${file} ${mode} ${new Date(cell.from).toISOString()}`);
          if (cell.worst === 'dicht' || cell.worst === 'rijbaan') heavy += 1;
        }
      }
      if (mode === 'auto') assert.ok(heavy > 0, 'at least one strip day carries a closure');
    });

    it(`${mode}: the answer level is the heaviest item and a closure never gets a reassuring headline`, () => {
      for (const file of ENTITY_FILES) {
        const items = readJson(file).items;
        const subject = subjectFor(file);
        const questions = [{ kind: 'moment', at: NOW }];
        for (const cell of dayStrip(items, mode, NOW, 14)) questions.push({ kind: 'window', from: Math.max(cell.from, NOW), to: cell.to });
        for (const when of questions) {
          const a = answerFor(items, mode, when, subject, NOW);
          const levels = a.items.map((x) =>
            when.kind === 'moment' ? itemVerdict(x.item, mode, when.at).level : itemVerdict(x.item, mode, undefined, when).level,
          );
          const label = `${file} ${mode} ${JSON.stringify(when)}`;
          assert.equal(a.level, heaviest(levels), label);
          assert.equal(a.items[0]?.verdict.level ?? null, a.level, `${label}: the first specific is the heaviest`);
          const headline = cardHeadline({ answer: a, total: items.length });
          if (a.level === 'dicht' || a.level === 'rijbaan') {
            assert.doesNotMatch(headline, RELIEF, `${label}: "${headline}"`);
            assert.match(headline, /dicht/i, `${label}: a closure headline says dicht`);
          }
          if (a.level === 'hinder') assert.doesNotMatch(headline, /^Geen hinder/, label);
        }
      }
    });
  }
});

describe('place mode on the map carries the heaviest member verdict (owner decision 3)', () => {
  // The place card ("Kan ik door Almkerk?") answers over map features without their detail
  // (d: null), matched with the same predicate the map uses. Every woonplaats in the fixtures.
  const { placeMatcher } = placeMode;
  const features = ['werk-actueel.geojson', 'werk-gepland.geojson', 'live.geojson'].flatMap((f) => readJson(f).features);
  const names = Array.from(new Set(features.map((f) => f.properties.woonplaats).filter(Boolean)));

  for (const mode of MODES) {
    it(`${mode}: answer level and headline for every woonplaats, now and on every strip day`, () => {
      let closures = 0;
      for (const name of names) {
        const inPlace = placeMatcher({ kind: 'woonplaats', slug: name.toLowerCase(), name }, null);
        const items = features.filter((f) => inPlace(f.properties)).map((f) => ({ f, d: null }));
        const subject = { kind: 'woonplaats', name };
        const questions = [{ kind: 'moment', at: NOW }];
        for (const cell of dayStrip(items, mode, NOW, 14)) questions.push({ kind: 'window', from: Math.max(cell.from, NOW), to: cell.to });
        for (const when of questions) {
          const a = answerFor(items, mode, when, subject, NOW);
          const levels = a.items.map((x) =>
            when.kind === 'moment' ? itemVerdict(x.item, mode, when.at).level : itemVerdict(x.item, mode, undefined, when).level,
          );
          const label = `${name} ${mode} ${JSON.stringify(when)}`;
          assert.equal(a.level, heaviest(levels), label);
          const headline = cardHeadline({ answer: a, total: items.length });
          if (a.level === 'dicht' || a.level === 'rijbaan') {
            closures += 1;
            assert.doesNotMatch(headline, RELIEF, `${label}: "${headline}"`);
            assert.match(headline, /dicht/i, `${label}: a closure headline says dicht`);
          }
          if (a.level === 'hinder') assert.doesNotMatch(headline, /^Geen hinder/, label);
        }
      }
      if (mode === 'auto') assert.ok(closures > 0, 'at least one place answer carries a closure');
    });
  }
});

describe('an opened item is judged over the asked window, not at now', () => {
  const { questionWindowOf, whenOf } = panelAnswer;
  // Wednesday 14:00 CEST; the item is closed every night 22:00–05:00 local.
  const DAY_NOW = Date.parse('2026-09-09T12:00:00Z');
  const nights = Array.from({ length: 20 }, (_, i) => {
    const start = Date.parse('2026-09-01T20:00:00Z') + i * 24 * 3600 * 1000;
    return [new Date(start).toISOString(), new Date(start + 7 * 3600 * 1000).toISOString()];
  });
  const item = {
    f: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5.1, 52.1] },
      properties: { id: 'n', cat: 'werk', sev: 2, title: 'A27 · Hank', start: '2026-09-01T20:00:00Z', end: '2026-09-21T03:00:00Z', src: 'x', imp: 'dicht', per: true, road: 'A27' },
    },
    d: { id: 'n', src: 'x', upd: '2026-09-01T00:00:00Z', periods: nights },
  };
  const q = (over) => ({ mode: 'auto', time: 'nu', moment: null, day: null, part: null, road: 'A27', query: '', ...over });

  it('the chips, a picked day and a moment give the window the card answers for', () => {
    assert.equal(questionWindowOf(q({}), DAY_NOW), null);
    assert.equal(questionWindowOf(q({ time: 'morgen', moment: DAY_NOW + 3600e3 }), DAY_NOW), null);
    for (const time of ['vandaag', 'morgen', 'weekend']) {
      const win = questionWindowOf(q({ time }), DAY_NOW);
      const when = whenOf(q({ time }), DAY_NOW);
      assert.deepEqual(when, { kind: 'window', ...win }, time);
    }
    const day = questionWindowOf(q({ time: 'morgen', day: '2026-09-12' }), DAY_NOW);
    assert.deepEqual(whenOf(q({ time: 'morgen', day: '2026-09-12' }), DAY_NOW), { kind: 'window', ...day }, 'a picked day wins over a chip');
  });

  it('a nightly closure under "Morgen" reads dicht in the detail, as on the card', () => {
    assert.equal(itemVerdict(item, 'auto', DAY_NOW).level, 'geen', 'at now (daytime) it is outside working hours');
    for (const time of ['vandaag', 'morgen', 'weekend']) {
      const win = questionWindowOf(q({ time }), DAY_NOW);
      assert.equal(itemVerdict(item, 'auto', undefined, win).level, 'dicht', time);
      const a = answerFor([item], 'auto', whenOf(q({ time }), DAY_NOW), { kind: 'road', name: 'A27' }, DAY_NOW);
      assert.equal(a.level, 'dicht', `${time}: card`);
    }
  });
});
