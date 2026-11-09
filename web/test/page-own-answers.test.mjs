/**
 * The FAQ answers that used to read the same on every road, place and bridge page (AdSense
 * "content van weinig waarde", 2026-11-09): "who reported the work" now comes from the page's own
 * meldingen, "when does the bridge open" from its own openings, and the general text stands once,
 * in /veelgestelde-vragen/.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFixtureData, readJson } from './helpers/fixtures.mjs';
import { entitySnapshot } from './helpers/src.mjs';
import { buildModel, renderPage, PAGE_TYPES } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';
import { BRIDGE_OPENING_FAQ_HREF, authoritySentence, bridgeFaq, placeFaq, roadFaq, roadIntro } from '../scripts/lib/text.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};
const NOW = loadFixtureData().now;

describe('authorities in the snapshot', () => {
  it('counts the publishers of the meldingen the stamp counts, most first', () => {
    const snap = entitySnapshot.entitySnapshot({
      items: readJson('roads/a2.json').items,
      subject: { kind: 'road', name: 'A2' },
      roadType: 'A',
      now: NOW,
      asOf: 'wo 9 sep 14:00',
      mapHref: '/#weg=a2',
    });
    assert.ok(snap.authorities.length > 0, 'the fixture A2 has publishers');
    assert.equal(snap.authorities.reduce((s, a) => s + a.count, 0), snap.count, 'every counted melding has its publisher');
    for (let i = 1; i < snap.authorities.length; i++) assert.ok(snap.authorities[i - 1].count >= snap.authorities[i].count);
  });

  it('leaves out items outside the count and publishers without a name', () => {
    const f = (id, src) => ({ f: { properties: { id, src } }, d: null });
    const items = [f('a', 'Provincie Utrecht'), f('b', 'Provincie Utrecht'), f('c', 'Gemeente Utrecht'), f('d', ''), f('e', 'Rijkswaterstaat')];
    const list = entitySnapshot.authoritiesOf(items, new Set(['a', 'b', 'c', 'd']));
    assert.deepEqual(list, [{ name: 'Provincie Utrecht', count: 2 }, { name: 'Gemeente Utrecht', count: 1 }]);
  });
});

describe('authoritySentence', () => {
  const two = [{ name: 'Provincie Noord-Holland', count: 7 }, { name: 'Gemeente Zandvoort', count: 1 }];

  it('names the publishers with their numbers and the moment of the data', () => {
    assert.equal(
      authoritySentence(two, 'op de N201', 'ma 9 nov 14:12'),
      'Op ma 9 nov 14:12 kwamen de 8 meldingen op de N201 van Provincie Noord-Holland (7) en Gemeente Zandvoort (1).',
    );
    assert.equal(
      authoritySentence([{ name: 'Gemeente Hulst', count: 1 }], 'in Ossenisse', 'ma 9 nov 14:12'),
      'Op ma 9 nov 14:12 was er één melding in Ossenisse, aangemeld door Gemeente Hulst.',
    );
    assert.equal(authoritySentence([{ name: 'Provincie Utrecht', count: 3 }], 'op de N225', ''), 'De 3 meldingen op de N225 kwamen van Provincie Utrecht.');
  });

  it('shows at most five publishers and is null without any', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `Gemeente ${i}`, count: 10 - i }));
    assert.match(authoritySentence(many, 'op de N1', 'x'), /Gemeente 4 \(6\) en nog 2 andere\.$/);
    assert.equal(authoritySentence([], 'op de N1', 'x'), null);
    assert.equal(authoritySentence(null, 'op de N1', 'x'), null);
  });

  it('adds meldingen without a publisher so the total matches the stamp above the list', () => {
    assert.equal(
      authoritySentence([{ name: 'Provincie Utrecht', count: 3 }], 'op de N225', 'x', 4),
      'Op x kwamen de 4 meldingen op de N225 van Provincie Utrecht (3) en 1 zonder opgegeven bron.',
    );
    assert.equal(authoritySentence([{ name: 'Provincie Utrecht', count: 3 }], 'op de N225', '', 3), 'De 3 meldingen op de N225 kwamen van Provincie Utrecht.');
  });

  it('escapes names in the HTML answer', () => {
    assert.match(authoritySentence([{ name: 'A&B <x>', count: 2 }], 'op de N1', 'x'), /A&amp;B &lt;x&gt;/);
  });
});

describe('FAQ answers from the page data', () => {
  const data = { authorities: [{ name: 'Provincie Noord-Holland', count: 7 }, { name: 'Gemeente Zandvoort', count: 1 }], asOf: 'ma 9 nov 14:12' };

  it('a road with data asks who reported the work and answers from it; without data the general text stays', () => {
    const withData = roadFaq({ road: 'N201', type: 'N' }, data);
    assert.equal(withData[1].q, 'Wie heeft het werk op de N201 aangemeld?');
    assert.match(withData[1].a, /^Op ma 9 nov 14:12 kwamen de 8 meldingen op de N201 van Provincie Noord-Holland \(7\)/);
    assert.doesNotMatch(withData[1].a, /N-wegen zijn meestal in beheer/);
    assert.match(roadFaq({ road: 'A2', type: 'A' }, data)[1].a, /0800-8002/, 'A-roads keep the Rijkswaterstaat line');
    assert.match(roadFaq({ road: 'N201', type: 'N' })[1].a, /N-wegen zijn meestal in beheer/);
    assert.match(roadFaq({ road: 'N201', type: 'N' }, { authorities: [], asOf: 'x' })[1].q, /Wie is de wegbeheerder/);
  });

  it('an N-road with a route sentence no longer repeats "De weg is een N-weg"', () => {
    const names = ['Zandvoort → Hoofddorp', 'Hoofddorp → Uithoorn', 'Uithoorn → Hilversum'];
    const withRoute = roadIntro({ road: 'N201', type: 'N', names });
    assert.match(withRoute, /^<p>De N201 loopt van Zandvoort via Hoofddorp en Uithoorn naar Hilversum\.<\/p>/);
    assert.doesNotMatch(withRoute, /N-weg: meestal/);
    assert.doesNotMatch(withRoute, /\s{2}/, 'no double space where the sentence was');
    assert.match(roadIntro({ road: 'N999', type: 'N', names: [] }), /De N999 is een N-weg/, 'without a route the sentence still says what the road is');
  });

  it('a place with data answers who reported the work; names stay plain text in the question', () => {
    const bosch = { naam: "'s-Hertogenbosch", gemeente: "'s-Hertogenbosch", prov: 'Noord-Brabant' };
    const [withData] = placeFaq(bosch, 'gemeente', data);
    assert.equal(withData.q, "Wie heeft het werk in de gemeente 's-Hertogenbosch aangemeld?");
    assert.match(withData.a, /in de gemeente &#39;s-Hertogenbosch van Provincie Noord-Holland/, 'the HTML answer is escaped');
    const [fallback] = placeFaq(bosch, 'gemeente');
    assert.equal(fallback.q, "Wie voert de werkzaamheden in de gemeente 's-Hertogenbosch uit en waar kan ik terecht met vragen?");
  });

  it('a bridge answers from its own openings and links the general text once', () => {
    const b = { name: 'Beltbrug' };
    const [planned] = bridgeFaq(b, { opening: { count: 20, first: 'di 10 nov 06:30', openNow: false }, asOf: 'ma 9 nov 14:12' });
    assert.match(planned.a, /^Op ma 9 nov 14:12 stonden er 20 openingen van Beltbrug gepland voor de komende zeven dagen, de eerste di 10 nov 06:30\./);
    assert.ok(planned.a.includes(BRIDGE_OPENING_FAQ_HREF));
    assert.match(bridgeFaq(b, { opening: { count: 0, first: '', openNow: true }, asOf: 'x' })[0].a, /stond Beltbrug open voor de scheepvaart\./);
    assert.match(bridgeFaq(b)[0].a, /staan hierboven zodra ze bekend zijn/);
    // One opening: singular verb; no start still to come: no "de eerste …".
    const [one] = bridgeFaq(b, { opening: { count: 1, first: 'di 10 nov 06:30', openNow: false }, asOf: 'ma 9 nov 14:12' });
    assert.match(one.a, /^Op ma 9 nov 14:12 stond er één opening van Beltbrug gepland voor de komende zeven dagen, de eerste di 10 nov 06:30\. Die staat hierboven\./);
    const [openOne] = bridgeFaq(b, { opening: { count: 1, first: '', openNow: true }, asOf: 'x' });
    assert.match(openOne.a, /Voor de komende zeven dagen stond er één opening gepland; die staat hierboven\./);
    assert.doesNotMatch(openOne.a, /de eerste/);
    assert.equal(bridgeFaq(b).length, 1, 'what an opening means for traffic stands once, in the FAQ');
  });

  it('the FAQ page has the bridge question the bridge pages link to', () => {
    const faq = readFileSync(join(WEB_ROOT, 'content/veelgestelde-vragen.md'), 'utf8');
    assert.match(faq, /^## Wat gebeurt er met het verkeer als een brug opengaat\?$/m);
    assert.ok(BRIDGE_OPENING_FAQ_HREF.endsWith('#wat-gebeurt-er-met-het-verkeer-als-een-brug-opengaat'));
  });
});

describe('rendered pages', () => {
  const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
  const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);

  it("the Den Bosch question shows 's-Hertogenbosch, not &#39;", () => {
    const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
    const html = renderPage(model.byPath.get('/gemeente/s-hertogenbosch/'), model, templates);
    const questions = html.match(/<summary>[^<]*<\/summary>/g) ?? [];
    assert.ok(questions.length > 0);
    for (const q of questions) assert.doesNotMatch(q, /&amp;#39;/, q);
    assert.ok(questions.some((q) => q.includes('&#39;s-Hertogenbosch')), 'the name is escaped once');
  });

  it('a page with a snapshot gets the data answer in its HTML', () => {
    const snapshotFor = (page) =>
      page.path === '/weg/n201/'
        ? { count: 2, answerHtml: '', listHtml: '', questionsHtml: '', authorities: [{ name: 'Provincie Noord-Holland', count: 2 }], asOf: 'ma 9 nov 14:12' }
        : null;
    const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, snapshotFor, warn: quiet });
    const html = renderPage(model.byPath.get('/weg/n201/'), model, templates);
    assert.match(html, /Wie heeft het werk op de N201 aangemeld\?/);
    assert.match(html, /kwamen de 2 meldingen op de N201 van Provincie Noord-Holland\./);
  });
});
