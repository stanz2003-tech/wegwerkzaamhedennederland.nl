/**
 * The detail view of a melding on the map links on to the pages about its road, its place and
 * its road bridges ("Alles op de A27, per dag →"), high up, right under the route buttons: the
 * map is where people click, the pages are where the day-by-day view, every other melding and
 * the questions are. Links only go to pages the manifest (/entity-pages.json) knows, and carry
 * the map's vehicle and day, so the page opens on the same question.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entityPages, uiDetail } from './helpers/src.mjs';

const NOW = Date.parse('2026-11-16T10:00:00Z');
const fakeRoot = () => ({ innerHTML: '', querySelector: () => null });
const cb = { onBack() {}, onShare() {}, onRetry() {} };

const pages = entityPages.entityPagesFrom({
  v: 1,
  roads: ['a27', 'n322'],
  woonplaatsen: [
    { slug: 'almkerk', name: 'Almkerk', gemeente: 'Altena' },
    { slug: 'utrecht', name: 'Utrecht', gemeente: 'Utrecht' },
  ],
  gemeenten: [
    { slug: 'altena', name: 'Altena' },
    { slug: 'utrecht', name: 'Utrecht' },
  ],
});

const props = {
  id: 'a27-1', cat: 'afsluiting', sub: 'roadClosed', sev: 3, title: 'A27 · Almkerk', road: 'A27', roadType: 'rijksweg',
  woonplaats: 'Almkerk', gemeente: 'Altena', start: '2026-11-10T20:00:00Z', end: '2026-11-30T05:00:00Z', src: 'RWS', imp: 'dicht',
};
const detail = { id: 'a27-1', src: 'RWS', desc: 'Groot onderhoud.', url: 'https://www.rijkswaterstaat.nl/x' };

function render(extra = {}, propsExtra = {}) {
  const root = fakeRoot();
  const state = { props: { ...props, ...propsExtra }, center: [4.96, 51.77], detail, loading: false, error: false, mode: 'auto', pages, ...extra };
  uiDetail.renderDetail(root, state, NOW, cb);
  return root.innerHTML;
}

/** The block with the page links, or '' when there is none. */
function pagesBlock(html) {
  const m = /<nav class="detail__pages"[\s\S]*?<\/nav>/.exec(html);
  return m ? m[0] : '';
}

const count = (html, needle) => html.split(needle).length - 1;

describe('detail: links on to the road, place and bridge pages', () => {
  it('links the road page and the village page in one block, labelled as pages', () => {
    const block = pagesBlock(render());
    assert.match(block, /aria-labelledby="detail-pages"/);
    assert.match(block, /<h3 class="detail__h" id="detail-pages">Meer over deze plek<\/h3>/);
    assert.match(block, /href="\/weg\/a27\/"[^>]*>[\s\S]*?Alles op de A27, per dag →/);
    assert.match(block, /href="\/plaats\/almkerk\/"[^>]*>[\s\S]*?Alles in Almkerk, per dag →/);
  });

  it('puts the block above what the wegbeheerder reported and the explanation', () => {
    const html = render();
    const at = html.indexOf('class="detail__pages"');
    assert.ok(at > 0, 'block present');
    assert.ok(at < html.indexOf('Zo meldt de wegbeheerder het') || html.indexOf('Zo meldt de wegbeheerder het') < 0);
    assert.ok(at < html.indexOf('Toelichting'));
  });

  it('links each page once: no second road link further down', () => {
    const html = render();
    assert.equal(count(html, 'href="/weg/a27/"'), 1);
    assert.equal(count(html, 'href="/plaats/almkerk/"'), 1);
    assert.doesNotMatch(html, /Wegpagina A27/);
  });

  it('keeps the gemeente of a village as a smaller link lower down', () => {
    const html = render();
    assert.doesNotMatch(pagesBlock(html), /\/gemeente\//);
    assert.equal(count(html, 'href="/gemeente/altena/"'), 1);
  });

  it('falls back to the gemeente page when the village has none', () => {
    const html = render({}, { woonplaats: 'Spijk' });
    assert.match(pagesBlock(html), /href="\/gemeente\/altena\/"[^>]*>[\s\S]*?Alles in de gemeente Altena, per dag →/);
    assert.equal(count(html, 'href="/gemeente/altena/"'), 1);
  });

  it('links no road page that does not exist', () => {
    const html = render({}, { road: 'N999', title: 'N999 · Almkerk' });
    assert.doesNotMatch(html, /\/weg\/n999\//);
    assert.match(pagesBlock(html), /href="\/plaats\/almkerk\/"/);
  });

  it('shows no page links before the manifest has arrived (hidden, never broken)', () => {
    const html = render({ pages: null });
    assert.equal(pagesBlock(html), '');
    assert.doesNotMatch(html, /href="\/(weg|plaats|gemeente)\//);
    assert.match(html, /Meer info bij wegbeheerder/);
  });

  it('carries the vehicle and the picked day of the map', () => {
    const question = { mode: 'fiets', time: 'nu', moment: null, day: '2026-11-20', part: null };
    const block = pagesBlock(render({ mode: 'fiets', question }));
    assert.match(block, /href="\/weg\/a27\/\?v=fiets&amp;dag=2026-11-20"/);
    assert.match(block, /href="\/plaats\/almkerk\/\?[^"]*dag=2026-11-20[^"]*"/);
    assert.match(block, /href="\/plaats\/almkerk\/\?[^"]*v=fiets[^"]*"/);
  });

  it('gives a melding without road or place no block at all', () => {
    const html = render({}, { road: null, woonplaats: null, gemeente: null, title: 'Ergens' });
    assert.equal(pagesBlock(html), '');
  });
});

describe('detailPageLinks', () => {
  const q = { mode: 'auto', time: 'nu', moment: null, day: null, part: null };

  it('orders road, place, then bridges', () => {
    const bridge = { slug: 'merwedebrug-gorinchem', name: 'Merwedebrug (Gorinchem)', road: 'A27', gemeente: 'Gorinchem', lon: 4.97, lat: 51.82 };
    const links = uiDetail.detailPageLinks(props, pages, q, [bridge]);
    assert.deepEqual(
      links.top.map((l) => l.href),
      ['/weg/a27/', '/plaats/almkerk/', '/brug/merwedebrug-gorinchem/'],
    );
    assert.deepEqual(links.gemeente?.href, '/gemeente/altena/');
  });

  it('carries the vehicle and day into the bridge page too (road bridge pages read them)', () => {
    const bridge = { slug: 'merwedebrug-gorinchem', name: 'Merwedebrug (Gorinchem)', road: 'A27', gemeente: 'Gorinchem', lon: 4.97, lat: 51.82 };
    const fiets = { mode: 'fiets', time: 'nu', moment: null, day: '2026-11-20', part: null };
    const links = uiDetail.detailPageLinks(props, pages, fiets, [bridge]);
    const href = links.top.find((l) => l.kind === 'bridge')?.href ?? '';
    assert.match(href, /^\/brug\/merwedebrug-gorinchem\/\?/);
    assert.match(href, /v=fiets/);
    assert.match(href, /dag=2026-11-20/);
  });

  it('returns nothing without a manifest', () => {
    const links = uiDetail.detailPageLinks(props, null, q, []);
    assert.deepEqual(links, { top: [], gemeente: null });
  });
});
