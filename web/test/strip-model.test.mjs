/**
 * Unit tests for what the 14-day strip says (web/src/ui/strip-model.ts), the question words of
 * the answer card (ui/when-words.ts, ui/answer-card.ts) and the shared "Wanneer?" hint
 * (ui/date-pick.ts). vooruit-2, taal-9, overzicht-5, vooruit-10.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureFiles, readJson } from './helpers/fixtures.mjs';
import { answerCard, datePick, forecast, stripModel, time, verdict, whenWords } from './helpers/src.mjs';

const { buildStripModel, placesPhrase } = stripModel;
const { VERDICT_META, VERDICT_SEVERITY } = verdict;
const { MS } = time;
const RANK = (level) => (level === null ? Infinity : VERDICT_SEVERITY.indexOf(level));

const NOW = Date.parse('2026-09-09T12:00:00Z'); // Wednesday 14:00 CEST
const A27 = { kind: 'road', name: 'A27' };

function item(id, over = {}, d = null) {
  return {
    f: {
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [5.1, 52.1] },
      properties: { id, cat: 'werk', sev: 2, title: id, start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z', src: 'x', imp: 'hinder', road: 'A27', ...over },
    },
    d,
  };
}

const everyNight = Array.from({ length: 40 }, (_, i) => {
  const start = Date.parse('2026-09-01T19:00:00Z') + i * MS.day;
  return [new Date(start).toISOString(), new Date(start + 8 * MS.hour).toISOString()];
});

const items = [
  item('gor', { imp: 'rijbaan', start: '2026-08-01T00:00:00Z', end: null, woonplaats: 'Gorinchem' }),
  item('nights', { imp: 'dicht', per: true, end: '2026-09-20T00:00:00Z', woonplaats: 'Lexmond' }, { id: 'nights', src: 'x', upd: '2026-09-01T00:00:00Z', periods: everyNight }),
  item('hank', { imp: 'dicht', per: true, end: '2026-09-20T00:00:00Z', woonplaats: 'Hank' }, { id: 'hank', src: 'x', upd: '2026-09-01T00:00:00Z', periods: everyNight }),
  item('fri', { imp: 'hinder', start: '2026-09-11T06:00:00Z', end: '2026-09-11T20:00:00Z', woonplaats: 'Vianen' }),
];

describe('the strip with an open-ended closure (vooruit-2)', () => {
  const model = buildStripModel(items, 'auto', NOW, A27);

  it('names the every-day closure once, above the strip', () => {
    assert.deepEqual(model.constantLines, ['Elke dag, de hele dag: rijbaan dicht bij Gorinchem (einde onbekend)']);
    assert.equal(model.moreConstants, 0);
  });

  it('every cell keeps its heaviest verdict as headline and gets the constant top edge', () => {
    assert.equal(model.cells.length, 14);
    for (const c of model.cells) {
      assert.equal(c.level, c.cell.worst);
      assert.equal(c.headline, VERDICT_META[c.cell.worst].label);
      assert.equal(c.edge, 'rijbaan', c.name);
    }
  });

  it('cells differ in their bars and second lines', () => {
    const today = model.cells[0];
    assert.equal(today.name, 'vandaag');
    assert.equal(today.headline, 'Weg dicht');
    assert.equal(today.line, '+ weg dicht bij Lexmond en 1 andere plek · 18:00–24:00');
    const fri = model.cells[2];
    assert.equal(fri.line, '+ weg dicht bij Lexmond en 1 andere plek · 18:00–06:00');
    assert.deepEqual(fri.parts.map((p) => p.worst), ['dicht', 'hinder', 'hinder', 'dicht']);
    const quiet = model.cells[13];
    assert.equal(quiet.headline, 'Rijbaan dicht');
    assert.equal(quiet.line, 'verder niets');
    assert.deepEqual(quiet.parts.map((p) => p.worst), [null, null, null, null]);
    assert.notEqual(model.cells[10].line, quiet.line);
  });

  it('every cell is a full sentence for screen readers', () => {
    assert.equal(model.cells[13].aria, 'dinsdag 22 september: rijbaan dicht; verder niets');
    assert.equal(model.cells[3].aria, 'zaterdag 12 september: weg dicht; daarnaast weg dicht bij Lexmond en 1 andere plek 18:00–06:00');
  });
});

describe('strip wording never counts and never reassures (taal-9, overzicht-5)', () => {
  const COUNTS = /\d+\s*(?:×\s*)?(?:dicht|rijbaan|hinder|geen|onbekend)\b/;
  const REASSURE = /\b(?:Vrij|Erdoor|Minst afgesloten)\b/i;
  const sets = [
    { items, now: NOW, subject: A27 },
    ...fixtureFiles()
      .filter((f) => f.startsWith('roads/') || f.startsWith('gemeenten/'))
      .map((f) => ({ items: readJson(f).items, now: Date.parse(readJson('meta.json').generated), subject: { kind: f.startsWith('roads/') ? 'road' : 'gemeente', name: f } })),
  ];

  for (const mode of ['auto', 'vracht', 'fiets']) {
    it(`${mode}: second lines, aria labels and the constant sentences`, () => {
      for (const s of sets) {
        const model = buildStripModel(s.items, mode, s.now, s.subject);
        for (const c of model.cells) {
          for (const text of [c.headline, c.line, c.aria]) {
            assert.doesNotMatch(text, COUNTS, text);
            assert.doesNotMatch(text, REASSURE, text);
          }
          if (c.level === null) {
            assert.equal(c.headline, 'Niets gemeld');
            assert.equal(c.line, '');
          }
          // The drawn level of every part (bar or top edge, whichever is heavier) is never
          // lighter than the cell's own parts without exclusion.
          const plain = forecast.dayParts(s.items, mode, c.cell, s.now);
          c.parts.forEach((p, i) => {
            const drawn = RANK(p.worst) <= RANK(c.edge) ? p.worst : c.edge;
            assert.ok(RANK(drawn) <= RANK(plain[i].worst), `${s.subject.name} ${c.name} ${p.part}`);
            assert.ok(RANK(c.level) <= RANK(plain[i].worst), `${s.subject.name} ${c.name} ${p.part}: headline`);
          });
        }
        for (const line of model.constantLines) assert.match(line, /^Elke dag, de hele dag: /);
      }
    });
  }

  it('places: the first is named, the rest counted as places, not as levels', () => {
    const rows = ['A', 'B', 'B', 'C'].map((w, i) => ({ item: item(`p${i}`, { woonplaats: w }), verdict: { level: 'dicht', label: 'Weg dicht' } }));
    assert.equal(placesPhrase(rows, A27), 'bij A en 2 andere plekken');
    assert.equal(placesPhrase(rows.slice(0, 1), A27), 'bij A');
    assert.equal(placesPhrase([], A27), '');
  });
});

describe('the question shows the moment (vooruit-10)', () => {
  const { dayLong, momentLong, dayQuestionWords, windowQuestionWords, questionText } = whenWords;
  const SAT_8 = Date.parse('2026-10-03T06:00:00Z');

  it('words for a moment, a day, a part and the weekend', () => {
    assert.equal(momentLong(SAT_8), 'zaterdag 3 oktober om 08:00');
    assert.equal(dayLong(Date.parse('2026-09-30T10:00:00Z')), 'woensdag 30 september');
    assert.equal(dayQuestionWords('2026-09-30', null, NOW), 'woensdag 30 september');
    assert.equal(dayQuestionWords('2026-09-09', null, NOW), 'vandaag');
    assert.equal(dayQuestionWords('2026-09-10', 'ochtend', NOW), 'morgen in de ochtend (06:00–12:00)');
    assert.equal(windowQuestionWords('weekend', NOW), 'dit weekend (vr 20:00 – ma 06:00)');
    assert.equal(windowQuestionWords('nu', NOW), 'nu');
  });

  it('the card asks the full question, in the display style, with "Terug naar nu"', () => {
    const answer = { level: 'rijbaan', headline: 'Rijbaan dicht bij Gorinchem', specifics: [], hidden: [], beyondHorizon: false, horizonMs: null };
    const html = answerCard.renderAnswerCard({ road: 'A27', whenLabel: 'wo 30 sep', questionWhen: 'woensdag 30 september', backToNow: true, mode: 'auto', answer, total: 1 });
    assert.match(html, /class="answer__kicker answer__kicker--when" id="answer-q">Kan ik woensdag 30 september over de A27\? <span class="answer__mode">voor auto&#39;s<\/span>/);
    assert.match(html, /data-answer-now/);
    assert.match(html, /Terug naar nu/);
    const now = answerCard.renderAnswerCard({ road: 'A27', whenLabel: 'nu', questionWhen: 'nu', mode: 'fiets', answer, total: 1, dataAsOf: '20:17' });
    assert.match(now, /Kan ik nu langs de A27\? <span class="answer__mode">voor fietsers · gegevens van 20:17<\/span>/);
    assert.doesNotMatch(now, /data-answer-now/);
    assert.equal(questionText({ subject: 'Almkerk' }, 'auto', 'zaterdag 3 oktober om 08:00'), 'Kan ik zaterdag 3 oktober om 08:00 door Almkerk?');
  });

  it('map and entity pages share one hint per kind of question', () => {
    const { whenHint, pickHintKind } = datePick;
    assert.equal(pickHintKind(null), 'nu');
    assert.equal(pickHintKind({ kind: 'day', date: '2026-10-06', part: null }), 'day');
    assert.equal(pickHintKind({ kind: 'day', date: '2026-10-06', part: 'ochtend' }), 'part');
    assert.equal(pickHintKind({ kind: 'moment', at: SAT_8 }), 'moment');
    assert.equal(whenHint('nu'), '');
    assert.match(whenHint('day'), /zwaarste/);
  });
});
