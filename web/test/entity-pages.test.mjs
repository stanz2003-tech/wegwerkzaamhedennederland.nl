/**
 * Unit tests for the entity-page manifest (web/src/data/entity-pages.ts), place mode on the map
 * (web/src/ui/place-mode.ts), the suggestion status line (ui/search.ts) and the browse-page
 * filter (pages/list-filter.ts). Place mode must never make an answer lighter: no item of the
 * place may fall out of it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answer, entityPages, listFilter, placeMode, searchIndex, uiSearch, urlState } from './helpers/src.mjs';

const { entityPagesFrom, loadEntityPages } = entityPages;
const { placeMatcher, placeFromHit, placePageHref, placePageLabel, placePrefix, placeSubject, resolvePlace, hasPlacePage } = placeMode;
const { DEFAULT_URL_STATE } = urlState;

const MANIFEST = {
  v: 1,
  roads: ['a27', 'n322'],
  woonplaatsen: [
    { slug: 'almkerk', name: 'Almkerk', gemeente: 'Altena' },
    { slug: 'hengelo', name: 'Hengelo', gemeente: 'Hengelo' },
    { slug: 'hengelo-gld', name: 'Hengelo', gemeente: 'Bronckhorst' },
    { slug: 's-hertogenbosch', name: "'s-Hertogenbosch", gemeente: "'s-Hertogenbosch" },
  ],
  gemeenten: [
    { slug: 'altena', name: 'Altena' },
    { slug: 'sudwest-fryslan', name: 'Súdwest-Fryslân' },
  ],
};
const PAGES = entityPagesFrom(MANIFEST);

describe('entity-page manifest', () => {
  it('validates the shape and answers road, gemeente and woonplaats lookups after normalizeText', () => {
    assert.equal(entityPagesFrom(null), null);
    assert.equal(entityPagesFrom({ v: 2, roads: [], woonplaatsen: [], gemeenten: [] }), null);
    assert.equal(entityPagesFrom({ v: 1, roads: [] }), null);
    assert.equal(PAGES.hasRoadPage('a27'), true);
    assert.equal(PAGES.hasRoadPage('a99'), false);
    assert.equal(PAGES.findGemeente('SUDWEST-FRYSLAN')?.slug, 'sudwest-fryslan');
    assert.equal(PAGES.findWoonplaats('almkerk')?.slug, 'almkerk');
    assert.equal(PAGES.woonplaatsBySlug('almkerk')?.gemeente, 'Altena');
    assert.equal(PAGES.gemeenteBySlug('nergens'), null);
  });

  it('an ambiguous woonplaats needs the gemeente from the PDOK weergavenaam', () => {
    assert.equal(PAGES.isAmbiguousWoonplaats('Hengelo'), true);
    assert.equal(PAGES.isAmbiguousWoonplaats('Almkerk'), false);
    assert.equal(PAGES.findWoonplaats('Hengelo'), null, 'no guess without the gemeente');
    assert.equal(PAGES.findWoonplaats('Hengelo', 'Bronckhorst')?.slug, 'hengelo-gld');
    assert.equal(PAGES.findWoonplaats('Hengelo', 'hengelo')?.slug, 'hengelo');
    assert.equal(PAGES.findWoonplaats('Hengelo', 'Utrecht'), null);
  });

  it('skips malformed entries instead of failing the whole manifest', () => {
    const pages = entityPagesFrom({ v: 1, roads: ['a2', 3, ''], woonplaatsen: [{ slug: 'x' }, { slug: 'eethen', name: 'Eethen' }], gemeenten: [null] });
    assert.equal(pages.hasRoadPage('a2'), true);
    assert.equal(pages.findWoonplaats('Eethen')?.gemeente, null);
  });

  it('a manifest that fails to load resolves to null: links are hidden, never broken', async () => {
    const failing = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      assert.equal(await loadEntityPages(failing), null);
      const ok = async (url) => {
        assert.equal(url, '/entity-pages.json', 'the site origin, not the data host');
        return { ok: true, status: 200, json: async () => MANIFEST };
      };
      const pages = await loadEntityPages(ok);
      assert.equal(pages?.hasRoadPage('a27'), true);
      assert.equal(entityPages.entityPagesNow()?.hasRoadPage('a27'), true);
    } finally {
      console.warn = warn;
    }
  });
});

describe('place mode (zoek-2)', () => {
  const almkerk = { kind: 'woonplaats', slug: 'almkerk', name: 'Almkerk', gemeente: 'Altena' };

  it('words the subject, the list prefix and the page link', () => {
    assert.equal(placeSubject(almkerk), 'Almkerk');
    assert.equal(placeSubject({ kind: 'gemeente', name: 'Altena' }), 'de gemeente Altena');
    assert.equal(placePrefix({ kind: 'gemeente', name: 'Altena' }), 'In de gemeente Altena');
    assert.equal(placePageLabel(almkerk), 'Almkerk per dag bekijken →');
    assert.equal(placePageLabel({ kind: 'gemeente', name: 'Altena' }), 'De gemeente Altena per dag bekijken →');
  });

  it('links to the place page with the same vehicle and moment', () => {
    const q = { ...DEFAULT_URL_STATE, mode: 'fiets', time: '7d', moment: null };
    assert.equal(placePageHref(almkerk, q), '/plaats/almkerk/?t=7d&v=fiets');
    assert.equal(placePageHref({ kind: 'gemeente', slug: 'altena' }, DEFAULT_URL_STATE), '/gemeente/altena/');
    assert.match(placePageHref(almkerk, { ...q, moment: Date.UTC(2026, 9, 5, 12) }), /^\/plaats\/almkerk\/\?t=2026-10-05T14:00&v=fiets$/);
    // A picked date (+ part) opens the place page on that day (P6's ?dag= / &deel=).
    assert.equal(placePageHref(almkerk, { ...q, time: 'nu', day: '2026-10-06', part: 'ochtend' }), '/plaats/almkerk/?dag=2026-10-06&deel=ochtend&v=fiets');
  });

  it('only links when the manifest has the page', () => {
    assert.equal(hasPlacePage(almkerk, PAGES), true);
    assert.equal(hasPlacePage({ ...almkerk, slug: 'nergens' }, PAGES), false);
    assert.equal(hasPlacePage(almkerk, null), false);
  });

  it('turns a PDOK pick into a place: the manifest slug, an ambiguous name by its gemeente', () => {
    const hit = (type, label, gemeente = null) => ({ type, label, gemeente });
    assert.deepEqual(placeFromHit(hit('woonplaats', 'Almkerk', 'Altena'), PAGES), almkerk);
    assert.equal(placeFromHit(hit('woonplaats', 'Hengelo', 'Bronckhorst'), PAGES).slug, 'hengelo-gld');
    assert.deepEqual(placeFromHit(hit('gemeente', 'Súdwest-Fryslân'), PAGES), { kind: 'gemeente', slug: 'sudwest-fryslan', name: 'Súdwest-Fryslân' });
    // Without the manifest the slug is the one gen-pages would write.
    assert.equal(placeFromHit(hit('woonplaats', "'s-Hertogenbosch"), null).slug, 's-hertogenbosch');
    // A provincie or a street stays zoom-only.
    assert.equal(placeFromHit(hit('provincie', 'Utrecht'), PAGES), null);
    assert.equal(placeFromHit(hit('weg', 'Dorpsstraat, Almkerk'), PAGES), null);
  });

  it('resolves ?plaats=<slug> from the manifest and drops an unknown slug', () => {
    assert.deepEqual(resolvePlace({ kind: 'woonplaats', slug: 'almkerk', name: '' }, PAGES), almkerk);
    assert.deepEqual(resolvePlace({ kind: 'gemeente', slug: 'altena', name: '' }, PAGES), { kind: 'gemeente', slug: 'altena', name: 'Altena' });
    assert.equal(resolvePlace({ kind: 'woonplaats', slug: 'nergens', name: '' }, PAGES), null);
    assert.equal(resolvePlace({ kind: 'woonplaats', slug: 'almkerk', name: '' }, null), null);
    // A place picked before the manifest arrived gets the manifest's slug for its gemeente.
    assert.equal(resolvePlace({ kind: 'woonplaats', slug: 'hengelo', name: 'Hengelo', gemeente: 'Bronckhorst' }, PAGES).slug, 'hengelo-gld');
  });

  it('matches the same items as the place pages and never drops one of the place (no lighter answer)', () => {
    const items = [
      { id: 'a', woonplaats: 'Almkerk', gemeente: 'Altena' },
      { id: 'b', woonplaats: 'ALMKERK', gemeente: null },
      { id: 'c', woonplaats: 'Almkerk', gemeente: undefined },
      { id: 'd', woonplaats: 'Werkendam', gemeente: 'Altena' },
      { id: 'e', woonplaats: null, gemeente: 'Altena' },
    ];
    assert.deepEqual(items.filter(placeMatcher(almkerk, PAGES)).map((i) => i.id), ['a', 'b', 'c']);
    assert.deepEqual(items.filter(placeMatcher({ kind: 'gemeente', slug: 'altena', name: 'altena' }, PAGES)).map((i) => i.id), ['a', 'd', 'e']);
    // An ambiguous name keeps only its own gemeente — but an item without a gemeente stays in.
    const hengelo = [
      { id: 'gld', woonplaats: 'Hengelo', gemeente: 'Bronckhorst' },
      { id: 'ov', woonplaats: 'Hengelo', gemeente: 'Hengelo' },
      { id: 'onbekend', woonplaats: 'Hengelo', gemeente: undefined },
    ];
    const gld = { kind: 'woonplaats', slug: 'hengelo-gld', name: 'Hengelo', gemeente: 'Bronckhorst' };
    assert.deepEqual(hengelo.filter(placeMatcher(gld, PAGES)).map((i) => i.id), ['gld', 'onbekend']);
    // Without the manifest nobody can tell the two apart: both stay (heavier, never lighter).
    assert.deepEqual(hengelo.filter(placeMatcher(gld, null)).map((i) => i.id), ['gld', 'ov', 'onbekend']);
  });

  it('counts an item without a woonplaats whose title names the place (N322 · Almkerk)', () => {
    const items = [
      { id: 'n322', title: 'N322 · Almkerk', woonplaats: undefined, gemeente: 'Altena' },
      { id: 'weg', title: 'Almkerkseweg, Werkendam', woonplaats: undefined, gemeente: 'Altena' },
      { id: 'elders', title: 'N322 · Almkerk', woonplaats: undefined, gemeente: 'Utrecht' },
      { id: 'other', title: 'A27 · Almkerk', woonplaats: 'Werkendam', gemeente: 'Altena' },
    ];
    assert.deepEqual(items.filter(placeMatcher(almkerk, PAGES)).map((i) => i.id), ['n322']);
    assert.equal(placeMode.titleNamesPlace("A2 · 's-Hertogenbosch", "'s-Hertogenbosch"), true);
    assert.equal(placeMode.titleNamesPlace('Almkerk', ''), false);
  });

  it('the place answer is the heaviest verdict of the place items, exactly as answerFor gives it', () => {
    const feature = (id, woonplaats, imp, closed) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [4.97, 51.77] },
      properties: { id, cat: closed ? 'afsluiting' : 'werk', sev: 2, title: `x ${id}`, woonplaats, gemeente: 'Altena', start: '2026-10-01T00:00:00Z', end: '2026-10-30T00:00:00Z', src: 'NDW', imp, closed },
    });
    const all = [feature('1', 'Almkerk', 'hinder', false), feature('2', 'Almkerk', 'dicht', true), feature('3', 'Werkendam', 'dicht', true)];
    const inPlace = all.filter((f) => placeMatcher(almkerk, PAGES)(f.properties));
    const now = Date.UTC(2026, 9, 3, 12);
    const a = answer.answerFor(inPlace.map((f) => ({ f, d: null })), 'auto', { kind: 'moment', at: now }, { kind: 'woonplaats', name: 'Almkerk' }, now);
    assert.equal(a.level, 'dicht', 'the closure in Almkerk wins over the hinder');
  });
});

describe('search status line (toeg-4)', () => {
  const { statusText } = uiSearch;
  const town = searchIndex.placeHitFromDoc({ id: 'w', type: 'woonplaats', weergavenaam: 'Almkerk, Altena, Noord-Brabant', woonplaatsnaam: 'Almkerk' });

  it('says what Enter does when an option is preselected, and how many there are otherwise', () => {
    assert.equal(statusText([{ kind: 'road', road: 'A27' }, { kind: 'query', query: 'A27' }], 0, 'A27'), 'Enter: alleen de A27 tonen. Pijl omlaag voor andere suggesties.');
    assert.equal(statusText([town], 0, 'almkerk'), 'Enter: Almkerk tonen.');
    assert.equal(statusText([{ ...town, didYouMean: true }], 0, 'almkrek'), 'Bedoelde je Almkerk? Enter om die te kiezen.');
    assert.equal(statusText([town, { kind: 'query', query: 'alm' }], -1, 'alm'), '2 suggesties, pijl omlaag om te kiezen.');
    assert.match(statusText([], -1, 'zzqx'), /^Geen weg of plaats gevonden voor “zzqx”/);
  });
});

describe('browse-page filter (zoek-9)', () => {
  const { linkKey, linkMatches } = listFilter;

  it('matches road numbers by prefix and names anywhere, after normalizeText', () => {
    assert.equal(linkKey({ textContent: 'A27', dataset: { road: 'A27' } }), 'a27');
    assert.equal(linkKey({ textContent: 'Almkerk', dataset: { woonplaats: 'Almkerk' } }), 'almkerk');
    assert.equal(linkMatches('a27', 'a2', true), true);
    assert.equal(linkMatches('a27', 'a 27', true), true);
    assert.equal(linkMatches('na27', 'a27', true), false);
    assert.equal(linkMatches('almkerk', 'almk', false), true);
    assert.equal(linkMatches(linkKey({ textContent: 'Súdwest', dataset: {} }), 'sudw', false), true);
    assert.equal(linkMatches('almkerk', '', false), true);
  });
});
