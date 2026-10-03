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
import { answer as answerMod, answerCard, forecast, verdict } from './helpers/src.mjs';

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
