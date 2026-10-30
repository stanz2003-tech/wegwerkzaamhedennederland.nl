/**
 * The server-visible content of road and place pages (ui/entity-snapshot.ts, ui/road-questions.ts,
 * scripts/lib/snapshot.mjs): what crawlers that run no script read. Pinned with the fixture roads
 * and gemeenten, at the fixture's "now" (wednesday 9 September 2026, 14:00).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadFixtureData, readJson } from './helpers/fixtures.mjs';
import { entityFile, entityList, entitySections, entitySnapshot, roadQuestions, time } from './helpers/src.mjs';
import { createSnapshotter, loadEntityFiles, loadSnapshotModules } from '../scripts/lib/snapshot.mjs';

const NOW = loadFixtureData().now;
const road = (slug) => readJson(`roads/${slug}.json`).items;
const gemeente = (slug) => readJson(`gemeenten/${slug}.json`).items;
const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const { entitySnapshot: snapshotOf, SNAPSHOT_ROWS } = entitySnapshot;
const { roadQuestions: questionsOf, placeQuestions, renderRoadQuestions, nightWindow } = roadQuestions;

describe('entitySnapshot', () => {
  it('a road: the answer card for nu, the stamp with the count and the roadworks as text', () => {
    const snap = snapshotOf({ items: road('a2'), subject: { kind: 'road', name: 'A2' }, roadType: 'A', now: NOW, asOf: 'wo 9 sep 14:00', mapHref: '/?b=1' });
    assert.equal(snap.count, 2);
    assert.match(snap.headline, /^Rijbaan dicht/);
    assert.match(text(snap.answerHtml), /Kan ik nu over de A2\?/);
    assert.match(text(snap.answerHtml), /gegevens van wo 9 sep 14:00/);
    const list = text(snap.listHtml);
    assert.match(list, /^Stand van wo 9 sep 14:00: 2 meldingen op de A2, nu en de komende 30 dagen\./);
    assert.match(list, /Vinkeveen → Holendrecht/);
    assert.match(list, /Nu actief/);
  });

  it('a gemeente: at most SNAPSHOT_ROWS rows, then "en nog N" with a link to the map', () => {
    const items = gemeente('amsterdam');
    const snap = snapshotOf({ items, subject: { kind: 'gemeente', name: 'Amsterdam' }, now: NOW, asOf: 'x', mapHref: '/?c=4.9,52.37&z=11', limit: 3 });
    const rows = (snap.listHtml.match(/<a class="item[" ]/g) ?? []).length;
    assert.ok(rows >= 3, 'the first rows are there');
    if (snap.count > 3) assert.match(snap.listHtml, /En nog \d+ meldingen?: <a href="\/\?c=4\.9,52\.37&amp;z=11">bekijk ze op de kaart<\/a>/);
    assert.ok(SNAPSHOT_ROWS >= 10 && SNAPSHOT_ROWS <= 20);
  });

  it('nothing reported: says so for that moment, never as a timeless fact', () => {
    const snap = snapshotOf({ items: [], subject: { kind: 'woonplaats', name: 'Lexmond' }, now: NOW, asOf: 'wo 9 sep 14:00', mapHref: '/' });
    assert.equal(snap.count, 0);
    assert.equal(text(snap.listHtml), 'Stand van wo 9 sep 14:00: bij NDW waren geen werkzaamheden of afsluitingen in Lexmond gemeld voor nu en de komende 30 dagen.');
    assert.match(text(snap.answerHtml), /Niets gemeld/);
  });

  it('lists the same sections, in the same order, as the page script', () => {
    const items = road('a2');
    const rows = items.map((it) => entityFile.indexItemFromFeature(it.f, NOW));
    const sections = entitySections.entitySections({ subjectKind: 'road', mode: 'auto', active: rows, upcoming: [], now: NOW, listOpts: {} });
    assert.deepEqual(sections.map((s) => s.title), ['Nu actief', 'Gepland (komende 30 dagen)']);
    const { html, more } = entityList.renderSectionsHtml(sections, NOW, {}, 1);
    assert.equal((html.match(/<a class="item[" ]/g) ?? []).length, 1);
    assert.equal(more, 1);
  });
});

describe('roadQuestions', () => {
  it('answers today, tonight, the weekend and how long, from the same answers as the card', () => {
    const qs = questionsOf(road('a2'), 'A2', NOW);
    assert.deepEqual(qs.map((q) => q.q), ['Is de A2 vandaag dicht?', 'Is de A2 vannacht dicht?', 'Is de A2 dit weekend dicht?', 'Hoe lang is de A2 nog dicht?']);
    const by = Object.fromEntries(qs.map((q) => [q.id, q.a]));
    assert.match(by.vandaag, /^Ja\. Rijbaan dicht /);
    assert.match(by.vannacht, /^Ja\. Rijbaan dicht /, 'closed until 04:00, so tonight too');
    assert.equal(by.weekend, 'Nee, voor dit weekend is op de A2 geen afsluiting gemeld.');
    assert.match(by.hoelang, /^Rijbaan dicht .*: tot /);
  });

  it('a road without anything says no, and how long names the next closure or none', () => {
    const qs = questionsOf([], 'N999', NOW);
    assert.equal(qs[0].a, 'Nee, voor vandaag is op de N999 geen afsluiting gemeld.');
    assert.equal(qs[3].a, 'Nu is de N999 niet dicht, en voor de komende 30 dagen is geen afsluiting gemeld.');
  });

  it('"vannacht" is 21:00–06:00 local time, from now on', () => {
    const w = nightWindow(NOW); // 14:00 CEST
    assert.equal(time.wallClockKey(w.from), '21:00');
    assert.equal(time.wallClockKey(w.to + 1), '06:00');
    const early = Date.parse('2026-09-10T02:00:00Z'); // 04:00 CEST
    assert.equal(nightWindow(early).from, early);
    assert.equal(time.wallClockKey(nightWindow(early).to + 1), '06:00');
  });

  it('a place: today, tomorrow, the weekend and the next closure, from the same answers as the card', () => {
    const qs = placeQuestions(road('a2'), { kind: 'woonplaats', name: 'Vinkeveen' }, NOW);
    assert.deepEqual(qs.map((q) => q.id), ['vandaag', 'morgen', 'weekend', 'volgende']);
    assert.deepEqual(qs.map((q) => q.q), [
      'Is er vandaag een weg dicht in Vinkeveen?',
      'Is er morgen een weg dicht in Vinkeveen?',
      'Is er dit weekend een weg dicht in Vinkeveen?',
      'Wanneer is de eerstvolgende afsluiting in Vinkeveen?',
    ]);
    const by = Object.fromEntries(qs.map((q) => [q.id, q.a]));
    // A place page names the road of a closure: "A2 rijbaan dicht tussen Hintham en Vught".
    assert.match(by.vandaag, /^Ja\. A2 rijbaan dicht /);
    assert.match(by.morgen, /^Ja\. A2 rijbaan dicht /, 'closed until 04:00 tomorrow');
    assert.equal(by.weekend, 'Nee, voor dit weekend is in Vinkeveen geen afsluiting gemeld.');
    assert.match(by.volgende, /^Er is nu al een afsluiting: A2 rijbaan dicht .*\(/);
  });

  it('a gemeente says "in de gemeente"; nothing reported is a no for every question', () => {
    const qs = placeQuestions([], { kind: 'gemeente', name: 'Lopik' }, NOW);
    assert.equal(qs[0].q, 'Is er vandaag een weg dicht in de gemeente Lopik?');
    assert.equal(qs[0].a, 'Nee, voor vandaag is in de gemeente Lopik geen afsluiting gemeld.');
    assert.equal(qs[1].a, 'Nee, voor morgen is in de gemeente Lopik geen afsluiting gemeld.');
    assert.equal(qs[3].a, 'Voor de komende 30 dagen is in de gemeente Lopik geen afsluiting gemeld.');
  });

  it('renders a definition list with the moment of the data', () => {
    const html = renderRoadQuestions([{ id: 'vandaag', q: 'Is de A2 vandaag dicht?', a: 'Nee & niets.' }], 'stand van wo 9 sep 14:00');
    assert.equal(
      html,
      "<dl class=\"road-questions__list\"><div class=\"road-questions__item\" data-q=\"vandaag\"><dt>Is de A2 vandaag dicht?</dt><dd>Nee &amp; niets.</dd></div></dl><p class=\"road-questions__meta\">Voor auto's · stand van wo 9 sep 14:00</p>",
    );
  });
});

describe('snapshot.mjs (build side)', () => {
  const fixtureFetch = (missing = new Set(), failing = new Set()) => async (url) => {
    const rel = new URL(url).pathname.replace(/^\/v1\//, '');
    if (failing.has(rel)) return { ok: false, status: 500, json: async () => ({}) };
    if (missing.has(rel)) return { ok: false, status: 404, json: async () => ({}) };
    try {
      const body = readJson(rel);
      return { ok: true, status: 200, json: async () => body };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };

  it('loads entity files: items, null for 404, undefined (with a warning) for a failure', async () => {
    const warnings = [];
    const mods = await loadSnapshotModules();
    const files = await loadEntityFiles({
      dataBase: 'https://data.example.nl/v1',
      roads: ['a2', 'a999', 'a12'],
      gemeenten: ['utrecht'],
      fetchImpl: fixtureFetch(new Set(), new Set(['roads/a12.json'])),
      isEntityFile: mods.load.isEntityFile,
      warn: (m) => warnings.push(m),
    });
    assert.equal(files.roads.get('a2').length, 2);
    assert.equal(files.roads.get('a999'), null);
    assert.equal(files.roads.get('a12'), undefined);
    assert.ok(Array.isArray(files.gemeenten.get('utrecht')));
    assert.equal(files.failed, 1);
    assert.match(warnings[0], /roads\/a12\.json niet geladen \(HTTP 500\)/);
  });

  it('builds snapshots for road, gemeente and woonplaats pages; a failed file falls back to the index', async () => {
    const mods = await loadSnapshotModules();
    const files = await loadEntityFiles({
      dataBase: 'https://data.example.nl/v1/',
      roads: ['a2', 'a12'],
      gemeenten: ['utrecht'],
      fetchImpl: fixtureFetch(new Set(), new Set(['roads/a12.json'])),
      isEntityFile: mods.load.isEntityFile,
      warn: () => {},
    });
    const live = { index: readJson('index/all.json'), meta: readJson('meta.json') };
    const snapshotFor = createSnapshotter({ mods, live, files, now: NOW });

    const a2 = snapshotFor({ type: 'road', entity: { road: 'A2', slug: 'a2', type: 'A' } }, { mapHref: '/' });
    assert.equal(a2.count, 2);
    assert.match(a2.questionsHtml, /Is de A2 vannacht dicht\?/);
    assert.match(a2.asOf, /9 sep/);

    const a12 = snapshotFor({ type: 'road', entity: { road: 'A12', slug: 'a12', type: 'A' } }, { mapHref: '/' });
    const a12Index = live.index.rows.filter((r) => mods.entity.matchesRoad(r[5], 'A12')).length;
    assert.ok(a12Index > 0, 'the fixture index has A12 rows');
    assert.ok(a12.count > 0, 'the index fallback found the A12 items');

    const utrecht = snapshotFor({ type: 'place', kind: 'gemeente', entity: { naam: 'Utrecht', slug: 'utrecht' } }, { mapHref: '/' });
    assert.ok(utrecht.count > 0);
    assert.match(utrecht.questionsHtml, /Is er vandaag een weg dicht in de gemeente Utrecht\?/);
    assert.match(utrecht.questionsHtml, /stand van /);

    const all = files.gemeenten.get('utrecht');
    const villages = new Set(all.map((it) => it.f.properties.woonplaats).filter(Boolean));
    const village = [...villages][0];
    const wp = snapshotFor({ type: 'place', kind: 'woonplaats', entity: { naam: village, gemeente: 'Utrecht', slug: 'x' } }, { mapHref: '/' });
    assert.ok(wp.count > 0 && wp.count <= utrecht.count);

    assert.equal(snapshotFor({ type: 'bridge', entity: { id: 'x' } }, { mapHref: '/' }), null);
  });

  it('gives /afsluitingen/ and /dit-weekend/ their summary and first rows, /files/ nothing', async () => {
    const mods = await loadSnapshotModules();
    const live = { index: readJson('index/all.json'), bridges: readJson('bruggen.json'), meta: readJson('meta.json') };
    const snapshotFor = createSnapshotter({ mods, live, files: null, now: NOW });
    const closures = snapshotFor({ type: 'list', list: 'afsluitingen' }, { mapHref: '/' });
    assert.ok(closures.summary.length > 0);
    assert.match(text(closures.listHtml), new RegExp(`^Stand van ${closures.asOf}: `));
    assert.ok((closures.listHtml.match(/<a class="item[" ]/g) ?? []).length > 0);
    assert.ok(snapshotFor({ type: 'list', list: 'weekend' }, { mapHref: '/' }));
    assert.equal(snapshotFor({ type: 'list', list: 'files' }, { mapHref: '/' }), null);
  });

  it('gives a bridge its next opening, or nothing when none is planned', async () => {
    const mods = await loadSnapshotModules();
    const bridges = readJson('bruggen.json');
    const live = { index: readJson('index/all.json'), bridges, meta: readJson('meta.json') };
    const snapshotFor = createSnapshotter({ mods, live, files: null, now: NOW });
    const open = bridges.bridges.find((b) => b.openNow);
    assert.match(snapshotFor({ type: 'bridge', entity: { id: open.id } }, { mapHref: '/' }).openingsHtml, /de brug stond open voor de scheepvaart/);
    const planned = bridges.bridges.find((b) => !b.openNow && b.openings.length > 0);
    if (planned) {
      const html = snapshotFor({ type: 'bridge', entity: { id: planned.id } }, { mapHref: '/' }).openingsHtml;
      assert.match(html, /geplande opening/);
      // The openings themselves, per day with their times: what a reader of the HTML came for.
      assert.match(html, /<li class="bridge-openings__day">/);
      assert.match(html, /<time datetime="[^"]+">\d\d:\d\d<\/time>–<time/);
      assert.doesNotMatch(html, /Vandaag|Morgen/, 'the HTML outlives the day it was built: no relative day names');
    }
    assert.equal(snapshotFor({ type: 'bridge', entity: { id: 'ONBEKEND' } }, { mapHref: '/' }), null);
  });

  it('stops fetching when its time budget is used up: the rest falls back to the index', async () => {
    const mods = await loadSnapshotModules();
    const hanging = (url, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('afgebroken')), { once: true }));
    const t0 = Date.now();
    const files = await loadEntityFiles({ dataBase: 'https://data.example.nl/v1/', roads: ['a1', 'a2', 'a4'], gemeenten: [], fetchImpl: hanging, isEntityFile: mods.load.isEntityFile, warn: () => {}, budgetMs: 50 });
    assert.ok(Date.now() - t0 < 5_000, 'did not wait for the per-file timeouts');
    assert.equal(files.failed, 3);
    assert.equal(files.roads.get('a2'), undefined);
  });

  it('makes no snapshots without live data', () => {
    assert.equal(createSnapshotter({ mods: {}, live: null, files: null, now: NOW }), null);
  });
});
