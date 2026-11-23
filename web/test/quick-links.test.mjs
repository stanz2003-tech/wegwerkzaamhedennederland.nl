/**
 * scripts/lib/quick-links.mjs + the road and place templates: a short row of links right under the
 * answer. Measured on a phone (375 × 812), 23 Nov 2026: the first link to another text page stood
 * 4,308 px down /plaats/maarssen/ (5.3 screens) and 7,579 px down /weg/a28/ (9.3 screens), under
 * the list, the questions and the FAQ. The blocks "In de buurt" and "Langs de A28" hold good
 * links that almost nobody reaches; this row shows the few most useful ones where the reader is.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_QUICK_LINKS, MAX_QUICK_ROADS, placeQuickLinks, roadQuickLinks } from '../scripts/lib/quick-links.mjs';
import { PAGE_TYPES, buildModel, renderPage } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';

const road = (name) => ({ road: name, href: `/weg/${name.toLowerCase()}/`, badgeClass: name.startsWith('A') ? 'a' : 'n' });
const place = (name) => ({ name, href: `/gemeente/${name.toLowerCase()}/` });

describe('placeQuickLinks: the roads around a place first, then where it lies', () => {
  it('a woonplaats: its roads and its own gemeente', () => {
    const links = placeQuickLinks({ roads: [road('A2'), road('N230')], gemeenten: [{ name: 'Gemeente Stichtse Vecht', href: '/gemeente/stichtse-vecht/' }], moreHref: '#related-title' });
    assert.deepEqual(
      links.map((l) => l.name),
      ['A2', 'N230', 'Gemeente Stichtse Vecht', 'Meer in de buurt'],
    );
    assert.deepEqual(links[0], { name: 'A2', href: '/weg/a2/', cls: 'badge badge--a' });
    assert.deepEqual(links[2], { name: 'Gemeente Stichtse Vecht', href: '/gemeente/stichtse-vecht/', cls: 'chip chip--gemeente' });
  });

  it('never more roads than fit one line on a phone, never more links than two lines', () => {
    const roads = ['A2', 'A12', 'A27', 'A28', 'N230', 'N237'].map(road);
    const gemeenten = ['Houten', 'Nieuwegein', 'Zeist', 'Bunnik'].map(place);
    const links = placeQuickLinks({ roads, gemeenten, moreHref: '#related-title' });
    assert.equal(links.filter((l) => l.cls.startsWith('badge')).length, MAX_QUICK_ROADS);
    assert.equal(links.length, MAX_QUICK_LINKS);
    assert.equal(links.at(-1).name, 'Meer in de buurt', 'the way to everything else is always the last one');
    assert.equal(links.at(-1).href, '#related-title');
  });

  it('nothing to link to: no row at all (not a lone "Meer in de buurt")', () => {
    assert.deepEqual(placeQuickLinks({ roads: [], gemeenten: [], moreHref: '#related-title' }), []);
  });

  it('everything fits: no "Meer" link that would only repeat the row', () => {
    const links = placeQuickLinks({ roads: [road('N214')], gemeenten: [], moreHref: '' });
    assert.deepEqual(links.map((l) => l.name), ['N214']);
  });
});

describe('roadQuickLinks: the towns on the road', () => {
  it('four gemeenten in the order given, then the jump to all of them', () => {
    const links = roadQuickLinks({ gemeenten: ['Zwolle', 'Assen', 'Amersfoort', 'Groningen', 'Hoogeveen'].map(place), moreHref: '#along-title' });
    assert.deepEqual(
      links.map((l) => l.name),
      ['Zwolle', 'Assen', 'Amersfoort', 'Groningen', 'Alle plaatsen langs de weg'],
    );
    assert.equal(links[0].cls, 'chip chip--gemeente');
    assert.equal(links.at(-1).href, '#along-title');
  });

  it('a road that runs through nothing we have a page for gets no row', () => {
    assert.deepEqual(roadQuickLinks({ gemeenten: [], moreHref: '#along-title' }), []);
  });
});

describe('the row in the generated pages', () => {
  const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const quiet = () => {};
  const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
  const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);
  const model = buildModel({ webRoot: WEB_ROOT, repoRoot: dirname(WEB_ROOT), warn: quiet });
  const html = (path) => renderPage(model.byPath.get(path), model, templates);
  const rowOf = (doc) => /<nav class="quick-links"[\s\S]*?<\/nav>/.exec(doc)?.[0] ?? '';
  /** A page of the given kind whose row holds at least one link. */
  const firstWithRow = (prefix) => [...model.byPath.keys()].filter((p) => p.startsWith(prefix)).find((p) => rowOf(html(p)) !== '');

  for (const [kind, prefix] of [['place', '/plaats/'], ['gemeente', '/gemeente/'], ['road', '/weg/a']]) {
    it(`${kind}: the row stands between the answer and the map with the list`, () => {
      const path = firstWithRow(prefix);
      assert.ok(path, `a ${kind} page with a row in the fixtures`);
      const doc = html(path);
      const at = doc.indexOf('<nav class="quick-links"');
      assert.ok(doc.indexOf('id="entity-forecast"') < at, 'under the answer');
      assert.ok(at < doc.indexOf('class="entity-live"'), 'above the map and the list');
      assert.ok(at < doc.indexOf('data-ad-slot='), 'above the first ad');
    });

    it(`${kind}: a labelled navigation of at most ${MAX_QUICK_LINKS} links, each to a page that exists`, () => {
      const row = rowOf(html(firstWithRow(prefix)));
      assert.match(row, /^<nav class="quick-links" aria-labelledby="quick-links-title">\s*<p class="quick-links__label" id="quick-links-title">[^<]+<\/p>/, 'the visible label names the navigation');
      const hrefs = [...row.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(hrefs.length >= 1 && hrefs.length <= MAX_QUICK_LINKS);
      for (const href of hrefs.filter((h) => !h.startsWith('#'))) {
        const target = model.byPath.get(href);
        assert.ok(target, `${href} exists`);
        assert.notEqual(target.thin, true, `${href} is not a page we keep out of Google`);
      }
      for (const href of hrefs.filter((h) => h.startsWith('#'))) assert.ok(html(firstWithRow(prefix)).includes(`id="${href.slice(1)}"`), `${href} is on the page`);
    });
  }

  it('on every road, place and gemeente page: no link to itself, to a missing page or to one kept out of Google', () => {
    let rows = 0;
    for (const path of model.byPath.keys()) {
      if (!/^\/(weg|plaats|gemeente)\//.test(path)) continue;
      const row = rowOf(html(path));
      if (row === '') continue;
      rows += 1;
      const hrefs = [...row.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(hrefs.length <= MAX_QUICK_LINKS, path);
      assert.ok(!hrefs.includes(path), `${path} links to itself`);
      for (const href of hrefs.filter((h) => !h.startsWith('#'))) {
        assert.ok(model.byPath.get(href), `${path} → ${href} does not exist`);
        assert.notEqual(model.byPath.get(href).thin, true, `${path} → ${href} is kept out of Google`);
      }
      assert.doesNotMatch(row, / title=/, `${path}: the link text is the name, no tooltip that could take the page title`);
    }
    assert.ok(rows > 100, 'the fixtures give most pages a row');
  });
});
