/**
 * The twelve province pages (scripts/lib/province-pages.mjs, templates/province.html) and the way
 * in from every place page ("Kaart › Noord-Brabant › …") and from /plaatsen/
 * (docs/groei-onderzoek-2026-11.md §3.4).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGE_TYPES, buildModel, pageContext, renderPage } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';
import { provinceHref, provinceLabel, provinceSlug, provincesFrom, renderProvinceNav } from '../scripts/lib/province-pages.mjs';
import { TITLE_MAX } from '../scripts/lib/text.mjs';
import { bridgesProvAnchor } from '../scripts/lib/fragments.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};
const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);
const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
const provincePages = model.pages.filter((p) => p.type === 'province');
const ctx = (path) => pageContext(model.byPath.get(path), model);
const html = (path) => renderPage(model.byPath.get(path), model, templates);

describe('province helpers', () => {
  it('make URL parts without accents or spaces', () => {
    assert.equal(provinceSlug('Noord-Brabant'), 'noord-brabant');
    assert.equal(provinceSlug('Fryslân'), 'fryslan');
    assert.equal(provinceHref('Zuid-Holland'), '/provincie/zuid-holland/');
    assert.equal(provinceHref(''), '');
  });

  it('group gemeenten by province, by name, with the centre for the map', () => {
    const list = provincesFrom([
      { naam: 'B', prov: 'Zeeland', provCode: 'PV29', lon: 4, lat: 51 },
      { naam: 'A', prov: 'Drenthe', provCode: 'PV22', lon: 6, lat: 53 },
      { naam: 'C', prov: 'Zeeland', provCode: 'PV29', lon: 3, lat: 52 },
      { naam: 'D', prov: null },
    ]);
    assert.deepEqual(list.map((p) => [p.name, p.code, p.gemeenten.length]), [['Drenthe', 'PV22', 1], ['Zeeland', 'PV29', 2]]);
    assert.equal(list[1].lon, 3.5);
    assert.equal(list[1].lat, 51.5);
  });

  it('say "provincie" where a gemeente has the same name', () => {
    const gemeenten = [{ naam: 'Utrecht' }, { naam: 'Eindhoven' }];
    assert.equal(provinceLabel({ name: 'Utrecht' }, gemeenten), 'provincie Utrecht');
    assert.equal(provinceLabel({ name: 'Noord-Brabant' }, gemeenten), 'Noord-Brabant');
  });

  it('render nothing for /plaatsen/ without provinces', () => {
    assert.equal(renderProvinceNav([]), '');
  });
});

describe('the province pages', () => {
  it('exist for the twelve provinces, in the sitemap and never thin', () => {
    assert.equal(provincePages.length, 12);
    assert.ok(model.byPath.has('/provincie/noord-brabant/'));
    for (const p of provincePages) {
      assert.equal(p.sitemap, true, p.path);
      assert.notEqual(p.thin, true, p.path);
    }
  });

  it('have a title that fits and names the province', () => {
    for (const p of provincePages) {
      const { title } = ctx(p.path);
      assert.ok(title.length <= TITLE_MAX, `${p.path}: ${title}`);
      assert.match(title, new RegExp(p.entity.name));
    }
    assert.equal(ctx('/provincie/noord-brabant/').title, 'Wegwerkzaamheden Noord-Brabant: wegafsluitingen vandaag');
    assert.equal(ctx('/provincie/utrecht/').title, 'Wegwerkzaamheden provincie Utrecht: wegafsluitingen vandaag');
  });

  it('list every gemeente of the province, and only those', () => {
    for (const p of provincePages) {
      const c = ctx(p.path);
      const own = model.lists.gemeenten.filter((g) => g.prov === p.entity.name);
      assert.equal(c.gemeenten.length, own.length, p.path);
      for (const g of c.gemeenten) assert.ok(model.byPath.has(g.href), g.href);
    }
  });

  it('link only to roads and bridges that are in Google, motorways first', () => {
    for (const p of provincePages) {
      const c = ctx(p.path);
      for (const l of [...c.roads, ...c.bridges]) {
        const target = model.byPath.get(l.href);
        assert.ok(target && target.thin !== true, `${p.path} → ${l.href}`);
      }
      const firstN = c.roads.findIndex((r) => r.badgeClass !== 'a');
      assert.ok(firstN === -1 || c.roads.slice(firstN).every((r) => r.badgeClass !== 'a'), `${p.path}: A-roads first`);
    }
    assert.ok(ctx('/provincie/noord-brabant/').roads.some((r) => r.road === 'A2'));
    assert.ok(!ctx('/provincie/groningen/').roads.some((r) => r.road === 'A2'));
  });

  it('render as a list page for its province, with the live script and its own index file', () => {
    const page = html('/provincie/noord-brabant/');
    assert.match(page, /<body data-page="list" data-list="vandaag" data-prov="Noord-Brabant" data-prov-code="PV30">/);
    assert.match(page, /<h1>Wegwerkzaamheden provincie Noord-Brabant<\/h1>/);
    assert.match(page, /<li aria-current="page">Provincie Noord-Brabant<\/li>/);
    assert.match(page, /<a class="chip chip--gemeente" href="\/gemeente\/s-hertogenbosch\/" data-gemeente="&#39;s-Hertogenbosch">/);
    assert.match(page, /<a class="badge badge--a" href="\/weg\/a2\/">A2<\/a>/);
    assert.match(page, /data-ad-slot="article"/);
    assert.match(page, /Onder de lijst staan de 56 gemeenten, de wegen en de bruggen van de provincie\./);
    // "Alle … bruggen" points at the province's own heading on /bruggen/.
    assert.equal(bridgesProvAnchor('Noord-Brabant'), 'bruggen-noord-brabant');
    assert.match(html('/bruggen/'), /<h2 id="bruggen-noord-brabant">/);
    // The groups stand under a long list: three jumps right under the heading, to anchors that exist.
    const jumps = page.match(/<nav class="quick-links"[\s\S]*?<\/nav>/)?.[0] ?? '';
    for (const id of ['prov-gemeenten', 'prov-wegen', 'prov-bruggen']) {
      assert.match(jumps, new RegExp(`href="#${id}"`));
      assert.match(page, new RegExp(`<h2 id="${id}">`));
    }
    assert.ok(page.indexOf('class="quick-links"') < page.indexOf('id="list-items"'), 'above the list');
    assert.match(page, /<script type="module" src="\/src\/pages\/list\.ts"><\/script>/);
  });
});

describe('the way in', () => {
  it('every place page names its province in the breadcrumb', () => {
    for (const p of model.pages.filter((x) => x.type === 'place')) {
      const crumbs = pageContext(p, model).crumbs;
      const prov = p.entity.prov;
      if (!prov) continue;
      assert.equal(crumbs[1].href, provinceHref(prov), p.path);
      assert.match(crumbs[1].name, new RegExp(`^(provincie )?${prov}$`), p.path);
    }
    assert.deepEqual(ctx('/plaats/lexmond/').crumbs.map((c) => c.name), ['Kaart', 'provincie Utrecht', 'Gemeente Vijfheerenlanden']);
    assert.deepEqual(ctx('/gemeente/eindhoven/').crumbs.map((c) => c.name), ['Kaart', 'Noord-Brabant']);
  });

  it('/plaatsen/ starts with the twelve provinces', () => {
    const page = html('/plaatsen/');
    const nav = page.match(/<nav class="list-group province-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
    assert.equal((nav.match(/href="\/provincie\//g) ?? []).length, 12);
    assert.ok(page.indexOf('province-nav') < page.indexOf('place-group'), 'above the gemeenten');
  });
});
