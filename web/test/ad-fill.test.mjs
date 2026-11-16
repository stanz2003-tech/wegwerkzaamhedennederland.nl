/**
 * ui/ad-fill.ts: an ad blocker can swap the AdSense script for a stand-in that loads fine but
 * never takes a slot (uBlock Origin's adsbygoogle surrogate: `push` does nothing). Without this
 * check such a visitor kept an empty grey box with "Advertenties" above it. Real AdSense marks a
 * slot it has taken with `data-adsbygoogle-status` within ~200 ms, also while the consent dialog
 * is still open (measured on the live site, 16 Nov 2026), so a slot still unmarked a few seconds
 * after the script loaded will not be filled.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adFill } from './helpers/src.mjs';

const { slotTaken, hideIfNotTaken, TAKEN_CHECK_MS } = adFill;

/** An `<ins>` stand-in: only the attributes matter. */
function fakeIns(attrs = {}) {
  const map = new Map(Object.entries(attrs));
  return {
    hasAttribute: (name) => map.has(name),
    setAttribute: (name, value) => map.set(name, value),
  };
}

/** A setTimeout the test fires by hand. */
function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeout: (cb, ms) => timers.push({ cb, ms }),
    fireAll: () => timers.splice(0).forEach((t) => t.cb()),
  };
}

describe('slotTaken', () => {
  it('a slot AdSense has processed carries data-adsbygoogle-status', () => {
    assert.equal(slotTaken(fakeIns({ 'data-adsbygoogle-status': 'done' })), true);
  });

  it('a slot nobody processed (stand-in script) carries no status', () => {
    assert.equal(slotTaken(fakeIns()), false);
  });
});

describe('hideIfNotTaken', () => {
  it('hides the slot when the script never took it', () => {
    const t = fakeTimers();
    let hidden = 0;
    hideIfNotTaken(fakeIns(), () => hidden++, t.setTimeout);
    assert.equal(hidden, 0, 'nothing happens before the check');
    assert.equal(t.timers.length, 1);
    assert.equal(t.timers[0].ms, TAKEN_CHECK_MS);
    t.fireAll();
    assert.equal(hidden, 1);
  });

  it('keeps the slot when AdSense took it before the check, also without an ad yet (consent open)', () => {
    const t = fakeTimers();
    const ins = fakeIns();
    let hidden = 0;
    hideIfNotTaken(ins, () => hidden++, t.setTimeout);
    ins.setAttribute('data-adsbygoogle-status', 'done');
    t.fireAll();
    assert.equal(hidden, 0);
  });

  it('waits long enough for a slow phone, but not so long the empty box lingers', () => {
    assert.ok(TAKEN_CHECK_MS >= 2000 && TAKEN_CHECK_MS <= 5000, String(TAKEN_CHECK_MS));
  });
});
