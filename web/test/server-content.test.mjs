/**
 * What the generated HTML holds for readers that run no script (search engines, AI crawlers):
 * the snapshot of road and place pages, no hidden "Geen meldingen" text, and one page per
 * gemeente name (the woonplaats that only repeats it redirects).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRedirects, generate } from '../scripts/gen-pages.mjs';
import { PAGE_TYPES, buildEntityManifest, buildModel, renderPage } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};

const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);

/** Visible text: tags (and their attributes) out, as a crawler that runs no script reads it. */
const visibleText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

const fakeSnapshot = (page) => ({
  answerHtml: '<section class="answer"><h2 class="answer__headline">Rijbaan dicht bij Teststraat</h2></section>',
  listHtml: `<p class="entity-snapshot__stamp">Stand van di 20 okt 06:41: 3 meldingen.</p><a class="item">Teststraat · ${page.entity.naam ?? page.entity.road}</a>`,
  count: 3,
  headline: 'Rijbaan dicht bij Teststraat',
  questionsHtml:
    page.type === 'road'
      ? '<dl class="road-questions__list"><div><dt>Is de A2 vandaag dicht?</dt><dd>Ja.</dd></div></dl>'
      : `<dl class="road-questions__list"><div><dt>Is er morgen een weg dicht in ${page.entity.naam}?</dt><dd>Nee.</dd></div></dl>`,
  asOf: 'di 20 okt 06:41',
});

describe('the snapshot in the HTML', () => {
  const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, snapshotFor: fakeSnapshot, warn: quiet });
  const html = (path) => renderPage(model.byPath.get(path), model, templates);

  it('a gemeente page carries the answer, the stamp and the streets as text', () => {
    const text = visibleText(html('/gemeente/eindhoven/'));
    assert.match(text, /Rijbaan dicht bij Teststraat/);
    assert.match(text, /Stand van di 20 okt 06:41: 3 meldingen\./);
    assert.match(text, /Teststraat · Eindhoven/);
    assert.match(html('/gemeente/eindhoven/'), /<div id="entity-list" class="entity-list" data-snapshot>/);
  });

  it('a road page carries the question block, visible', () => {
    const page = html('/weg/a2/');
    assert.match(page, /<section class="road-questions" id="road-questions" aria-labelledby="rq-title">/);
    assert.match(visibleText(page), /Is de A2 dicht\? Is de A2 vandaag dicht\? Ja\./);
  });

  it('a place page carries its own question block: today, tomorrow, the weekend', () => {
    const page = html('/gemeente/eindhoven/');
    assert.match(page, /<section class="road-questions" id="road-questions" aria-labelledby="rq-title">/);
    assert.match(visibleText(page), /Is er iets dicht in de gemeente Eindhoven\? Is er morgen een weg dicht in Eindhoven\? Nee\./);
    assert.match(visibleText(html('/plaats/lexmond/')), /Is er iets dicht in Lexmond\?/);
  });

  it('without a snapshot the page renders as before: skeleton slot, question block hidden', () => {
    const plain = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
    const page = renderPage(plain.byPath.get('/weg/a2/'), plain, templates);
    assert.match(page, /class="forecast-pending"/);
    assert.match(page, /<section class="road-questions" id="road-questions" aria-labelledby="rq-title" hidden>/);
    assert.match(page, /<div id="entity-list" class="entity-list"><\/div>/);
  });
});

describe('no template text repeated on every page (AdSense: "low value content")', () => {
  const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
  const pick = (pred) => model.pages.find(pred);

  for (const [label, page] of [
    ['road', model.byPath.get('/weg/a2/')],
    ['gemeente', pick((p) => p.kind === 'gemeente')],
    ['woonplaats', pick((p) => p.kind === 'woonplaats')],
    ['bridge', pick((p) => p.type === 'bridge')],
  ]) {
    it(`${label}: the reading guide is one link to the uitleg, not the same paragraphs again`, () => {
      const text = visibleText(renderPage(page, model, templates));
      assert.doesNotMatch(text, /Zo lees je dit overzicht|De rode badge geeft aan|Wat een brugopening betekent voor het wegverkeer/);
      assert.doesNotMatch(text, /Hoe actueel is/, 'the stamp on the page says how fresh it is');
      assert.match(renderPage(page, model, templates), /href="\/uitleg\/meldingen-lezen\/"/);
      const refreshes = text.match(/elke \d+ minuten/g) ?? [];
      assert.ok(refreshes.length <= 1, `${label}: the refresh rate is said ${refreshes.length} times`);
    });
  }
});

describe('no hidden "nothing here" text', () => {
  const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
  const pick = (pred) => model.pages.find(pred);

  for (const [label, page] of [
    ['road', pick((p) => p.type === 'road')],
    ['gemeente', pick((p) => p.kind === 'gemeente')],
    ['woonplaats', pick((p) => p.kind === 'woonplaats')],
    ['bridge', pick((p) => p.type === 'bridge')],
    ['list', model.byPath.get('/afsluitingen/')],
  ]) {
    it(`${label}: the empty-state text is only in data-empty, for the script`, () => {
      const html = renderPage(page, model, templates);
      const text = visibleText(html);
      assert.doesNotMatch(text, /Geen meldingen|Geen openingen aangemeld/);
      const attr = /id="(?:entity|list)-empty" class="entity-empty" hidden data-empty="([^"]+)"><\/div>/.exec(html);
      assert.ok(attr, 'the empty state waits in data-empty');
      assert.match(attr[1], /^&lt;p&gt;&lt;strong&gt;/);
    });
  }
});

describe('one page per gemeente name', () => {
  const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });

  it('the only woonplaats of a gemeente with the same name has no page but a 301', () => {
    assert.equal(model.byPath.has('/plaats/alblasserdam/'), false);
    assert.ok(model.byPath.has('/gemeente/alblasserdam/'));
    assert.deepEqual(model.redirects.find((r) => r.from === '/plaats/alblasserdam/'), { from: '/plaats/alblasserdam/', to: '/gemeente/alblasserdam/' });
    assert.ok(model.redirects.length > 50 && model.redirects.length < 120, `${model.redirects.length} redirects`);
  });

  it('a gemeente with several woonplaatsen keeps the one with its name (Aalten)', () => {
    assert.ok(model.byPath.has('/plaats/aalten/'));
    assert.ok(model.byPath.has('/plaats/lexmond/'));
    assert.equal(model.redirects.some((r) => r.from === '/plaats/aalten/'), false);
  });

  it('no page links to a redirected woonplaats; the map manifest still knows it', () => {
    const gem = renderPage(model.byPath.get('/gemeente/alblasserdam/'), model, templates);
    assert.doesNotMatch(gem, /href="\/plaats\/alblasserdam\/"/);
    const list = renderPage(model.byPath.get('/plaatsen/'), model, templates);
    assert.doesNotMatch(list, /href="\/plaats\/alblasserdam\/"/);
    assert.ok(buildEntityManifest(model).woonplaatsen.some((w) => w.slug === 'alblasserdam'));
  });

  it('_redirects has both spellings with 301', () => {
    assert.equal(
      buildRedirects([{ from: '/plaats/x/', to: '/gemeente/x/' }]),
      '# Generated by web/scripts/gen-pages.mjs – do not edit.\n/plaats/x/ /gemeente/x/ 301\n/plaats/x /gemeente/x/ 301\n',
    );
  });

  it('generate() writes _redirects and index-state.json', () => {
    const out = mkdtempSync(join(tmpdir(), 'wegwerk-gen-'));
    try {
      generate({ out, sample: true, quiet: true });
      assert.match(readFileSync(join(out, '_redirects'), 'utf8'), /^\/plaats\/alblasserdam\/ \/gemeente\/alblasserdam\/ 301$/m);
      assert.ok(existsSync(join(out, 'index-state.json')));
      assert.equal(JSON.parse(readFileSync(join(out, 'index-state.json'), 'utf8')).v, 1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
