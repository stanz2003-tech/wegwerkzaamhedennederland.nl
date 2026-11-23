/**
 * ui/bottom-anchor.ts + ui/answer-bar.ts: Google's anchor ad (Auto ads, on since 23 Nov 2026,
 * bottom only) takes the bottom edge of a phone screen: measured on the live site, 375 × 812, it
 * is 139 px high and lies over the page's own answer bar ("Nu: … · Andere dag"), which is fixed to
 * the same edge. While the anchor is there the bar stands at the top of the screen instead: it
 * stays readable, and its button never sits against an ad (AdSense: no buttons next to ads).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bottomAnchor } from './helpers/src.mjs';

const { bottomCover, watchBottomAnchor, ANCHOR_SELECTOR } = bottomAnchor;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PHONE = 812;

describe('bottomCover: how much of the bottom edge the anchor takes', () => {
  it('the anchor as measured on the live site: 139 px', () => {
    assert.equal(bottomCover({ top: 673, bottom: 812, height: 139 }, PHONE), 139);
  });

  it('no anchor, or one that shows nothing, covers nothing', () => {
    assert.equal(bottomCover(null, PHONE), 0);
    assert.equal(bottomCover({ top: 812, bottom: 812, height: 0 }, PHONE), 0);
  });

  it('a collapsed anchor still counts for the sliver that is left', () => {
    assert.equal(bottomCover({ top: 787, bottom: 812, height: 25 }, PHONE), 25);
  });

  it('a few px short of the edge still counts (a phone toolbar sliding in or out)', () => {
    assert.equal(bottomCover({ top: 667, bottom: 806, height: 139 }, PHONE), 145);
    assert.equal(bottomCover({ top: 600, bottom: 739, height: 139 }, PHONE), 0, 'a box well above the edge is not on it');
  });

  it('an anchor Google put at the top of the screen leaves the bottom free', () => {
    assert.equal(bottomCover({ top: 0, bottom: 100, height: 100 }, PHONE), 0);
  });

  it('a box that slid out under the screen covers nothing', () => {
    assert.equal(bottomCover({ top: 812, bottom: 951, height: 139 }, PHONE), 0);
  });

  it('something that fills the screen is not an anchor', () => {
    assert.equal(bottomCover({ top: 0, bottom: 812, height: 812 }, PHONE), 0);
  });
});

describe('watchBottomAnchor: tells the page when the cover changes', () => {
  /** A page whose anchor box the test moves; `change()` is the browser reporting a change. */
  function fakeEnv(box = null) {
    const state = { box, listeners: [] };
    return {
      state,
      env: {
        anchorBox: () => state.box,
        viewportHeight: () => PHONE,
        onChange: (cb) => {
          state.listeners.push(cb);
        },
      },
      change: (next) => {
        state.box = next;
        state.listeners.forEach((cb) => cb());
      },
    };
  }

  it('reports nothing while there is no anchor', () => {
    const { env, change } = fakeEnv();
    const seen = [];
    watchBottomAnchor((px) => seen.push(px), env);
    change(null);
    assert.deepEqual(seen, []);
  });

  it('reports the anchor when it arrives, and again when the reader folds it away', () => {
    const { env, change } = fakeEnv();
    const seen = [];
    watchBottomAnchor((px) => seen.push(px), env);
    change({ top: 673, bottom: 812, height: 139 });
    change({ top: 673, bottom: 812, height: 139 }); // an unrelated change of the page
    change({ top: 787, bottom: 812, height: 25 });
    change(null);
    assert.deepEqual(seen, [139, 25, 0]);
  });

  it('an anchor that is there from the start is reported at once', () => {
    const { env } = fakeEnv({ top: 673, bottom: 812, height: 139 });
    const seen = [];
    watchBottomAnchor((px) => seen.push(px), env);
    assert.deepEqual(seen, [139]);
  });
});

describe('the answer bar gives way to the anchor', () => {
  const bar = read('../src/ui/answer-bar.ts');
  const css = read('../src/styles/answer-bar.css');

  it("the selector is Google's own mark on the anchor, not a guess at its class", () => {
    assert.equal(ANCHOR_SELECTOR, 'ins.adsbygoogle[data-anchor-status]');
  });

  it('with an anchor at the bottom the bar stands at the top', () => {
    assert.match(bar, /watchBottomAnchor\(\(px\) => \{\s*anchorPx = px;\s*apply\(\);\s*\}\);/);
    assert.match(bar, /const atTop = show && anchorPx > 0;/);
    assert.match(bar, /bar\.classList\.toggle\('answer-bar--top', atTop\);/);
    assert.match(css, /\.answer-bar--top\s*\{[^}]*inset:\s*0 0 auto 0;/);
  });

  it('the button stays on the screen on a page without a road badge (place pages)', () => {
    // Measured 23 Nov 2026 on /gemeente/s-hertogenbosch/ at 375 px: the button ran from 351 to 385 px.
    /** The declarations of the first rule whose selector is exactly `sel`. */
    const rule = (sel) => css.split('}').map((r) => r.split('{')).find(([s]) => s.replace(/\/\*[^]*?\*\//g, '').trim() === sel)?.[1] ?? '';
    assert.match(rule('.answer-bar'), /display:\s*flex;/);
    assert.doesNotMatch(rule('.answer-bar'), /grid-template-columns/);
    assert.match(rule('.answer-bar__text'), /flex:\s*1 1 0;[^]*min-width:\s*0;/);
    assert.match(rule('.answer-bar__btn'), /flex:\s*none;/);
  });

  it('a link to a heading does not land under the bar at the top', () => {
    assert.match(css, /html:has\(\.answer-bar--top:not\(\[hidden\]\)\)\s*\{\s*scroll-padding-top:/);
  });

  it('the page keeps room under its last content only while the bar is at the bottom', () => {
    assert.match(bar, /document\.body\.classList\.toggle\('has-answer-bar', show && !atTop\);/);
  });
});
