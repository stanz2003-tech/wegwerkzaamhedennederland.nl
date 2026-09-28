/**
 * Package P3 "Eén scrollend paneel": the panel is one scroll container with a sticky question,
 * the filters sit behind one honest disclosure, and no focus move scrolls the page.
 *   - mobiel-1 / overzicht-1: one scroll container, the list is not a nested scroller any more.
 *   - mobiel-3 / owner decision 5: "Filters · …" always states what is filtered.
 *   - toeg-6 / overzicht-6: "Alles" chip, isolate-then-toggle, pressed state, neutral chips.
 *   - vooruit-6: the chosen window in words under the chips.
 *   - mobiel-2 / toeg-8: focus({ preventScroll: true }) in the panel code.
 *   - toeg-5: panel before the map, skip links, list heading.
 * Pure functions and markup only; the layout itself is verified in a browser.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { answerCard, categories, chips, panelLayout, time, whenControl } from './helpers/src.mjs';

const { filtersSummaryText, filtersActive } = panelLayout;
const { toggleCategory, categoryPressed } = chips;
const { whenRangeLabel } = whenControl;
const ALL = categories.ALL_CATEGORIES;

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('filters summary states the real filter state (mobiel-3, owner decision 5)', () => {
  it('default: all kinds, relevance on with hidden items', () => {
    assert.equal(filtersSummaryText({ cats: null, hideNvt: true, hidden: 12 }), 'Filters · alle soorten · 12 meldingen voor ander verkeer verborgen');
    assert.equal(filtersSummaryText({ cats: null, hideNvt: true, hidden: 1 }), 'Filters · alle soorten · 1 melding voor ander verkeer verborgen');
  });

  it('default without anything hidden says just that', () => {
    assert.equal(filtersSummaryText({ cats: null, hideNvt: true, hidden: 0 }), 'Filters · alle soorten');
    assert.equal(filtersActive({ cats: null, hideNvt: true, hidden: 0 }), false);
  });

  it('"Afsluitingen" isolated', () => {
    const s = { cats: new Set(['afsluiting']), hideNvt: true, hidden: 0 };
    assert.equal(filtersSummaryText(s), 'Filters · alleen afsluitingen');
    assert.equal(filtersActive(s), true);
  });

  it('several kinds give their count', () => {
    assert.equal(filtersSummaryText({ cats: new Set(['werk', 'file']), hideNvt: true, hidden: 3 }), 'Filters · 2 soorten · 3 meldingen voor ander verkeer verborgen');
  });

  it('relevance off: nothing is hidden, and the line says other traffic is shown too', () => {
    const s = { cats: null, hideNvt: false, hidden: 0 };
    assert.equal(filtersSummaryText(s), 'Filters · alle soorten · ook voor ander verkeer');
    assert.equal(filtersActive(s), true);
  });

  it('never says "alle soorten" while a kind is filtered out, and never leaves hidden items out', () => {
    for (const cat of ALL) {
      const text = filtersSummaryText({ cats: new Set([cat]), hideNvt: true, hidden: 5 });
      assert.doesNotMatch(text, /alle soorten|alles/, cat);
      assert.match(text, /5 meldingen voor ander verkeer verborgen/, cat);
    }
    assert.doesNotMatch(filtersSummaryText({ cats: null, hideNvt: true, hidden: 2 }), /alles getoond/);
  });
});

describe('category chips: "Alles", isolate, then toggle (toeg-6)', () => {
  it('from "Alles" a click isolates that kind', () => {
    assert.deepEqual([...toggleCategory(null, 'afsluiting')], ['afsluiting']);
  });

  it('then clicks add and remove kinds', () => {
    const two = toggleCategory(new Set(['afsluiting']), 'file');
    assert.deepEqual([...two].sort(), ['afsluiting', 'file']);
    assert.deepEqual([...toggleCategory(two, 'file')], ['afsluiting']);
  });

  it('switching off the last kind, or selecting all of them, is "Alles" again', () => {
    assert.equal(toggleCategory(new Set(['afsluiting']), 'afsluiting'), null);
    const allButOne = new Set(ALL.slice(1));
    assert.equal(toggleCategory(allButOne, ALL[0]), null);
  });

  it('does not change the selection it was given', () => {
    const sel = new Set(['werk']);
    toggleCategory(sel, 'file');
    assert.deepEqual([...sel], ['werk']);
  });

  it('in the "Alles" state no category chip is pressed', () => {
    for (const cat of ALL) assert.equal(categoryPressed(null, cat), false, cat);
    assert.equal(categoryPressed(new Set(['brug']), 'brug'), true);
    assert.equal(categoryPressed(new Set(['brug']), 'werk'), false);
  });

  it('the chips are neutral: no category colour in their markup', () => {
    const src = read('../src/ui/chips.ts');
    assert.doesNotMatch(src, /--chip-color|meta\.color/);
    assert.match(src, /ICONS\.check/);
    assert.match(src, /data-cat-all/);
  });
});

describe('the chosen window in words (vooruit-6)', () => {
  // Monday 28 Sep 2026 12:00 in Amsterdam.
  const MON = time.zonedToMs(2026, 9, 28, 12, 0);
  // Saturday 3 Oct 2026 14:00: inside the weekend.
  const SAT = time.zonedToMs(2026, 10, 3, 14, 0);

  it('nothing for "Nu"', () => {
    assert.equal(whenRangeLabel('nu', MON), '');
  });

  it('morgen is the whole next day', () => {
    assert.equal(whenRangeLabel('morgen', MON), 'Morgen: di 29 sep, hele dag');
  });

  it('vandaag runs from now to midnight', () => {
    assert.equal(whenRangeLabel('vandaag', MON), 'Vandaag: ma 28 sep, van nu tot 24:00');
  });

  it('the coming weekend runs Friday 20:00 to Monday 06:00', () => {
    assert.equal(whenRangeLabel('weekend', MON), 'Weekend: vr 2 okt 20:00 tot ma 5 okt 06:00');
  });

  it('inside the weekend it starts now, like the answer does', () => {
    assert.equal(whenRangeLabel('weekend', SAT), 'Weekend: nu tot ma 5 okt 06:00');
  });

  it('the chips carry no title tooltip any more', () => {
    assert.doesNotMatch(read('../src/ui/when-control.ts'), /data-time="\$\{w\.id\}"[^`]*title=/);
  });
});

describe('one scroll container with a sticky question (mobiel-1, overzicht-1)', () => {
  const css = read('../src/styles/panel.css');
  const rule = (sel) => {
    const i = css.indexOf(`\n${sel} {`);
    assert.ok(i >= 0, sel);
    return css.slice(i, css.indexOf('}', i));
  };

  it('.panel__scroll scrolls and contains the overscroll', () => {
    const r = rule('.panel__scroll');
    assert.match(r, /overflow-y: auto/);
    assert.match(r, /overscroll-behavior: contain/);
  });

  it('the list body is no nested scroller any more', () => {
    const r = rule('.panel__body');
    assert.match(r, /overflow: visible/);
    assert.doesNotMatch(r, /overflow-y: auto/);
  });

  it('the header with search, mode and Wanneer is sticky', () => {
    assert.match(rule('.panel__sticky'), /position: sticky/);
    const html = read('../index.html');
    const sticky = html.slice(html.indexOf('data-panel-sticky'), html.indexOf('data-stale'));
    for (const hook of ['data-search', 'data-mode', 'data-when']) assert.ok(sticky.includes(hook), hook);
  });

  it('the grip is a 44 px target and the only place with touch-action: none', () => {
    assert.match(rule('.panel__handle'), /min-height: var\(--touch\)/);
    assert.equal(css.match(/touch-action: none/g)?.length, 1);
  });
});

describe('markup order and landmarks (toeg-5)', () => {
  const html = read('../index.html');

  it('the panel comes before the map in the DOM', () => {
    assert.ok(html.indexOf('<aside class="panel"') < html.indexOf('<section class="map"'));
  });

  it('skip links go to the search box and the list heading', () => {
    assert.match(html, /<a class="skip-link" href="#search-input"[^>]*>Naar zoeken<\/a>/);
    assert.match(html, /<a class="skip-link" href="#list-heading"[^>]*>Naar de meldingen<\/a>/);
    assert.match(html, /<h2 class="sr-only" id="list-heading" tabindex="-1">Meldingen<\/h2>/);
    assert.match(html, /<h2 class="sr-only" id="panel-heading">Kan ik erdoor\?<\/h2>/);
  });

  it('the answer comes before the filters, and the filters sit in one disclosure', () => {
    assert.ok(html.indexOf('data-answer') < html.indexOf('data-filters'));
    assert.ok(html.indexOf('data-summary') < html.indexOf('data-filters'));
    const details = html.slice(html.indexOf('<details class="panel__filters"'), html.indexOf('</details>'));
    for (const hook of ['data-cats', 'data-relevant', 'data-hidden']) assert.ok(details.includes(hook), hook);
  });

  it('the list region is named by the heading', () => {
    assert.match(read('../src/ui/list.ts'), /aria-labelledby', 'list-heading'/);
  });

  it('the answer card is labelled by question and answer together', () => {
    const card = answerCard.renderAnswerCard({
      road: 'A27',
      whenLabel: 'nu',
      mode: 'auto',
      total: 1,
      answer: { level: 'dicht', headline: 'Weg dicht bij Gorinchem', specifics: [], hidden: [], beyondHorizon: false, horizonMs: null },
    });
    assert.match(card, /aria-labelledby="answer-q answer-title"/);
    assert.match(card, /<p class="answer__kicker" id="answer-q">Kan ik over de A27\?/);
    assert.match(card, /aria-label="Alle wegen tonen"/);
  });
});

describe('no focus move in the panel scrolls the page (mobiel-2, toeg-8)', () => {
  // The search box (sticky header) and the legend's own button may take a plain focus(); every
  // other focus move in the panel code uses preventScroll and scrolls only the panel.
  const ALLOWED = /\b(search|btn|input)\.focus\(\)/;
  for (const file of ['../src/main.ts', '../src/ui/list.ts', '../src/ui/panel-layout.ts', '../src/ui/legend.ts']) {
    it(`${file.split('/').pop()}`, () => {
      const bare = read(file)
        .split('\n')
        .filter((l) => /\.focus\(\)/.test(l) && !ALLOWED.test(l));
      assert.deepEqual(bare, []);
    });
  }
});
