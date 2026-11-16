/**
 * scripts/lib/in-article-ad.mjs: a long text page gets one ad between two sections, about a
 * screen of reading down, instead of only the slot under the last line (which few readers reach).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IN_ARTICLE_SLOT, MIN_TEXT_AFTER, MIN_TEXT_BEFORE, withInArticleAd } from '../scripts/lib/in-article-ad.mjs';

const section = (title, chars) => `<h2 id="${title}">${title}</h2>\n<p>${'x'.repeat(chars)}</p>\n`;

describe('withInArticleAd', () => {
  it('puts the slot before the first heading that has a screen of text above it', () => {
    const html = section('een', 700) + section('twee', 700) + section('drie', 900) + section('vier', 900);
    const out = withInArticleAd(html);
    assert.equal(out.split(IN_ARTICLE_SLOT).length, 2, 'exactly one slot');
    assert.ok(out.indexOf(IN_ARTICLE_SLOT) < out.indexOf('<h2 id="drie">'));
    assert.ok(out.indexOf(IN_ARTICLE_SLOT) > out.indexOf('<h2 id="twee">'));
    assert.match(out, new RegExp(`</p>\\n${IN_ARTICLE_SLOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n<h2 id="drie">`));
  });

  it('never splits a section: the slot only goes right before an <h2>', () => {
    const html = `<p>${'x'.repeat(5000)}</p>` + section('enige', 3000);
    const out = withInArticleAd(html);
    assert.ok(out.includes(`${IN_ARTICLE_SLOT}\n<h2 id="enige">`));
  });

  it('leaves a short page alone', () => {
    const html = section('een', 300) + section('twee', 300);
    assert.equal(withInArticleAd(html), html);
  });

  it('leaves the page alone when the only fitting spot is at the end, where the bottom slot already is', () => {
    const html = section('een', MIN_TEXT_BEFORE + 100) + section('twee', MIN_TEXT_AFTER - 200);
    assert.equal(withInArticleAd(html), html);
  });

  it('counts text, not markup', () => {
    const link = '<a href="/uitleg/meldingen-lezen/" class="x" title="y">z</a>';
    const html = `<p>${link.repeat(60)}</p>` + section('een', 2000);
    assert.equal(withInArticleAd(html), html, '60 characters of text above the heading is no screen of reading');
  });

  it('the slot is the top slot of ui/ads.ts, hidden until that script fills it', () => {
    assert.equal(IN_ARTICLE_SLOT, '<div class="ad-slot ad-slot--article" data-ad-slot="top" aria-hidden="true"></div>');
  });
});
