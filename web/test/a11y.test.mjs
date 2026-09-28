/**
 * Package P2 "Toegankelijk": what a screen reader hears and what the markup says, checked without
 * a browser.
 *   - toeg-1: one debounced status region instead of a live list; the spoken answer is the card's.
 *   - toeg-2: the closed pills differ without colour (cross vs. barrier stripe).
 *   - toeg-9: no category counters in the top bar or the page templates.
 *   - toeg-11: the 800-row cap is said under the list, not in a tooltip.
 *   - toeg-13: rows are buttons without aria-pressed; the detail has a visible road-mode button.
 *   - overzicht-7: the legend shows the verdict colours, not the categories.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { announce as announceMod, answerCard, answer as answerMod, legend, listItem, uiDetail, uiList, verdict, verdictPill } from './helpers/src.mjs';

const { createAnnouncer, ANNOUNCE_DEBOUNCE_MS } = announceMod;
const { answerAnnouncement, cardHeadline } = answerCard;

const NOW = Date.parse('2026-09-28T10:00:00Z');

/** Manual timers: the announcer's debounce without real waiting. */
function fakeTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => {
      seq += 1;
      pending.set(seq, { fn, ms });
      return seq;
    },
    clearTimer: (h) => pending.delete(h),
    flush() {
      const due = [...pending.values()];
      pending.clear();
      for (const t of due) t.fn();
    },
    get size() {
      return pending.size;
    },
    get lastDelay() {
      return [...pending.values()].at(-1)?.ms;
    },
  };
}

function announcer() {
  const region = { textContent: '' };
  const timers = fakeTimers();
  const say = createAnnouncer({ region: () => region, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  return { region, timers, say };
}

describe('announce (toeg-1)', () => {
  it('writes only after the debounce, and only the last text of a burst', () => {
    const { region, timers, say } = announcer();
    say('A27, voor auto’s, nu: Rijbaan dicht bij Gorinchem.');
    say('A27, voor auto’s, morgen: Weg dicht bij Gorinchem.');
    assert.equal(region.textContent, '', 'nothing is spoken before the debounce');
    assert.equal(timers.size, 1, 'the earlier text of the burst is dropped');
    assert.equal(timers.lastDelay, ANNOUNCE_DEBOUNCE_MS);
    assert.equal(ANNOUNCE_DEBOUNCE_MS, 600);
    timers.flush();
    assert.equal(region.textContent, 'A27, voor auto’s, morgen: Weg dicht bij Gorinchem.');
  });

  it('skips a text identical to the last one announced', () => {
    const { region, timers, say } = announcer();
    say('In beeld: 3 plekken dicht.');
    timers.flush();
    region.textContent = 'marker';
    say('In beeld:   3 plekken dicht. ');
    timers.flush();
    assert.equal(region.textContent, 'marker', 'the same answer is not repeated');
    say('In beeld: niets dicht.');
    timers.flush();
    assert.equal(region.textContent, 'In beeld: niets dicht.');
  });

  it('ignores empty text and a page without a region', () => {
    const { region, timers, say } = announcer();
    say('   ');
    assert.equal(timers.size, 0);
    const none = createAnnouncer({ region: () => null, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    none('iets');
    assert.equal(timers.size, 0);
    assert.equal(region.textContent, '');
  });

  it('no list container or summary in the page markup is a live region any more', () => {
    const files = ['../index.html', ...readdirSync(new URL('../templates/', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => `../templates/${f}`)];
    for (const f of files) {
      const html = readFileSync(new URL(f, import.meta.url), 'utf8');
      assert.doesNotMatch(html, /aria-live/, `${f} has aria-live`);
    }
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.equal(index.match(/data-announce/g)?.length, 1, 'index.html has exactly one announce region');
    assert.match(index, /<p class="sr-only" role="status" data-announce><\/p>/);
    const listSrc = readFileSync(new URL('../src/ui/list.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(listSrc, /setAttribute\('aria-live'/);
  });

  it('main.ts never announces from moveend or the refresh', () => {
    const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const block = (start) => {
      const i = src.indexOf(start);
      assert.ok(i >= 0, start);
      return src.slice(i, src.indexOf('\n}', i) + 2);
    };
    assert.doesNotMatch(block('async function refresh('), /announce/);
    const moveEnd = src.slice(src.indexOf('onMoveEnd:'), src.indexOf('onBasemap:'));
    assert.doesNotMatch(moveEnd, /announce/);
  });
});

describe('the spoken answer is the card answer', () => {
  const answer = (level, headline) => ({ level, headline, specifics: [], hidden: [], counts: {}, closedRoads: 0, beyondHorizon: false, horizonMs: null });

  it('subject, mode, moment, then the headline', () => {
    const m = { road: 'A27', whenLabel: 'morgen', mode: 'auto', answer: answer('rijbaan', 'Rijbaan dicht bij Gorinchem'), total: 3 };
    assert.equal(answerAnnouncement(m), "A27, voor auto's, morgen: Rijbaan dicht bij Gorinchem.");
  });

  it('uses the headline the card shows, and names stale data', () => {
    const empty = { road: 'A2', whenLabel: 'nu', mode: 'fiets', answer: answer(null, 'x'), total: 0, dataAsOf: '20:17' };
    assert.equal(cardHeadline(empty), 'Niets gemeld');
    assert.equal(answerAnnouncement(empty), 'A2, voor fietsers, nu (gegevens van 20:17): Niets gemeld.');
    const place = { subject: 'de gemeente Utrecht', whenLabel: 'za 3 okt', mode: 'vracht', answer: answer('dicht', 'Weg dicht bij Lunetten.'), total: 1 };
    assert.equal(answerAnnouncement(place), 'De gemeente Utrecht, voor vrachtverkeer, za 3 okt: Weg dicht bij Lunetten.');
  });

  it('is never lighter than the card: the same headline for every level', () => {
    for (const level of verdict.VERDICT_SEVERITY) {
      const m = { road: 'A1', whenLabel: 'nu', mode: 'auto', answer: answer(level, `${verdict.VERDICT_META[level].label} bij X`), total: 1 };
      const html = answerCard.renderAnswerCard(m);
      assert.ok(html.includes(`>${cardHeadline(m)}</h2>`), level);
      assert.ok(answerAnnouncement(m).endsWith(`: ${cardHeadline(m)}.`), level);
    }
  });

  it('beyond the horizon the spoken headline is the card\'s "Nog niet bekend"', () => {
    const m = { road: 'A1', whenLabel: 'za 21 nov', mode: 'auto', answer: answer('onbekend', answerMod.BEYOND_HORIZON_HEADLINE), total: 4 };
    assert.equal(answerAnnouncement(m), "A1, voor auto's, za 21 nov: Nog niet bekend.");
  });
});

describe('list rows and the list cap (toeg-13, toeg-11)', () => {
  const props = { id: 'x1', cat: 'werk', sub: 'laneClosures', sev: 2, title: 'A27 · Lunetten', road: 'A27', roadType: 'A', start: '2026-09-28T08:00:00Z', end: '2026-09-28T18:00:00Z', src: 'RWS', imp: 'hinder' };

  it('a row is a plain button: no aria-pressed, aria-current only on the open one', () => {
    const m = listItem.modelFromProps(props);
    const plain = listItem.renderListItem(m, NOW);
    assert.doesNotMatch(plain, /aria-pressed/);
    assert.doesNotMatch(plain, /aria-current/);
    assert.match(listItem.renderListItem(m, NOW, { selected: true }), /aria-current="true"/);
  });

  it('says under the list that it was cut off, in words', () => {
    assert.equal(uiList.capLine(800, 1234), 'Je ziet de eerste 800 van 1.234 meldingen. Zoom in of zoek een weg om de rest te zien.');
    assert.equal(uiList.capLine(40, 40), '');
    assert.equal(uiList.capLine(40, undefined), '');
  });

  it('the summary sentence no longer carries the cap in a title', () => {
    const src = readFileSync(new URL('../src/ui/panel-answer.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /summary\.title\s*=/);
  });
});

describe('detail: "Alleen de A27 bekijken" (toeg-13)', () => {
  const fakeRoot = () => ({ innerHTML: '', querySelector: () => null });
  const props = { id: 'd1', cat: 'werk', title: 'A27 Gorinchem', road: 'A27', roadType: 'A', start: '2026-09-28T08:00:00Z', end: '2026-09-28T18:00:00Z', src: 'RWS', imp: 'rijbaan' };
  const state = (extra = {}) => ({ props, center: [5, 52], detail: null, loading: false, error: false, mode: 'auto', ...extra });
  const cb = { onBack() {}, onShare() {}, onRetry() {}, onRoad() {} };

  it('is a visible text button whose name is its text', () => {
    const root = fakeRoot();
    uiDetail.renderDetail(root, state(), NOW, cb);
    assert.match(root.innerHTML, /<button type="button" class="btn btn--secondary detail__road" data-road="A27"><span class="detail__road-badge" aria-hidden="true">/);
    assert.match(root.innerHTML, /<span>Alleen de A27 bekijken<\/span><\/button>/);
    assert.doesNotMatch(root.innerHTML, /class="item__badge detail__badge"/, 'the badge itself is no longer the only (mouse-only) target');
  });

  it('is left out when the app already shows only that road, or cannot enter road mode', () => {
    const inRoad = fakeRoot();
    uiDetail.renderDetail(inRoad, state({ roadMode: 'A27' }), NOW, cb);
    assert.doesNotMatch(inRoad.innerHTML, /Alleen de A27 bekijken/);
    const noCb = fakeRoot();
    uiDetail.renderDetail(noCb, state(), NOW, { onBack() {}, onShare() {}, onRetry() {} });
    assert.doesNotMatch(noCb.innerHTML, /Alleen de A27 bekijken/);
  });
});

describe('pills differ without colour (toeg-2)', () => {
  it('"Weg dicht" carries a cross, the others a dot', () => {
    const dicht = verdictPill.renderVerdictPill({ level: 'dicht', label: 'Weg dicht' });
    assert.match(dicht, /class="vpill__icon" aria-hidden="true"><svg/);
    assert.doesNotMatch(dicht, /vpill__dot/);
    for (const level of ['rijbaan', 'hinder', 'geen', 'nvt', 'onbekend']) {
      assert.match(verdictPill.renderVerdictPill({ level, label: 'x' }), /vpill__dot/, level);
    }
  });

  it('the static uitleg pill in index.html matches', () => {
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(index, /vpill--dicht vpill--sm"[^>]*><span class="vpill__icon" aria-hidden="true"><svg/);
  });
});

describe('topbar without counters (toeg-9)', () => {
  it('no page or partial has the counters container', () => {
    const files = ['../index.html', '../templates/partials/header.html', ...readdirSync(new URL('../templates/', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => `../templates/${f}`)];
    for (const f of files) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /data-counters|topbar__counters/, f);
  });
});

describe('legend speaks the verdict language (overzicht-7)', () => {
  it('lists a line swatch per verdict level, worst first, with the pill labels', () => {
    const html = legend.verdictLinesHtml();
    const labels = [...html.matchAll(/legend__vline--(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(labels, [...verdict.VERDICT_SEVERITY]);
    for (const level of verdict.VERDICT_SEVERITY) {
      assert.ok(html.includes(`var(${verdict.VERDICT_META[level].color})`), `${level} uses its --v-* colour`);
      assert.ok(html.includes(verdict.VERDICT_META[level].label), `${level} label`);
    }
    assert.ok(labels.includes('onbekend'));
  });

  it('no longer lists the category colours', () => {
    const src = readFileSync(new URL('../src/ui/legend.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /ALL_CATEGORIES/);
  });
});
