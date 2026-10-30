/**
 * Phase 1 of docs/groei-onderzoek-2026-10.md. Search Console (3–18 October 2026) showed road
 * pages at 2.3% CTR against 6.8% for gemeente pages, with 76–89 character titles that Google cut
 * off or rewrote. Titles now put the search term first, fit 60 characters and lose " | Wegwerk";
 * the share image, the robots rules for map links and the homepage links come with it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildModel, pageContext, renderPage, PAGE_TYPES } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';
import { MAP_STATE_DISALLOW, buildRobots } from '../scripts/lib/sitemap.mjs';
import {
  TITLE_MAX, bridgeTitle, fitTitle, hasSameNameKern, placeDescription, placeHeading, placeIntro, placeTitle,
  roadDescription, roadTitle, todayLabel, weekendLabel,
} from '../scripts/lib/text.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};
const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);
const BUILD = new Date('2026-10-20T04:41:00Z'); // the daily deploy, a Tuesday
const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, now: BUILD, warn: quiet });
const ctx = (path) => pageContext(model.byPath.get(path), model);

const eindhoven = { naam: 'Eindhoven', prov: 'Noord-Brabant' };
const bosch = { naam: "'s-Hertogenbosch", prov: 'Noord-Brabant' };
const haarlemmermeer = { naam: 'Haarlemmermeer', prov: 'Noord-Holland' };

describe('road titles and descriptions', () => {
  it('put the road number first, fit 60 characters and carry no site name', () => {
    const title = roadTitle({ road: 'A2', names: [] });
    assert.equal(title, 'A2 afsluitingen & werkzaamheden: vandaag en dit weekend');
    assert.ok(title.length <= TITLE_MAX);
    assert.doesNotMatch(title, /\|/);
  });

  it('describe the road as a question, with its route and how fresh the data is', () => {
    const d = ctx('/weg/a2/').description;
    assert.match(d, /^Is de A2 dicht\? /);
    assert.match(d, /\(.+ – .+\)/, 'the route stays in when it fits');
    assert.match(d, /Elk kwartier bijgewerkt\.$/);
    assert.ok(d.length <= 158);
    assert.match(roadDescription({ road: 'N57', names: [] }), /^Is de N57 dicht\?/);
  });
});

describe('place titles', () => {
  it('drop "gemeente" when the gemeente has a place of its own name', () => {
    assert.equal(placeTitle(eindhoven, 'gemeente', { sameNameKern: true }), 'Wegwerkzaamheden Eindhoven: wat is nu dicht?');
    assert.equal(placeTitle(haarlemmermeer, 'gemeente'), 'Wegwerkzaamheden gemeente Haarlemmermeer: wat is nu dicht?');
    assert.equal(hasSameNameKern(eindhoven, [{ naam: 'Eindhoven' }]), true);
    assert.equal(hasSameNameKern(haarlemmermeer, [{ naam: 'Hoofddorp' }, { naam: 'Nieuw-Vennep' }]), false);
    assert.match(placeDescription(haarlemmermeer, 'gemeente'), /^Welke wegen zijn nu dicht in de gemeente Haarlemmermeer/);
    assert.match(placeDescription(eindhoven, 'gemeente', { sameNameKern: true }), /^Welke wegen zijn nu dicht in Eindhoven /);
  });

  it('use Den Bosch and Den Haag, the names people search for', () => {
    assert.equal(ctx('/gemeente/s-hertogenbosch/').title, 'Wegwerkzaamheden Den Bosch: wat is nu dicht?');
    assert.equal(ctx('/gemeente/s-gravenhage/').title, 'Wegwerkzaamheden Den Haag: wat is nu dicht?');
    assert.equal(placeHeading(bosch, 'gemeente'), "Wegwerkzaamheden Den Bosch (gemeente 's-Hertogenbosch)");
    assert.equal(placeHeading({ ...bosch, gemeente: bosch.naam }, 'woonplaats'), "Wegwerkzaamheden in Den Bosch ('s-Hertogenbosch)");
    assert.match(placeDescription(bosch, 'gemeente', { sameNameKern: true }), /Den Bosch \('s-Hertogenbosch\)/);
    assert.match(placeIntro(bosch, 'gemeente', []), /De gemeente &#39;s-Hertogenbosch, beter bekend als Den Bosch, ligt/);
    assert.equal(placeHeading(eindhoven, 'gemeente'), 'Wegwerkzaamheden gemeente Eindhoven');
  });

  it('show the alias in the rendered H1', () => {
    const html = renderPage(model.byPath.get('/gemeente/s-hertogenbosch/'), model, templates);
    assert.match(html, /<h1[^>]*>Wegwerkzaamheden Den Bosch \(gemeente &#39;s-Hertogenbosch\)<\/h1>/);
  });

  it('keep the gemeente on a woonplaats and tell a same-named woonplaats from its gemeente', () => {
    assert.equal(placeTitle({ naam: 'Lexmond', gemeente: 'Vijfheerenlanden' }, 'woonplaats'), 'Wegwerkzaamheden Lexmond (Vijfheerenlanden): wat is dicht?');
    assert.equal(placeTitle({ naam: 'Eindhoven', gemeente: 'Eindhoven' }, 'woonplaats'), 'Wegwerkzaamheden Eindhoven (woonplaats): wat is nu dicht?');
    // Aalten has four woonplaatsen, so both pages exist; Eindhoven has only its own and the
    // woonplaats URL redirects to the gemeente (pages.mjs mergedWoonplaatsen).
    assert.notEqual(ctx('/plaats/aalten/').title, ctx('/gemeente/aalten/').title);
  });
});

describe('bridge titles', () => {
  it('keep the distinguishing variant and do not repeat a place the name carries', () => {
    assert.equal(bridgeTitle({ name: 'Haringvlietbrug', road: 'A29' }), 'Brugopeningen Haringvlietbrug (A29): vandaag en deze week');
    assert.equal(bridgeTitle({ name: 'Hefbrug, Alphen aan den Rijn', woonplaats: 'Alphen aan den Rijn' }), 'Brugopeningen Hefbrug, Alphen aan den Rijn');
    assert.match(bridgeTitle({ name: 'Brug in de Buitenhaven bij Terneuzen', woonplaats: 'Terneuzen' }, 'noordelijke brug'), /\(noordelijke brug\)/);
  });
});

describe('fitTitle', () => {
  it('takes the first variant that fits and never cuts a title off', () => {
    assert.equal(fitTitle(['x'.repeat(61), 'kort']), 'kort');
    const long = 'Wegwerkzaamheden Koudekerk aan den Rijn (Alphen aan den Rijn)';
    assert.equal(fitTitle([`${long}: wat is nu dicht?`, long]), long);
  });
});

describe('date labels for /vandaag/ and /dit-weekend/', () => {
  it('name the build day', () => {
    assert.equal(todayLabel('2026-10-20T04:41:00Z'), 'di 20 okt');
    assert.equal(todayLabel('not a date'), '');
  });

  it('name the weekend that holds for the whole day after the build', () => {
    assert.equal(weekendLabel('2026-10-20T04:41:00Z'), '23–26 okt', 'Tuesday: the coming weekend');
    assert.equal(weekendLabel('2026-10-23T04:41:00Z'), '23–26 okt', 'Friday: this weekend');
    assert.equal(weekendLabel('2026-10-24T04:41:00Z'), '23–26 okt', 'Saturday: the weekend in progress');
    assert.equal(weekendLabel('2026-10-25T04:41:00Z'), '23–26 okt', 'Sunday, the day the clocks go back');
    assert.equal(weekendLabel('2026-10-26T04:41:00Z'), '30 okt – 2 nov', 'Monday morning (05:41 CET): already the next one');
    assert.equal(weekendLabel('nope'), '');
  });

  it('go into the list titles without a site name, and leave no empty brackets without a date', () => {
    assert.equal(ctx('/vandaag/').title, 'Wegwerkzaamheden vandaag (di 20 okt): wat is dicht?');
    assert.equal(ctx('/dit-weekend/').title, 'Afsluitingen dit weekend (23–26 okt): wat is dicht?');
    assert.match(ctx('/dit-weekend/').description, /^Welke wegen zijn dit weekend \(23–26 okt\) dicht\?/);
    assert.equal(ctx('/afsluitingen/').title, 'Wegafsluitingen Nederland: welke wegen zijn nu dicht?');
    const undated = { ...model, buildIso: 'invalid' };
    const page = model.byPath.get('/dit-weekend/');
    assert.equal(pageContext(page, undated).title, 'Afsluitingen dit weekend: wat is dicht?');
    assert.match(pageContext(model.byPath.get('/vandaag/'), undated).description, /^Wat is er vandaag dicht\?/);
  });
});

describe('every generated page', () => {
  const contexts = model.pages.map((p) => [p, pageContext(p, model)]);

  it('has a unique title', () => {
    const seen = new Map();
    for (const [p, c] of contexts) {
      assert.ok(!seen.has(c.title), `${p.path} and ${seen.get(c.title)} share "${c.title}"`);
      seen.set(c.title, p.path);
    }
  });

  it('drops " | Wegwerk" on entity and list pages, and fits 60 characters on roads and gemeenten', () => {
    for (const [p, c] of contexts) {
      if (p.type === 'static') continue;
      assert.doesNotMatch(c.title, /\| Wegwerk$/, p.path);
      if (p.type === 'road' || p.kind === 'gemeente' || p.type === 'list') assert.ok(c.title.length <= TITLE_MAX, `${p.path}: ${c.title}`);
      assert.ok(!c.description.endsWith('…'), `${p.path}: description cut off`);
    }
  });
});

describe('share image', () => {
  const png = readFileSync(join(WEB_ROOT, 'public', 'og-image.png'));
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };

  it('is a 1200×630 PNG configured in site.config.json', () => {
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.deepEqual(size, { width: 1200, height: 630 });
    assert.equal(model.site.ogImage, '/og-image.png');
  });

  it('is in every page head with its size and alt text, and on the homepage', () => {
    const html = renderPage(model.byPath.get('/weg/a2/'), model, templates);
    assert.match(html, /<meta property="og:image" content="https:\/\/www\.wegwerkzaamhedennederland\.nl\/og-image\.png">/);
    assert.match(html, /<meta property="og:image:width" content="1200">/);
    assert.match(html, /<meta property="og:image:height" content="630">/);
    assert.match(html, /<meta property="og:image:alt" content="[^"]+">/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    const home = readFileSync(join(WEB_ROOT, 'index.html'), 'utf8');
    assert.match(home, /<meta property="og:image" content="https:\/\/www\.wegwerkzaamhedennederland\.nl\/og-image\.png" \/>/);
    assert.match(home, /<meta property="og:image:width" content="1200" \/>/);
    assert.match(home, /<meta name="twitter:card" content="summary_large_image" \/>/);
  });
});

describe('robots.txt', () => {
  it('keeps crawlers off the map deep links (?id=, ?c=, ?b=)', () => {
    const robots = buildRobots({ siteUrl: 'https://www.wegwerkzaamhedennederland.nl', disallow: MAP_STATE_DISALLOW });
    for (const rule of ['Disallow: /*?id=', 'Disallow: /*?c=', 'Disallow: /*?b=']) assert.ok(robots.split('\n').includes(rule), rule);
  });
});

describe('homepage', () => {
  const home = readFileSync(join(WEB_ROOT, 'index.html'), 'utf8');

  it('has a short title and a description Google shows whole', () => {
    const title = /<title>([^<]+)<\/title>/.exec(home)[1];
    assert.equal(title, 'Wegwerkzaamheden Nederland – live kaart met afsluitingen');
    const description = /name="description"\s+content="([^"]+)"/.exec(home)[1];
    assert.ok(description.length <= 155, `${description.length} characters`);
  });

  it('links the most visited roads and gemeenten, all to pages that exist', () => {
    const block = home.slice(home.indexOf('class="home__popular"'), home.indexOf('</section>', home.indexOf('class="home__popular"')));
    const hrefs = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(hrefs.length, 12);
    for (const href of hrefs) assert.ok(model.byPath.has(href), `${href} is not a generated page`);
    assert.match(block, />Den Bosch</);
  });
});
