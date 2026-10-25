/**
 * What an AdSense reviewer checks on the generated pages: the account claim in every head, a
 * contact address that survives Cloudflare's e-mail obfuscation, an identifiable publisher once
 * the owner fills it in, and no ads on pages we keep out of Google.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adPolicy } from './helpers/src.mjs';
import { buildModel, renderPage, PAGE_TYPES } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates, protectEmails } from '../scripts/lib/render.mjs';
import { publisherVars } from '../scripts/lib/text.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};
const config = JSON.parse(readFileSync(join(WEB_ROOT, 'site.config.json'), 'utf8'));

const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);
const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
const html = (path) => renderPage(model.byPath.get(path), model, templates);
const accountOf = (doc) => /<meta name="google-adsense-account" content="([^"]+)"/.exec(doc)?.[1];

describe('AdSense account claim', () => {
  it('every generated page and the map page name the configured publisher id', () => {
    assert.equal(config.ads.enabled, true, 'this test assumes ads are on');
    for (const path of ['/weg/a2/', '/over/', '/plaatsen/', '/404.html']) assert.equal(accountOf(html(path)), config.ads.adsenseClient, path);
    assert.equal(accountOf(readFileSync(join(WEB_ROOT, 'index.html'), 'utf8')), config.ads.adsenseClient, 'index.html');
  });

  it('is left out when ads are switched off', () => {
    const off = { ...model, site: { ...model.site, ads: { ...model.site.ads, enabled: false } } };
    assert.equal(accountOf(renderPage(model.byPath.get('/over/'), off, templates)), undefined);
  });
});

describe('contact address', () => {
  it('wraps every mailto link in Cloudflare\'s email_off markers', () => {
    const contact = html('/contact/');
    const links = contact.match(/<a [^>]*href="mailto:/g) ?? [];
    assert.ok(links.length >= 1, 'the contact page has a mailto link');
    const wrapped = contact.match(/<!--email_off--><a [^>]*href="mailto:[^"]*"[^>]*>[^<]*<\/a><!--\/email_off-->/g) ?? [];
    assert.equal(wrapped.length, links.length);
  });

  it('leaves other links alone', () => {
    const src = '<p><a href="/over/">over</a> <a class="x" href="mailto:a@b.nl">a@b.nl</a></p>';
    assert.equal(protectEmails(src), '<p><a href="/over/">over</a> <!--email_off--><a class="x" href="mailto:a@b.nl">a@b.nl</a><!--/email_off--></p>');
  });
});

describe('publisher', () => {
  it('stays a private initiative until the owner fills in a name', () => {
    const v = publisherVars({ name: '', city: 'Utrecht', kvk: '', btw: '' });
    assert.equal(v.sentence, 'Wegwerk is een particulier initiatief.');
    assert.equal(v.registration, '', 'no "zodra ingeschreven" promise: it reads as a site that is not finished');
    assert.equal(publisherVars(undefined).sentence, v.sentence);
  });

  it('names publisher, place and registration once they are filled in', () => {
    const v = publisherVars({ name: ' Jan Jansen ', city: 'Utrecht', kvk: '12345678', btw: 'NL001234567B01' });
    assert.equal(v.sentence, 'Wegwerk wordt uitgegeven door Jan Jansen (Utrecht).');
    assert.equal(v.registration, 'KvK-nummer 12345678, btw-identificatienummer NL001234567B01.');
    assert.match(v.byline, /Jan Jansen \(Utrecht\)/);
  });

  it('puts the address (art. 3:15d BW) in colofon and contact, and only name and city in the byline', () => {
    const v = publisherVars({ name: 'Jan Jansen', address: 'Dorpsstraat 1, 1234 AB Utrecht', city: 'Utrecht' });
    assert.equal(v.sentence, 'Wegwerk wordt uitgegeven door Jan Jansen, Dorpsstraat 1, 1234 AB Utrecht.');
    assert.equal(v.byline, 'Wegwerk wordt gemaakt en onderhouden door Jan Jansen (Utrecht), los van de wegbeheerders.');
  });

  it('colofon, contact and over show the configured publisher', () => {
    const named = { ...model, site: { ...model.site, owner: { name: 'Jan Jansen', city: 'Utrecht', kvk: '', btw: '' } } };
    for (const path of ['/colofon/', '/contact/', '/over/']) {
      assert.match(renderPage(model.byPath.get(path), named, templates), /Jan Jansen \(Utrecht\)/, path);
    }
    assert.doesNotMatch(html('/colofon/'), /\{\{|undefined/);
  });
});

describe('ads only where Google may index', () => {
  it('a noindex page loads no ads', () => {
    assert.equal(adPolicy.robotsAllowAds('noindex, follow'), false);
    assert.equal(adPolicy.robotsAllowAds('noindex, nofollow'), false);
    assert.equal(adPolicy.robotsAllowAds('index, follow, max-image-preview:large'), true);
    assert.equal(adPolicy.robotsAllowAds(undefined), true);
  });

  it('an indexed page that says wegwerk-ads off loads no ads either', () => {
    assert.equal(adPolicy.pageAllowsAds('index, follow', 'off'), false);
    assert.equal(adPolicy.pageAllowsAds('index, follow', ' OFF '), false);
    assert.equal(adPolicy.pageAllowsAds('index, follow', undefined), true);
    assert.equal(adPolicy.pageAllowsAds('noindex, follow', undefined), false);
  });

  it('mountAds asks the policy with the page\'s own robots and ads meta before loading anything', () => {
    // ads.ts imports site.config.json, which Node cannot load in a test; read its source instead.
    const src = readFileSync(join(WEB_ROOT, 'src/ui/ads.ts'), 'utf8');
    const mount = src.slice(src.indexOf('export function mountAds'), src.indexOf('export function openCmp'));
    assert.match(mount, /querySelector<HTMLMetaElement>\('meta\[name="robots"\]'\)\?\.content/);
    assert.match(mount, /querySelector<HTMLMetaElement>\('meta\[name="wegwerk-ads"\]'\)\?\.content/);
    assert.match(mount, /const enabled = adsEnabled\(\) && pageAllowsAds\(robots, adsMeta\);/);
    assert.ok(mount.indexOf('pageAllowsAds') < mount.indexOf('loadAdsenseScript'), 'the policy decides before the script loads');
  });
});
