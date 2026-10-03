/**
 * Regression tests for the generated entity pages (/weg/…, /gemeente/…, /plaats/…, /brug/…):
 *
 *  1. they now rank with the shared `compareByImpact` from data/filter.ts, so a closure that
 *     starts tonight beats a width restriction that has been standing since 2019 — the entity
 *     pages used to sort on raw severity and put the multi-year measures on top;
 *  2. their small map draws the real LineString geometry of its items instead of the
 *     representative point of every index row (data/entity-geometry.ts);
 *  3. the answer stands directly under the title, without counters (mobiel-7, overzicht-5);
 *  4. mode and moment travel between the map and these pages in both directions (zoek-10, zoek-6).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { answerCard, entity, entityGeometry, entityList, filter, forecast, mapLink, panelAnswer, time, urlState } from './helpers/src.mjs';

const { compareImpact, compareStart, splitForEntity, mapFeatures } = entity;
const { hasLineGeometry, neededCollections, pickByIds } = entityGeometry;
const { compareByImpact } = filter;
const { MS } = time;

const NOW = Date.parse('2026-09-09T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/** An index row as `rowsToItems` produces it. */
function row(id, over = {}) {
  return {
    id,
    cat: 'werk',
    sub: null,
    sev: 2,
    title: id,
    road: 'A2',
    roadType: 'A',
    gemeente: 'Utrecht',
    woonplaats: 'Utrecht',
    prov: 'Utrecht',
    start: iso(NOW - MS.hour),
    end: iso(NOW + MS.hour),
    lon: 5.1,
    lat: 52.09,
    closed: false,
    hind: null,
    active: true,
    ...over,
  };
}

describe('entity pages rank like the map list', () => {
  const tonight = row('vannacht-dicht', {
    cat: 'afsluiting',
    sev: 2,
    closed: true,
    start: iso(NOW + 8 * MS.hour),
    end: iso(NOW + 16 * MS.hour),
    active: true,
  });
  const semiPermanent = row('breedtebeperking', {
    cat: 'afsluiting',
    sev: 4,
    start: iso(Date.parse('2019-06-01T00:00:00Z')),
    end: iso(Date.parse('2031-05-31T22:00:00Z')),
    active: true,
  });

  it('delegates to the shared comparator once both items are active', () => {
    assert.equal(
      Math.sign(compareImpact(tonight, semiPermanent, NOW)),
      Math.sign(compareByImpact(tonight, semiPermanent, NOW)),
    );
  });

  it('puts the measure that changes tonight above the years-old one, despite lower severity', () => {
    assert.ok(compareImpact(tonight, semiPermanent, NOW) < 0);
    assert.deepEqual([semiPermanent, tonight].sort((a, b) => compareImpact(a, b, NOW)).map((i) => i.id), [
      'vannacht-dicht',
      'breedtebeperking',
    ]);
  });

  it('still keeps what the pipeline marked active above what is only planned', () => {
    const planned = row('gepland', { sev: 4, active: false, start: iso(NOW + 3 * MS.day), end: iso(NOW + 4 * MS.day) });
    assert.ok(compareImpact(tonight, planned, NOW) < 0);
  });

  it('sorts the two sections of splitForEntity by impact and by start', () => {
    const items = [semiPermanent, tonight, row('over-drie-dagen', { active: false, start: iso(NOW + 3 * MS.day), end: iso(NOW + 4 * MS.day) }), row('morgen', { active: false, start: iso(NOW + MS.day), end: iso(NOW + 2 * MS.day) }), row('afgelopen', { active: false, start: iso(NOW - 3 * MS.day), end: iso(NOW - MS.day) })];
    const { active, upcoming } = splitForEntity(items, NOW);
    assert.deepEqual(active.map((i) => i.id), ['vannacht-dicht', 'breedtebeperking']);
    assert.deepEqual(upcoming.map((i) => i.id), ['morgen', 'over-drie-dagen'], 'ended items are dropped');
  });

  it('leaves compareStart as the order of the planned section', () => {
    const a = row('a', { active: false, start: iso(NOW + MS.day) });
    const b = row('b', { active: false, start: iso(NOW + 2 * MS.day) });
    assert.ok(compareStart(a, b) < 0);
  });

  it('defaults `now` so existing callers keep working', () => {
    assert.equal(typeof compareImpact(tonight, semiPermanent), 'number');
  });
});

describe('entity maps load the real geometry of their own items', () => {
  const point = (id) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [5.1, 52.09] }, properties: { id, cat: 'werk', sev: 2, title: id, start: iso(NOW), src: 'x' } });
  const lineFeature = (id) => ({
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates: [[4.94063, 52.20115], [5.02891, 52.09984]] },
    properties: { id, cat: 'werk', sev: 2, title: id, start: iso(NOW), src: 'x' },
  });

  it('asks only for the collections the page actually needs', () => {
    assert.deepEqual(neededCollections([]), { actueel: false, live: false, gepland: false });
    assert.deepEqual(neededCollections([row('a')]), { actueel: true, live: false, gepland: false });
    assert.deepEqual(neededCollections([row('c', { cat: 'file' })]), { actueel: false, live: true, gepland: false });
  });

  it('never downloads the planned collection for a page map unless asked', () => {
    // werk-gepland is ≈ 1.15 MB gzipped: too much for the small map of a page a visitor may reach
    // straight from a search engine. Planned items keep their index point instead.
    const planned = row('b', { active: false });
    assert.deepEqual(neededCollections([planned]), { actueel: false, live: false, gepland: false });
    assert.deepEqual(neededCollections([planned], { includePlanned: true }), {
      actueel: false,
      live: false,
      gepland: true,
    });
    assert.deepEqual(neededCollections([row('d', { cat: 'brug' }), planned]), {
      actueel: false,
      live: true,
      gepland: false,
    });
  });

  it('keeps only the features of this page, once each', () => {
    const ids = new Set(['a', 'b']);
    const picked = pickByIds([lineFeature('a'), point('z'), lineFeature('b'), point('a')], ids);
    assert.deepEqual(picked.map((f) => f.properties.id), ['a', 'b']);
    assert.equal(picked[0].geometry.type, 'LineString');
  });

  it('recognises the geometry an index row could never express', () => {
    assert.equal(hasLineGeometry(lineFeature('a')), true);
    assert.equal(hasLineGeometry(point('a')), false);
    assert.equal(
      hasLineGeometry({ ...lineFeature('a'), geometry: { type: 'MultiLineString', coordinates: [[[5, 52], [5.1, 52.1]]] } }),
      true,
    );
  });

  it('replaces the index point with the real line for the same id', () => {
    const items = [row('a'), row('b')];
    const before = mapFeatures(items);
    assert.deepEqual(before.map((f) => f.geometry.type), ['Point', 'Point']);
    const after = mapFeatures(items, [lineFeature('a')]);
    assert.deepEqual(after.map((f) => f.geometry.type), ['LineString', 'Point']);
    assert.equal(after.filter((f) => hasLineGeometry(f)).length, 1);
  });

  it('never adds a feature the page does not show', () => {
    const items = [row('a')];
    const after = mapFeatures(items, [lineFeature('a'), lineFeature('elders')]);
    assert.deepEqual(after.map((f) => f.properties.id), ['a']);
  });
});

describe('the answer stands directly under the title (mobiel-7, vooruit-7, overzicht-5, taal-11)', () => {
  const tpl = (name) => readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8');

  for (const name of ['road.html', 'place.html']) {
    it(`${name}: header, then the forecast, then the list; the intro below the list`, () => {
      const html = tpl(name);
      const header = html.indexOf('</header>');
      const forecastAt = html.indexOf('<section class="entity-forecast" id="entity-forecast"');
      const live = html.indexOf('class="entity-live"');
      const intro = html.indexOf('{{{intro}}}');
      assert.ok(header > 0 && forecastAt > header && live > forecastAt && intro > live, name);
      // Nothing but whitespace between the header and the forecast block.
      assert.match(html.slice(header, forecastAt), /^<\/header>\s*$/);
      assert.match(html, /<section class="entity-about" aria-labelledby="over-title">/);
    });

    it(`${name}: no counters or count sentence in the head`, () => {
      const html = tpl(name);
      assert.doesNotMatch(html, /entity-counts|entity-count-active|entity-summary|Nu actief/);
      assert.match(html, /Pagina bijgewerkt <time id="entity-updated"/);
    });

    it(`${name}: the no-JS map link and the "Op de grote kaart" button are both present`, () => {
      const html = tpl(name);
      assert.match(html, /class="entity-map__fallback">[^<]*<a href="\{\{mapHref\}\}">/);
      assert.match(html, /id="entity-map-link" href="\{\{mapHref\}\}">Op de grote kaart<\/a>/);
    });
  }

  it('keeps the h1 texts and drops the PLAATS placeholder badge', () => {
    assert.match(tpl('road.html'), /<h1>Wegwerkzaamheden \{\{road\}\}<\/h1>/);
    assert.match(tpl('place.html'), /<h1>\{\{heading\}\}<\/h1>/);
    assert.doesNotMatch(tpl('place.html'), /badge--place|\}\}Gem\./);
  });

  it('the count sentence helpers are gone', () => {
    assert.equal(entityList.summaryText, undefined);
    assert.equal(entityList.countsSentence, undefined);
  });
});

describe('mode and moment travel between map and entity pages (zoek-10, zoek-6)', () => {
  const { mapContextQuery, timeParam, roadPageHref, entityMapHref, cameraParams, selectionFromUrl, withQuery } = mapLink;
  // Saturday 3 October 2026, 10:00 in Amsterdam.
  const SAT = Date.parse('2026-10-03T08:00:00Z');
  const cells = forecast.dayStrip([], 'auto', SAT);
  const at = urlState.parseLocalDateTime('2026-10-03T08:00');

  it('an entity-page selection becomes the ?v= / ?t= the map parses', () => {
    assert.equal(mapContextQuery('auto', { kind: 'all' }, SAT), '');
    const q = mapContextQuery('vracht', { kind: 'moment', at }, SAT);
    assert.equal(q, 'v=vracht&t=2026-10-03T08:00');
    const parsed = urlState.parseUrlState(`?${q}`);
    assert.equal(parsed.mode, 'vracht');
    assert.equal(parsed.moment, at);
    assert.equal(mapContextQuery('fiets', { kind: 'day', cell: cells[0], index: 0 }, SAT), 'v=fiets&t=vandaag');
    assert.equal(mapContextQuery('auto', { kind: 'day', cell: cells[1], index: 1 }, SAT), 't=morgen');
    assert.equal(urlState.parseUrlState('?t=morgen').time, 'morgen');
    // A later strip day has no map window yet: only the mode travels, never a different moment.
    assert.equal(mapContextQuery('vracht', { kind: 'day', cell: cells[3], index: 3 }, SAT), 'v=vracht');
  });

  it('every list row links to the map with the page question', () => {
    assert.equal(
      entityList.itemHref('a/b', { mapQuery: 'v=vracht&t=2026-10-03T08:00', linkQuery: 'cat=file' }),
      '/?id=a%2Fb&v=vracht&t=2026-10-03T08:00&cat=file',
    );
    assert.equal(entityList.itemHref('x', { mapQuery: '' }), '/?id=x');
  });

  it('"Op de grote kaart" opens road or place mode with the same question', () => {
    assert.equal(entityMapHref({ kind: 'road', slug: 'a27' }, 'v=vracht&t=2026-10-03T08:00'), '/?weg=a27&v=vracht&t=2026-10-03T08:00');
    assert.equal(entityMapHref({ kind: 'road', slug: 'a27' }, ''), '/?weg=a27');
    const camera = cameraParams('/?c=4.9500,51.7700&z=12');
    assert.equal(camera, 'c=4.9500,51.7700&z=12');
    assert.equal(entityMapHref({ kind: 'woonplaats', slug: 'almkerk' }, 'v=fiets', camera), '/?plaats=almkerk&c=4.9500,51.7700&z=12&v=fiets');
    assert.equal(entityMapHref({ kind: 'gemeente', slug: 'altena' }, ''), '/?gemeente=altena');
    assert.equal(cameraParams('/?b=1,2,3,4'), '');
    assert.equal(withQuery('/x', '', undefined), '/x');
  });

  it('the map links to the road page with mode and moment, and the page opens on them', () => {
    assert.equal(roadPageHref('A27', { mode: 'vracht', time: 'nu', moment: at }), '/weg/a27/?v=vracht&t=2026-10-03T08:00');
    assert.equal(roadPageHref('A27', { mode: 'auto', time: 'nu', moment: null }), '/weg/a27/');
    assert.equal(roadPageHref('N322', { mode: 'auto', time: 'morgen', moment: null }), '/weg/n322/?t=morgen');
    // "Dit weekend" is not one strip day: left out rather than approximated.
    assert.equal(roadPageHref('A2', { mode: 'fiets', time: 'weekend', moment: null }), '/weg/a2/?v=fiets');

    for (const t of ['vandaag', 'morgen']) {
      const sel = selectionFromUrl(urlState.parseUrlState(`?t=${t}`), [], 'auto', SAT);
      assert.equal(sel.kind, 'day');
      assert.equal(sel.index, t === 'vandaag' ? 0 : 1);
      assert.equal(timeParam(sel, SAT), t, 'round trip');
    }
    assert.deepEqual(selectionFromUrl(urlState.parseUrlState('?t=2026-10-03T08:00'), [], 'auto', SAT), { kind: 'moment', at });
    assert.deepEqual(selectionFromUrl(urlState.parseUrlState('?t=weekend'), [], 'auto', SAT), { kind: 'all' });
  });

  it('the road answer on the map links to the road page only when that page exists', () => {
    const els = () => ({
      panel: { classList: { add() {}, remove() {} } },
      answer: { hidden: true, innerHTML: '', querySelector: () => null },
      summary: {},
      hiddenBtn: {},
    });
    const q = { mode: 'vracht', time: 'nu', moment: null, road: 'A27', query: '' };
    const hasRoadPage = (s) => s === 'a27';
    const withPage = els();
    panelAnswer.renderRoadAnswer(withPage, q, [], SAT, { hasRoadPage, onExit() {} });
    assert.match(withPage.answer.innerHTML, /<a class="btn btn--secondary answer__page" href="\/weg\/a27\/\?v=vracht">Per dag vooruitkijken op de A27 →<\/a>/);
    const without = els();
    panelAnswer.renderRoadAnswer(without, { ...q, road: 'A99' }, [], SAT, { hasRoadPage, onExit() {} });
    assert.doesNotMatch(without.answer.innerHTML, /answer__page/);
    const noManifest = els();
    panelAnswer.renderRoadAnswer(noManifest, q, [], SAT, { onExit() {} });
    assert.doesNotMatch(noManifest.answer.innerHTML, /answer__page/);
  });

  it('the page link leaves the headline of the card untouched', () => {
    const answer = { level: 'rijbaan', headline: 'Rijbaan dicht bij Gorinchem', specifics: [], hidden: [], beyondHorizon: false, horizonMs: null };
    const base = { road: 'A27', whenLabel: 'nu', mode: 'auto', answer, total: 3 };
    const linked = answerCard.renderAnswerCard({ ...base, pageHref: '/weg/a27/', pageLabel: 'Per dag vooruitkijken op de A27 →' });
    assert.ok(linked.includes(`>${answerCard.cardHeadline(base)}</h2>`));
    assert.ok(linked.includes('answer--rijbaan'));
  });
});
