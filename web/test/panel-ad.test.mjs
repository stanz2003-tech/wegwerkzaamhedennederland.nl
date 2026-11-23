/**
 * ui/panel-ad.ts + its wiring: the one ad on the map, inside an opened melding, under its answer.
 * Measured in the week to 16 Nov 2026: about 700 readers a day click from a text page on to the
 * map and click some 10,000 times a day inside it, where no ad stood. The slot asks for an ad when the reader
 * comes near it, and for a new one only when the reader opens another melding at least half a
 * minute after the last: never on a timer (AdSense forbids refreshing "without the user
 * requesting" it), and never faster than an ad can be seen.
 * ads.ts imports site.config.json, which Node cannot load in a test, so its source is read.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { panelAd, uiDetail } from './helpers/src.mjs';

const { createPanelAd, RENEW_AFTER_MS } = panelAd;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** A slot that records what the panel ad asks of it; `reach()` is the reader scrolling to it. */
function fakeSlot() {
  const state = { shown: 0, watches: 0, cancelled: 0, cleared: 0, onReach: null };
  return {
    state,
    slot: {
      show: () => {
        state.shown += 1;
      },
      whenInReach: (cb) => {
        state.watches += 1;
        state.onReach = cb;
        return () => {
          state.cancelled += 1;
          state.onReach = null;
        };
      },
      clear: () => {
        state.cleared += 1;
      },
    },
    reach: () => {
      const cb = state.onReach;
      state.onReach = null;
      cb?.();
    },
  };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, pass: (ms) => (t += ms) };
}

describe('the ad under an opened melding', () => {
  it('asks for nothing until a melding is opened', () => {
    const { slot, state } = fakeSlot();
    createPanelAd(slot, clock().now);
    assert.equal(state.watches, 0);
    assert.equal(state.shown, 0);
  });

  it('the first melding: the ad comes when the reader gets near the slot, not before', () => {
    const { slot, state, reach } = fakeSlot();
    const ad = createPanelAd(slot, clock().now);
    ad.meldingOpened();
    assert.equal(state.watches, 1);
    assert.equal(state.shown, 0, 'not requested while it is out of reach');
    reach();
    assert.equal(state.shown, 1);
  });

  it('a second melding within half a minute keeps the ad that is there', () => {
    const { slot, state, reach } = fakeSlot();
    const time = clock();
    const ad = createPanelAd(slot, time.now);
    ad.meldingOpened();
    reach();
    time.pass(RENEW_AFTER_MS - 1);
    ad.meldingOpened();
    assert.equal(state.watches, 1, 'no new watch');
    assert.equal(state.shown, 1);
  });

  it('another melding half a minute later brings a new ad, again only within reach', () => {
    const { slot, state, reach } = fakeSlot();
    const time = clock();
    const ad = createPanelAd(slot, time.now);
    ad.meldingOpened();
    reach();
    time.pass(RENEW_AFTER_MS);
    ad.meldingOpened();
    assert.equal(state.watches, 2);
    assert.equal(state.shown, 1, 'the new ad waits for the reader as well');
    reach();
    assert.equal(state.shown, 2);
  });

  it('time alone never brings a new ad: the reader has to open another melding', () => {
    const { slot, state, reach } = fakeSlot();
    const time = clock();
    const ad = createPanelAd(slot, time.now);
    ad.meldingOpened();
    reach();
    time.pass(RENEW_AFTER_MS * 20);
    assert.equal(state.watches, 1);
    assert.equal(state.shown, 1);
  });

  it('the half minute counts from the moment the ad was asked for, not from the click', () => {
    const { slot, state, reach } = fakeSlot();
    const time = clock();
    const ad = createPanelAd(slot, time.now);
    ad.meldingOpened();
    time.pass(RENEW_AFTER_MS * 2); // read the melding for a minute, then scrolled down to the slot
    reach();
    time.pass(1000);
    ad.meldingOpened();
    assert.equal(state.watches, 1, 'the ad is one second old');
    assert.equal(state.shown, 1);
  });

  it('meldingen opened while the slot still waits do not stack up watches', () => {
    const { slot, state, reach } = fakeSlot();
    const time = clock();
    const ad = createPanelAd(slot, time.now);
    ad.meldingOpened();
    time.pass(RENEW_AFTER_MS * 3);
    ad.meldingOpened();
    ad.meldingOpened();
    assert.equal(state.watches, 1);
    reach();
    assert.equal(state.shown, 1);
  });

  it('back in the list the ad leaves the page with the melding, and the half minute keeps counting', () => {
    const { slot, state, reach } = fakeSlot();
    const time = clock();
    const ad = createPanelAd(slot, time.now);
    ad.meldingOpened();
    reach();
    time.pass(10_000);
    ad.meldingClosed();
    assert.equal(state.cleared, 1, 'taken out, not hidden');
    time.pass(5_000);
    ad.meldingOpened();
    assert.equal(state.watches, 1, 'fifteen seconds after the last ad: this melding gets none');
    time.pass(RENEW_AFTER_MS);
    ad.meldingClosed();
    ad.meldingOpened();
    assert.equal(state.watches, 2);
    reach();
    assert.equal(state.shown, 2);
  });

  it('closing a melding whose ad was never reached stops the watch: no ad arrives in the list', () => {
    const { slot, state, reach } = fakeSlot();
    const ad = createPanelAd(slot, clock().now);
    ad.meldingOpened();
    ad.meldingClosed();
    assert.equal(state.cancelled, 1);
    reach();
    assert.equal(state.shown, 0);
    ad.meldingOpened();
    assert.equal(state.watches, 2, 'the next melding watches again');
  });

  it('half a minute is the floor', () => {
    assert.equal(RENEW_AFTER_MS, 30_000);
  });
});

describe('where the map slot stands and how it is wired', () => {
  const html = read('../index.html');
  const ads = read('../src/ui/ads.ts');
  const main = read('../src/main.ts');
  const controller = read('../src/ui/detail-controller.ts');
  const detail = read('../src/ui/detail.ts');
  const css = read('../src/styles/panel.css');
  const config = JSON.parse(read('../site.config.json'));
  const SLOT = '<div class="ad-slot ad-slot--panel" data-ad-slot="panel" data-detail-break aria-hidden="true"></div>';

  it('one slot, inside the view of an opened melding: never in the list and never on the map itself', () => {
    assert.equal(html.split('data-ad-slot=').length - 1, 1);
    assert.ok(html.includes(`<div class="panel__view panel__view--detail" data-detail hidden>${SLOT}</div>`));
    const mapSection = html.slice(html.indexOf('<section class="map"'), html.indexOf('</section>', html.indexOf('<section class="map"')));
    assert.doesNotMatch(mapSection, /ad-slot/);
  });

  it('the melding is written around the slot: the answer above it, the background below', () => {
    // Measured 23 Nov 2026: under the whole melding the slot stood 1,500 px down a 680 px panel,
    // and under "Zo meldt de wegbeheerder het" still 925 px down a 768 px window.
    const write = detail.slice(detail.indexOf('function setDetailContent'), detail.indexOf('export const GMAPS_DETOUR_NOTE'));
    assert.match(write, /for \(const child of Array\.from\(root\.childNodes\)\) if \(child !== keep\) child\.remove\(\);/);
    assert.match(write, /keep\.insertAdjacentHTML\('beforebegin', `<article class="detail"/);
    assert.match(write, /keep\.insertAdjacentHTML\('afterend', `<div class="detail detail--rest"/);
    const head = detail.slice(detail.indexOf('const head = `'), detail.indexOf('const rest = `'));
    const rest = detail.slice(detail.indexOf('const rest = `'), detail.indexOf('setDetailContent(root,'));
    for (const part of ['renderVerdictBanner', 'whenBlock(', 'detail__detour', 'detail__actions', 'data-retry']) assert.ok(head.includes(part), `above the ad: ${part}`);
    for (const part of ['Zo meldt de wegbeheerder het', 'phasesBlock(', 'periodsBlock(', 'Toelichting', 'detail__source']) assert.ok(rest.includes(part), `below the ad: ${part}`);
    assert.doesNotMatch(head, /Zo meldt de wegbeheerder het|phasesBlock\(|detail__source/);
  });

  it('a repaint leaves the slot where it is: everything else is replaced around it', () => {
    /** The least of a DOM that setDetailContent touches: a root with children, one of them the slot. */
    const node = (name) => ({ name, removed: false, remove() { this.removed = true; } });
    const written = [];
    const keep = { name: 'slot', removed: false, remove() { this.removed = true; }, insertAdjacentHTML: (where, html) => written.push([where, html]) };
    const old = [node('article'), node('text'), node('rest')];
    const root = { childNodes: [old[0], old[1], keep, old[2]], querySelector: (sel) => (sel === ':scope > [data-detail-break]' ? keep : null) };
    const props = { id: 'd1', cat: 'werk', title: 'A27 Gorinchem', road: 'A27', roadType: 'A', start: '2026-09-28T08:00:00Z', end: '2026-09-28T18:00:00Z', src: 'RWS', imp: 'rijbaan' };
    const state = { props, center: [5, 52], detail: { id: 'd1', src: 'RWS', desc: 'Groot onderhoud.' }, loading: false, error: false, mode: 'auto' };
    uiDetail.renderDetail(root, state, Date.parse('2026-09-28T10:00:00Z'), { onBack() {}, onShare() {}, onRetry() {} });
    assert.equal(keep.removed, false, 'the ad is never taken out of the page');
    assert.deepEqual(old.map((n) => n.removed), [true, true, true]);
    assert.deepEqual(written.map(([where]) => where), ['beforebegin', 'afterend']);
    const [[, head], [, rest]] = written;
    assert.match(head, /^<article class="detail" data-cat="werk" data-verdict="\w+" aria-labelledby="detail-title">/);
    assert.match(head, /id="detail-title"/);
    assert.doesNotMatch(head, /Groot onderhoud\./);
    assert.match(rest, /^<div class="detail detail--rest" data-cat="werk"/);
    assert.match(rest, /Groot onderhoud\./);
    assert.match(rest, /detail__source/);
    assert.equal((head + rest).split('<article').length - 1, 1, 'one article, one title');
  });

  it('without a slot (a test, a page without ads) the melding is one article as before', () => {
    const root = { innerHTML: '', querySelector: () => null };
    const props = { id: 'd1', cat: 'werk', title: 'A27 Gorinchem', road: 'A27', roadType: 'A', start: '2026-09-28T08:00:00Z', end: '2026-09-28T18:00:00Z', src: 'RWS', imp: 'rijbaan' };
    const state = { props, center: [5, 52], detail: { id: 'd1', src: 'RWS', desc: 'Groot onderhoud.' }, loading: false, error: false, mode: 'auto' };
    uiDetail.renderDetail(root, state, Date.parse('2026-09-28T10:00:00Z'), { onBack() {}, onShare() {}, onRetry() {} });
    assert.match(root.innerHTML, /^<article class="detail" data-cat="werk" data-verdict="\w+" aria-labelledby="detail-title">/);
    assert.match(root.innerHTML, /<\/footer>\s*<\/article>$/);
    assert.equal(root.innerHTML.split('<article').length - 1, 1);
    assert.ok(root.innerHTML.indexOf('detail__title') < root.innerHTML.indexOf('Groot onderhoud.'));
  });

  it('the two parts are spaced as the one block they were', () => {
    assert.match(css, /\.panel__view--detail > \.detail:has\(\+ \.ad-slot--panel\)\s*\{\s*padding-bottom:\s*0;/);
    // Heavier than `.panel.is-detail .detail`, which sets the phone's smaller top padding later in the file.
    assert.match(css, /\.panel \.panel__view--detail > \.detail\.detail--rest\s*\{\s*padding-top:\s*var\(--s-4\);/);
  });

  it('the slot has an ad unit of its own, so the map shows up apart in the AdSense reports', () => {
    assert.match(config.ads.slots.panel, /^\d{10}$/);
    assert.notEqual(config.ads.slots.panel, config.ads.slots.article);
  });

  it('the map does not use the page-wide mountAds: no script and no consent dialog before a melding is opened', () => {
    assert.doesNotMatch(main, /mountAds\(/);
    assert.match(main, /renewableSlot\(/);
    assert.match(main, /createPanelAd\(/);
  });

  it('only opening another melding counts: a repaint of the one on screen does not', () => {
    assert.match(controller, /if \(feature\.properties\.id !== previous\) host\.opened\?\.\(\);/);
    assert.match(main, /opened: \(\) => panelAd\?\.meldingOpened\(\)/);
  });

  it('closing the melding takes the ad out before the view is hidden: an ad unit is never hidden', () => {
    const close = controller.slice(controller.indexOf('if (!feature) {'), controller.indexOf('host.makeRoom();'));
    assert.ok(close.indexOf('host.closed?.()') >= 0 && close.indexOf('host.closed?.()') < close.indexOf('host.detailEl.hidden = true'));
    assert.match(main, /closed: \(\) => panelAd\?\.meldingClosed\(\)/);
    const clear = ads.slice(ads.indexOf('clear() {'), ads.indexOf('/** The AdSense script also waits'));
    assert.match(clear, /closeBox\(el\);/);
  });

  it('a renewed ad replaces the old one in the same box; the page rules for ads still decide', () => {
    const renewable = ads.slice(ads.indexOf('export function renewableSlot'), ads.indexOf('/** The AdSense script also waits'));
    assert.match(renewable, /pageShowsAds\(\) \? slotIdFor\(name\) : ''/);
    assert.match(renewable, /querySelector\('ins\.adsbygoogle'\)\?\.remove\(\);/);
    assert.match(renewable, /hideIfNotTaken\(/);
    assert.match(renewable, /onFail\(retire\)/);
  });

  it('the pages that describe the ads no longer say the map has none', () => {
    for (const name of ['colofon', 'cookies', 'over', 'privacy']) {
      const text = read(`../content/${name}.md`);
      assert.doesNotMatch(text, /niet op de kaart|de kaart heeft geen advertenties|op de kaart staan er geen/i, name);
      assert.match(text, /geopende melding/i, name);
    }
  });
});
