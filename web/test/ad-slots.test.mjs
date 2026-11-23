/**
 * ui/ads.ts + components.css: each slot asks AdSense for an ad shape that fits the box it
 * reserves, a slot AdSense cannot fill collapses instead of staying an empty grey box, and the
 * page boot no longer adds the AdSense script itself: ui/ad-loader.ts does, once the page is done.
 * ads.ts imports site.config.json, which Node cannot load in a test, so its source is read; the
 * loader and the cookie link are tested on their own (ad-loader.test.mjs, cmp.test.mjs).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ads = read('../src/ui/ads.ts');
const css = read('../src/styles/components.css');
const mount = ads.slice(ads.indexOf('export function mountAds'), ads.indexOf('export function openCmp'));

/** `const NAME: Record<SlotName, …> = { panel: …, list: …, article: … }` as an object. */
function slotRecord(name) {
  const body = new RegExp(`const ${name}: Record<SlotName, [^>]+> = \\{([^}]+)\\}`).exec(ads)?.[1];
  assert.ok(body, `${name} not found in ads.ts`);
  return Object.fromEntries([...body.matchAll(/(\w+): '?(\w+)'?/g)].map((m) => [m[1], m[2]]));
}

describe('ad slot shape', () => {
  const height = slotRecord('SLOT_HEIGHT');
  const format = slotRecord('SLOT_FORMAT');

  it('the 280 px article box asks for a rectangle, not a banner that leaves it mostly empty', () => {
    assert.equal(height.article, '280');
    assert.equal(format.article, 'rectangle');
  });

  it('every box asks for the shape that fits it: rectangles from 250 px, banners below', () => {
    assert.deepEqual(Object.keys(format).sort(), Object.keys(height).sort());
    for (const [slot, px] of Object.entries(height)) {
      assert.equal(format[slot], Number(px) >= 250 ? 'rectangle' : 'horizontal', slot);
    }
    assert.match(ads, /ins\.dataset\.adFormat = SLOT_FORMAT\[name\];/);
  });

  it('a slot AdSense leaves unfilled collapses, label and grey box included', () => {
    assert.match(css, /\.ad-slot:has\(> ins\.adsbygoogle\[data-ad-status='unfilled'\]\)\s*\{\s*display:\s*none;\s*\}/);
  });
});

describe('where the slots stand and when they ask for their ad', () => {
  const template = (name) => read(`../templates/${name}.html`);
  const TOP = '<div class="ad-slot ad-slot--article ad-slot--top" data-ad-slot="top" aria-hidden="true"></div>';

  it('road, place and bridge pages carry a slot between the small map and the list', () => {
    // Measured on a phone, 16 Nov 2026: the only slot stood 3,500 to 9,600 px down, under the
    // whole list, and 10% of its ads were seen. Under the map it is the second screen.
    for (const name of ['road', 'place', 'bridge']) {
      const html = template(name);
      assert.ok(html.includes(TOP), name);
      assert.ok(html.indexOf('entity-mapcol__open') < html.indexOf(TOP), `${name}: after the map and its link`);
      assert.ok(html.indexOf(TOP) < html.indexOf('id="entity-list"'), `${name}: before the list`);
    }
  });

  it('a bridge over water without a road page has it between the map and the openings', () => {
    const html = template('bridge');
    const openings = html.slice(html.indexOf('{{else}}<section class="entity-live"'));
    assert.ok(openings.indexOf('id="entity-map"') < openings.indexOf(TOP));
    assert.ok(openings.indexOf(TOP) < openings.indexOf('class="entity-openings"'));
  });

  it('no slot stands above the answer: the reader gets the verdict first', () => {
    for (const name of ['road', 'place', 'bridge']) {
      const html = template(name);
      assert.ok(html.indexOf('id="entity-forecast"') < html.indexOf('data-ad-slot='), name);
    }
  });

  it('the slots under the map show at once; every other slot waits for the reader (ui/ad-lazy.ts)', () => {
    assert.match(ads, /const EAGER_SLOTS: ReadonlySet<SlotName> = new Set<SlotName>\(\['top', 'side'\]\);/);
    assert.match(mount, /if \(EAGER_SLOTS\.has\(slot\.name\)\) \{\s*show\(slot\);/);
    assert.match(mount, /slot\.el\.classList\.add\('is-waiting'\);\s*return whenNear\(slot\.el, \(\) => showIfApart\(slot\)\);/);
  });

  it('a waiting slot opens only with a screen of page between it and the ads already shown', () => {
    const apart = mount.slice(mount.indexOf('const showIfApart ='), mount.indexOf('cancels = slots.map'));
    assert.match(apart, /other\.el\.classList\.contains\('is-enabled'\)/, 'only slots that are shown count');
    assert.match(apart, /shown\.filter\(\(span\) => span\.bottom > span\.top\)/, 'a collapsed (unfilled) slot takes no room');
    assert.match(apart, /standsApart\(spanOf\(slot\.el\), [^;]+, window\.innerHeight\)/);
    assert.match(apart, /slot\.el\.classList\.remove\('is-waiting'\);\s*slot\.el\.dataset\.adSkipped = '1';[^\n]*\n\s*slot\.el\.hidden = true;/, 'too close: the slot is gone for this page view');
    assert.match(ads, /el\.dataset\.adFilled === '1' \|\| el\.dataset\.adSkipped === '1' \|\| el\.classList\.contains\('is-waiting'\)/, 'a second mountAds() wires no slot twice');
  });

  it('a waiting slot is in the page but takes no room, and holds no ad code yet', () => {
    assert.match(css, /\.ad-slot\.is-waiting\s*\{\s*display:\s*block;\s*height:\s*0;\s*margin:\s*0;\s*\}/);
    const show = mount.slice(mount.indexOf('const show ='), mount.indexOf('cancels = slots.map'));
    assert.ok(show.indexOf("classList.remove('is-waiting')") < show.indexOf('fillSlot('), 'the <ins> is only made when the slot opens');
  });

  it('top and side use the ad unit of the slot before them until they have one of their own', () => {
    assert.match(ads, /if \(name === 'top'\) return slots\.top \|\| slots\.article;/);
    assert.match(ads, /slots\.side \|\| slots\.top \|\| slots\.article/);
    const site = JSON.parse(read('../site.config.json'));
    assert.equal(typeof site.ads.slots.top, 'string');
    assert.equal(typeof site.ads.slots.side, 'string');
    assert.match(site.ads.slots.article, /^\d{8,}$/);
  });

  const SIDE = '<div class="ad-slot ad-slot--article ad-slot--side" data-ad-slot="side" aria-hidden="true"></div>';
  const ROW = `<div class="ad-row">\n      ${TOP}\n      ${SIDE}\n    </div>`;
  const pagesCss = read('../src/styles/pages.css');

  it('on a wide screen the ad row is a row of its own, not part of the sticky map column', () => {
    assert.match(pagesCss, /@media \(min-width: 1024px\) \{\s*\.entity-live > \.ad-row \{\s*grid-column: 1 \/ -1;\s*grid-row: 1;\s*\}\s*\}/);
    for (const name of ['road', 'place', 'bridge']) {
      assert.ok(template(name).includes(`Op de grote kaart</a>\n    </div>\n    ${ROW}`), `${name}: right after the map column closes`);
    }
  });

  it('the row holds two slots side by side, the second one only on a screen with two columns', () => {
    // One 1,100 px wide box mostly gets one rectangle with empty space beside it; two boxes are
    // two ads in the same row, at no extra height.
    for (const name of ['road', 'place', 'bridge']) assert.ok(template(name).includes(ROW), name);
    assert.match(ads, /const TWO_COLUMNS = '\(min-width: 1024px\)';/);
    assert.match(ads, /if \(name === 'side'\) return window\.matchMedia\(TWO_COLUMNS\)\.matches \? [^:]+ : '';/, 'no ad unit, so no ad request, on a narrow screen');
    assert.match(pagesCss, /@media \(max-width: 1023\.98px\) \{\s*\.ad-row > \.ad-slot--side \{\s*display: none;\s*\}\s*\}/, 'nor after the window was made narrower');
    assert.match(pagesCss, /\.ad-row:has\([^{]+\) \{\s*display: grid;\s*grid-auto-flow: column;\s*grid-auto-columns: minmax\(0, 1fr\);/, 'equal columns; one slot left takes the full width');
  });

  it('the row is gone when no slot in it shows or expects an ad: no empty grid row above the map', () => {
    assert.match(pagesCss, /\.ad-row \{\s*display: none;\s*\}/);
    assert.match(pagesCss, /\.ad-row:has\(> \.ad-slot\.is-enabled:not\(\[hidden\]\) > ins\.adsbygoogle:not\(\[data-ad-status='unfilled'\]\)\) \{/);
  });
});

describe('the AdSense script waits for the page', () => {
  it('ads.ts adds no script element itself; mountAds hands it to the deferred loader', () => {
    assert.doesNotMatch(ads, /createElement\('script'\)|document\.head\.appendChild/);
    assert.match(ads, /adScript = deferAdScript\(`\$\{ADSENSE_SRC\}\?client=\$\{encodeURIComponent\(client\)\}`\)/);
    assert.match(mount, /const script = loadAdsenseScript\(client\);/);
  });

  it('the pages with data hand their start-up to the boot, so the ads wait for the answer and the map', () => {
    for (const page of ['road', 'place', 'bridge', 'list']) {
      assert.match(read(`../src/pages/${page}.ts`), /^boot\.adsAfter\(main\(\)/m, page);
    }
  });

  it('a blocked script hides the slots it would have filled, the waiting ones included', () => {
    assert.match(mount, /script\?\.onFail\(retire\);/);
    assert.match(mount, /const retire = \(\): void => \{\s*retired = true;\s*cancels\.forEach\(\(cancel\) => cancel\(\)\);/);
    assert.match(mount, /if \(retired\) return;/, 'a slot that comes near afterwards stays shut');
  });

  it("an ad blocker's stand-in script that never takes the slot hides it too (ui/ad-fill.ts)", () => {
    assert.match(ads, /import \{ hideIfNotTaken, slotTaken \} from '\.\/ad-fill';/);
    assert.match(mount, /const ins = fillSlot\(slot\.el, slot\.name, client, slot\.slotId\);/);
    assert.match(mount, /if \(ins\) script\?\.onLoaded\(\(\) => hideIfNotTaken\(ins, retire\)\);/);
  });

  it('giving up never hides a slot that carries an ad', () => {
    assert.match(mount, /slots\.forEach\(\(\{ el \}\) => \{\s*if \(hasAd\(el\)\) return;\s*el\.dataset\.adSkipped = '1';\s*el\.hidden = true;\s*\}\);/);
    assert.match(ads, /function hasAd\(el: HTMLElement\): boolean \{\s*const ins = el\.querySelector\('ins\.adsbygoogle'\);\s*return ins !== null && slotTaken\(ins\);/);
  });

  it('the cookie link goes through ui/cmp.ts, which knows about the deferred script', () => {
    // On the map the script waits for the first opened melding; the link fetches it when the page may show ads.
    assert.match(
      ads,
      /export function openCmp\(onUnavailable\?: \(\) => void\): boolean \{\s*if \(!adScript && pageShowsAds\(\)\) loadAdsenseScript\(site\.ads\.adsenseClient\);\s*return openConsentDialog\(adScript, onUnavailable\);/,
    );
    assert.match(ads, /if \(!openCmp\(onUnavailable\)\) onUnavailable\(\);/);
  });
});
