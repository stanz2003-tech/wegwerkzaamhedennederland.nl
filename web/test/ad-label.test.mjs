/**
 * Ads must be recognisable as ads (Dutch Reclamecode) and AdSense only allows the labels
 * "Advertenties" or "Gesponsorde links". The label is added by ui/ads.ts when a slot is filled,
 * so it never shows while ads are switched off.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ads = read('../src/ui/ads.ts');
const css = read('../src/styles/components.css');

describe('ad label', () => {
  it('fillSlot puts a visible "Advertenties" label above the ad', () => {
    const fill = ads.slice(ads.indexOf('function fillSlot'), ads.indexOf('export function mountAds'));
    assert.match(fill, /AD_LABEL/);
    assert.match(ads, /const AD_LABEL = 'Advertenties';/);
    assert.ok(fill.indexOf('ad-slot__label') < fill.indexOf("createElement('ins')"), 'label must come before the ad');
  });

  it('the slot reserves room for the label so the page does not jump', () => {
    assert.match(ads, /SLOT_HEIGHT\[name\] \+ LABEL_HEIGHT/);
    assert.match(css, /\.ad-slot__label\s*\{[^}]*height:\s*var\(--ad-label-h\)/);
  });

  it('the label only exists in filled slots; disabled slots stay hidden', () => {
    assert.match(ads, /if \(!enabled\) \{\s*slots\.forEach\(\(el\) => \{\s*el\.hidden = true;/);
  });
});
