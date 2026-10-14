/**
 * Tap targets on a phone: the mobile review (2026-10-14) measured "Toon meer", the road badges
 * under a road page, the A-Z letters and the floating "Uitleg en alle wegen" at 40 px, below the
 * --touch token (44 px) the rest of the site keeps to. The topbar keeps clear of a landscape
 * notch on both sides.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const css = (name) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8');
const rule = (source, selector) => {
  const i = source.indexOf(`${selector} {`);
  assert.ok(i >= 0, selector);
  return source.slice(i, source.indexOf('}', i));
};

describe('tap targets on a touch screen', () => {
  it('the --touch token is 44 px', () => {
    assert.match(css('tokens.css'), /--touch:\s*44px/);
  });

  it('every button is a --touch target under a coarse pointer', () => {
    const src = css('components.css');
    const block = src.slice(src.indexOf('@media (pointer: coarse)'));
    assert.match(rule(block, '.btn'), /min-height:\s*var\(--touch\)/);
  });

  it('road badges, A-Z letters and the Uitleg pill are --touch targets', () => {
    assert.match(rule(css('pages.css'), '.page .chips .badge'), /min-height:\s*var\(--touch\)/);
    const letter = rule(css('pages.css'), '.letter-nav a');
    assert.match(letter, /min-height:\s*var\(--touch\)/);
    assert.match(letter, /min-width:\s*var\(--touch\)/);
    assert.match(rule(css('map.css'), '.map .map__uitleg'), /min-height:\s*var\(--touch\)/);
  });

  it('the topbar pads both safe-area sides', () => {
    const bar = rule(css('chrome.css'), '.topbar');
    assert.match(bar, /env\(safe-area-inset-left\)/);
    assert.match(bar, /env\(safe-area-inset-right\)/);
  });
});
