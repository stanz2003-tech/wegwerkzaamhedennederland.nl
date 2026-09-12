/**
 * Regression tests for the window semantics of the four data-driven list pages
 * (/afsluitingen/, /files/, /vandaag/, /dit-weekend/).
 *
 * Before this, every page counted "overlaps the window" as "nu actief", so /dit-weekend/
 * reported 4.544 meldingen as active for a weekend — nearly all of them years-long measures
 * that merely cross Friday 20:00. These tests pin down the split (`groupByWindow` against the
 * *calendar* bounds of the window from `LIST_WINDOW`) and the Dutch sentence that names it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filter, format, listSummary as summaryModule, time } from './helpers/src.mjs';

const { groupByWindow } = filter;
const { backgroundPhrase, windowSummary } = format;
const { MS } = time;
const { BACKGROUND_TITLE, LIST_TITLES, LIST_WINDOW, listSummary } = summaryModule;

/** Wednesday 2026-09-09, 14:00 in Europe/Amsterdam. */
const WED = Date.parse('2026-09-09T12:00:00Z');
/** Saturday 2026-09-12, 14:00 local — inside the Friday 20:00 → Monday 06:00 weekend. */
const SAT = Date.parse('2026-09-12T12:00:00Z');

const iso = (ms) => new Date(ms).toISOString();
const item = (id, startMs, endMs) => ({ id, start: iso(startMs), end: endMs === null ? null : iso(endMs) });

/** A measure that has been standing for years and runs for years more. */
const semiPermanent = (id, now) => item(id, now - 900 * MS.day, now + 900 * MS.day);

const ids = (list) => list.map((i) => i.id);

describe('list pages use the window the page is about', () => {
  it('maps every page to its time window', () => {
    assert.deepEqual(LIST_WINDOW, { afsluitingen: '7d', files: 'nu', vandaag: 'vandaag', weekend: 'weekend' });
  });

  it('names the collapsed background group once for the whole site', () => {
    assert.equal(BACKGROUND_TITLE, 'Loopt al langer');
    for (const id of Object.keys(LIST_WINDOW)) {
      assert.ok(LIST_TITLES[id].backgroundNote.length > 20, `${id} explains the group`);
      assert.ok(LIST_TITLES[id].active.length > 0, `${id} has an active heading`);
    }
    assert.equal(LIST_TITLES.files.upcoming, '', 'a traffic jam is never planned');
  });
});

describe('/dit-weekend/ counts what changes in the weekend', () => {
  const items = [
    item('weekendafsluiting', Date.parse('2026-09-11T20:00:00Z'), Date.parse('2026-09-13T04:00:00Z')),
    item('start-zaterdagnacht', Date.parse('2026-09-12T20:00:00Z'), Date.parse('2026-09-13T04:00:00Z')),
    semiPermanent('breedtebeperking', SAT),
    semiPermanent('meerjarige-afsluiting', SAT),
    item('volgende-week', Date.parse('2026-09-15T06:00:00Z'), Date.parse('2026-09-15T16:00:00Z')),
    item('vorige-week', Date.parse('2026-09-01T06:00:00Z'), Date.parse('2026-09-02T16:00:00Z')),
  ];

  const groups = groupByWindow(items, LIST_WINDOW.weekend, SAT);

  it('keeps only the measures that start or end inside the weekend as changes', () => {
    assert.deepEqual(ids(groups.changes), ['weekendafsluiting', 'start-zaterdagnacht']);
  });

  it('moves the semi-permanent measures to the background group', () => {
    assert.deepEqual(ids(groups.background), ['breedtebeperking', 'meerjarige-afsluiting']);
  });

  it('drops what does not touch the weekend at all', () => {
    const kept = new Set([...ids(groups.changes), ...ids(groups.background)]);
    assert.equal(kept.has('volgende-week'), false);
    assert.equal(kept.has('vorige-week'), false);
  });

  it('never puts one item in both groups', () => {
    const overlap = ids(groups.changes).filter((id) => ids(groups.background).includes(id));
    assert.deepEqual(overlap, []);
  });

  it('reports the real numbers in Dutch instead of one inflated total', () => {
    assert.equal(
      listSummary('weekend', { changes: 2, active: 1, upcoming: 1, background: 2 }),
      '2 meldingen dit weekend · 1 nu al actief · 2 langdurige maatregelen lopen al langer',
    );
  });
});

describe('/vandaag/ separates today from the standing situation', () => {
  it('counts a measure that starts later today as a change and a years-long one as background', () => {
    const items = [
      item('vanavond', Date.parse('2026-09-09T18:00:00Z'), Date.parse('2026-09-09T21:00:00Z')),
      item('sinds-gisteren-kort', WED - 2 * MS.day, WED + 2 * MS.day),
      semiPermanent('sinds-2024', WED),
    ];
    const groups = groupByWindow(items, LIST_WINDOW.vandaag, WED);
    assert.deepEqual(ids(groups.changes), ['vanavond', 'sinds-gisteren-kort']);
    assert.deepEqual(ids(groups.background), ['sinds-2024']);
  });

  it('says what the numbers mean', () => {
    assert.equal(
      listSummary('vandaag', { changes: 34, active: 12, upcoming: 22, background: 4729 }),
      '34 meldingen vandaag · 12 nu al actief · 4.729 langdurige maatregelen lopen al langer',
    );
    assert.equal(
      listSummary('vandaag', { changes: 0, active: 0, upcoming: 0, background: 0 }),
      'Er is nog niets aangemeld voor vandaag',
    );
  });
});

describe('/afsluitingen/ uses the seven-day horizon', () => {
  const items = [
    item('eindigt-overmorgen', WED - 3 * MS.day, WED + 2 * MS.day),
    item('start-vrijdag', WED + 2 * MS.day, WED + 3 * MS.day),
    item('start-over-tien-dagen', WED + 10 * MS.day, WED + 11 * MS.day),
    semiPermanent('meerjarige-stremming', WED),
  ];
  const groups = groupByWindow(items, LIST_WINDOW.afsluitingen, WED);

  it('treats a closure that ends or starts within a week as news', () => {
    assert.deepEqual(ids(groups.changes), ['eindigt-overmorgen', 'start-vrijdag']);
  });

  it('parks the multi-year closures in the background group', () => {
    assert.deepEqual(ids(groups.background), ['meerjarige-stremming']);
  });

  it('spells out both halves of the count', () => {
    assert.equal(
      listSummary('afsluitingen', { changes: 40, active: 12, upcoming: 28, background: 3024 }),
      '12 afsluitingen nu dicht · 28 start binnen 7 dagen · 3.024 langdurige maatregelen lopen al langer',
    );
    assert.equal(
      listSummary('afsluitingen', { changes: 0, active: 0, upcoming: 0, background: 0 }),
      'Op dit moment zijn er geen afsluitingen gemeld',
    );
    assert.equal(
      listSummary('afsluitingen', { changes: 0, active: 0, upcoming: 0, background: 7 }),
      'Nu niets afgesloten · 7 langdurige maatregelen lopen al langer',
    );
  });
});

describe('/files/ shows what is running now and nothing stale', () => {
  const items = [
    item('file-nu', WED - 20 * MS.minute, null),
    item('file-met-eind', WED - 10 * MS.minute, WED + 30 * MS.minute),
    semiPermanent('blijft-hangen', WED),
    item('afgelopen', WED - 3 * MS.hour, WED - 1 * MS.hour),
    item('nog-niet-begonnen', WED + MS.hour, WED + 2 * MS.hour),
  ];
  const groups = groupByWindow(items, LIST_WINDOW.files, WED);

  it('keeps the running jams and drops what is over or not started', () => {
    assert.deepEqual(ids(groups.changes), ['file-nu', 'file-met-eind']);
  });

  it('does not call a record that has been open for years a traffic jam', () => {
    assert.deepEqual(ids(groups.background), ['blijft-hangen']);
  });

  it('has its own wording, with the stale records named separately', () => {
    assert.equal(listSummary('files', { changes: 3, active: 3, upcoming: 0, background: 0 }), '3 files op dit moment');
    assert.equal(
      listSummary('files', { changes: 1, active: 1, upcoming: 0, background: 2 }),
      '1 file op dit moment · 2 langdurige maatregelen lopen al langer',
    );
    assert.equal(listSummary('files', { changes: 0, active: 0, upcoming: 0, background: 0 }), 'Op dit moment zijn er geen files gemeld');
  });
});

describe('backgroundPhrase', () => {
  it('is grammatical in the singular', () => {
    assert.equal(backgroundPhrase(1), '1 langdurige maatregel loopt al langer');
    assert.equal(backgroundPhrase(2), '2 langdurige maatregelen lopen al langer');
    assert.equal(backgroundPhrase(4729), '4.729 langdurige maatregelen lopen al langer');
  });

  it('is the same sentence windowSummary ends with', () => {
    assert.ok(windowSummary({ changes: 1, active: 0, background: 12 }, 'vandaag').endsWith(backgroundPhrase(12)));
  });
});
