/**
 * The hand-written guides under /uitleg/ and the change log: the content AdSense calls "valuable"
 * next to the generated pages. These tests pin down that every guide is built, indexed, linked
 * from every text page and attributed to a person, and that the dev server serves them.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUIDE_ROUTES, buildModel, renderPage, PAGE_TYPES } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';
import { stripMarkdown } from '../scripts/lib/markdown.mjs';
import { matchRoute } from '../scripts/dev-pages-plugin.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};

const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);
const warnings = [];
const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: (w) => warnings.push(w) });
const html = (path) => renderPage(model.byPath.get(path), model, templates);
const ldGraph = (doc) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(doc)[1])['@graph'];

/** Words a reader sees, without markup: a guide is a guide, not a stub. */
const wordCount = (slug) => stripMarkdown(model.content.get(slug).body).split(/\s+/).filter(Boolean).length;

describe('guides', () => {
  it('every guide, the guide index and the change log are built and in the sitemap', () => {
    assert.ok(GUIDE_ROUTES.length >= 4);
    for (const path of ['/uitleg/', '/wijzigingen/', ...GUIDE_ROUTES.map((g) => g.path)]) {
      const page = model.byPath.get(path);
      assert.ok(page, `${path} is not generated`);
      assert.equal(page.sitemap, true, path);
      assert.match(html(path), /<meta name="robots" content="index, follow/, path);
    }
    assert.equal(warnings.filter((w) => /uitleg|wijzigingen/.test(w)).length, 0, warnings.join('\n'));
  });

  it('each guide is a real article of at least 800 words, with a date', () => {
    for (const g of GUIDE_ROUTES) {
      assert.ok(wordCount(g.slug) >= 800, `${g.slug}: ${wordCount(g.slug)} words`);
      assert.match(String(model.content.get(g.slug).data.updated), /^\d{4}-\d{2}-\d{2}$/, g.slug);
    }
  });

  it('a guide sits under Uitleg in the breadcrumb and names its author', () => {
    const doc = html(GUIDE_ROUTES[0].path);
    assert.match(doc, /<a href="\/uitleg\/">Uitleg<\/a>/);
    const article = ldGraph(doc).find((n) => n['@type'] === 'Article');
    assert.ok(article, 'Article JSON-LD');
    assert.deepEqual(article.author, { '@type': 'Person', name: model.site.owner.name });
    assert.equal(article.mainEntityOfPage, `${model.site.url}${GUIDE_ROUTES[0].path}`);
    const crumbs = ldGraph(doc).find((n) => n['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name);
    assert.deepEqual(crumbs.slice(0, 2), ['Kaart', 'Uitleg']);
  });

  it('without an owner name the guide is attributed to the site', () => {
    const anon = { ...model, site: { ...model.site, owner: { name: '' } } };
    const article = ldGraph(renderPage(model.byPath.get(GUIDE_ROUTES[0].path), anon, templates)).find((n) => n['@type'] === 'Article');
    assert.equal(article.author['@type'], 'Organization');
  });

  it('the guide index links every guide, and every text page links the guides in its footer', () => {
    const index = html('/uitleg/');
    for (const g of GUIDE_ROUTES) assert.ok(index.includes(`href="${g.path}"`), g.path);
    for (const path of ['/over/', '/weg/a2/', '/afsluitingen/']) {
      assert.match(html(path), /<a href="\/uitleg\/">Uitleg<\/a>/, path);
      assert.match(html(path), /<a href="\/wijzigingen\/">Wijzigingen<\/a>/, path);
    }
  });

  it('no guide leaves a template variable or an internal link to a page that does not exist', () => {
    for (const path of ['/uitleg/', '/wijzigingen/', ...GUIDE_ROUTES.map((g) => g.path)]) {
      const doc = html(path);
      assert.doesNotMatch(doc, /\{\{|undefined/, path);
      const article = doc.slice(doc.indexOf('<article'), doc.indexOf('</article>'));
      for (const [, href] of article.matchAll(/href="(\/[^"#?]*)"/g)) {
        if (href === '/' || /^\/(weg|plaats|gemeente|brug)\//.test(href)) continue;
        assert.ok(model.byPath.has(href), `${path} links to ${href}`);
      }
    }
  });

  it('the dev server serves the guides and redirects a missing slash', () => {
    const path = GUIDE_ROUTES[0].path;
    assert.deepEqual(matchRoute(path), { path });
    assert.deepEqual(matchRoute(path.slice(0, -1)), { redirect: path });
    assert.deepEqual(matchRoute('/uitleg/'), { path: '/uitleg/' });
    assert.deepEqual(matchRoute('/uitleg/bestaat-niet/'), { notFound: true });
  });
});

describe('the menu leads to the uitleg', () => {
  it('"Uitleg" in the main menu opens /uitleg/, on every page and on the map', () => {
    const header = readFileSync(new URL('../templates/partials/header.html', import.meta.url), 'utf8');
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    for (const [name, doc] of [['header.html', header], ['index.html', index]]) {
      const nav = /<nav class="topbar__nav"[\s\S]*?<\/nav>/.exec(doc)?.[0] ?? '';
      assert.match(nav, /<a href="\/uitleg\/">Uitleg<\/a>/, name);
      assert.doesNotMatch(nav, /#uitleg/, name);
    }
  });
});
