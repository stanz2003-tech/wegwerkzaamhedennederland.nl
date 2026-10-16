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

  it('a blocked script hides the slots it would have filled', () => {
    assert.match(mount, /script\?\.onFail\(\(\) => \{\s*el\.hidden = true;\s*\}\);/);
  });

  it('the cookie link goes through ui/cmp.ts, which knows about the deferred script', () => {
    assert.match(ads, /export function openCmp\(onUnavailable\?: \(\) => void\): boolean \{\s*return openConsentDialog\(adScript, onUnavailable\);/);
    assert.match(ads, /if \(!openCmp\(onUnavailable\)\) onUnavailable\(\);/);
  });
});
