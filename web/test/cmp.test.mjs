/**
 * ui/cmp.ts: the footer link "Cookie-instellingen" keeps working now that the AdSense script (which
 * brings Google's consent dialog) loads only once the page is done. A tap before then queues the
 * request in googlefc.callbackQueue and fetches the script at once; a page without ads, a blocked
 * script, or a consent script that never comes still tells the reader that there are no ad
 * cookies to set, instead of doing nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adLoader, cmp } from './helpers/src.mjs';

/** A deferred script whose load, idle and outcome the test controls (see ad-loader.test.mjs). */
function pendingScript({ loaded = false } = {}) {
  const injected = [];
  const env = {
    loaded: () => loaded,
    onLoad: () => {},
    idle: () => {},
    setTimeout: () => {},
    inject: (src, onLoad, onError) => injected.push({ onLoad, onError }),
  };
  return { script: adLoader.deferAdScript('https://ads.example/adsbygoogle.js', env), injected };
}

/** Timers the test runs by hand. */
function fakeTimers() {
  const due = [];
  return {
    due,
    setTimeout: (cb, ms) => due.push({ cb, ms }),
    run: () => due.splice(0).forEach(({ cb }) => cb()),
  };
}

/** What Google's script does when it arrives: run what was queued, then run new pushes at once. */
function googleArrives(host, shown) {
  const queued = host.googlefc?.callbackQueue ?? [];
  host.googlefc = {
    callbackQueue: { push: (entry) => entry.CONSENT_DATA_READY?.() },
    showRevocationMessage: () => shown.push('dialog'),
  };
  for (const entry of queued) host.googlefc.callbackQueue.push(entry);
}

describe('the cookie link (ui/cmp.ts)', () => {
  it('says "no ad cookies" on a page without ads, and leaves window.googlefc alone', () => {
    const host = {};
    const open = cmp.createCmpOpener(host, fakeTimers());
    assert.equal(open(null, () => assert.fail('the caller shows the message')), false);
    assert.equal(host.googlefc, undefined);
  });

  it('a tap before the script arrived queues the dialog and fetches the script at once', () => {
    const host = {};
    const shown = [];
    const timers = fakeTimers();
    const { script, injected } = pendingScript();
    const open = cmp.createCmpOpener(host, timers);
    assert.equal(open(script, () => assert.fail('the dialog came')), true);
    assert.equal(injected.length, 1, 'no waiting for the page after a tap');
    assert.ok(Array.isArray(host.googlefc.callbackQueue), "Google's documented queue: a plain array");
    assert.equal(host.googlefc.callbackQueue.length, 1);
    injected[0].onLoad();
    googleArrives(host, shown);
    assert.deepEqual(shown, ['dialog']);
    timers.run();
  });

  it('two quick taps open the dialog once', () => {
    const host = {};
    const shown = [];
    const { script, injected } = pendingScript();
    const open = cmp.createCmpOpener(host, fakeTimers());
    open(script);
    open(script);
    assert.equal(host.googlefc.callbackQueue.length, 1);
    assert.equal(injected.length, 1);
    googleArrives(host, shown);
    assert.deepEqual(shown, ['dialog']);
    open(script);
    assert.deepEqual(shown, ['dialog', 'dialog'], 'a later tap opens it again');
  });

  it('a blocked script turns the pending tap into the "no ad cookies" message', () => {
    const host = {};
    const { script, injected } = pendingScript();
    const open = cmp.createCmpOpener(host, fakeTimers());
    const told = [];
    assert.equal(open(script, () => told.push('geen advertentiecookies')), true);
    injected[0].onError();
    assert.deepEqual(told, ['geen advertentiecookies']);
    assert.equal(open(script, () => told.push('again')), false, 'later taps: the caller shows the message itself');
    assert.deepEqual(told, ['geen advertentiecookies']);
  });

  it('the AdSense script loads but Google\'s consent script never comes: the link says so after the grace period', () => {
    const host = {};
    const timers = fakeTimers();
    const { script, injected } = pendingScript();
    const open = cmp.createCmpOpener(host, timers);
    const told = [];
    open(script, () => told.push('geen advertentiecookies'));
    assert.equal(timers.due.length, 0, 'the grace period starts when the AdSense script has loaded');
    injected[0].onLoad();
    assert.equal(timers.due.length, 1);
    assert.equal(timers.due[0].ms, cmp.CMP_GRACE_MS);
    assert.deepEqual(told, []);
    timers.run();
    assert.deepEqual(told, ['geen advertentiecookies']);
    assert.equal(host.googlefc.callbackQueue.length, 0, 'the unread request is taken back: no dialog popping up much later');
    open(script, () => told.push('again'));
    assert.equal(host.googlefc.callbackQueue.length, 1, 'a later tap asks again');
    timers.run();
    assert.deepEqual(told, ['geen advertentiecookies', 'again']);
  });

  it('Google takes the request but never answers: a later tap may ask again, without a false message', () => {
    const host = {};
    const timers = fakeTimers();
    const { script, injected } = pendingScript();
    const open = cmp.createCmpOpener(host, timers);
    const pushed = [];
    open(script, () => assert.fail('Google is there; there is just no answer'));
    injected[0].onLoad();
    const early = host.googlefc.callbackQueue;
    host.googlefc = { callbackQueue: { push: (entry) => pushed.push(entry) } };
    for (const entry of early) host.googlefc.callbackQueue.push(entry);
    open(script);
    assert.equal(pushed.length, 1, 'still waiting for the first request');
    timers.run();
    open(script);
    assert.equal(pushed.length, 2, 'after the grace period the latch opens');
  });

  it('once Google is on the page, a tap opens the dialog straight away', () => {
    const host = {};
    const shown = [];
    const { script, injected } = pendingScript({ loaded: true });
    script.now();
    injected[0].onLoad();
    googleArrives(host, shown);
    const open = cmp.createCmpOpener(host, fakeTimers());
    assert.equal(open(script), true);
    assert.deepEqual(shown, ['dialog']);
    assert.equal(injected.length, 1, 'the script is not added twice');
  });

  it('also works with an AdSense script that some other tag put on the page', () => {
    const host = {};
    const shown = [];
    googleArrives(host, shown);
    assert.equal(cmp.createCmpOpener(host, fakeTimers())(null), true);
    assert.deepEqual(shown, ['dialog']);
  });
});
