/**
 * ui/cmp.ts: the footer link "Cookie-instellingen" keeps working now that the AdSense script (which
 * brings Google's consent dialog) loads only once the page is done. A tap before then queues the
 * request in googlefc.callbackQueue and fetches the script at once; a page without ads, or with a
 * blocked script, still tells the reader that there are no ad cookies to set.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adLoader, cmp } from './helpers/src.mjs';

/** A deferred script whose load, idle and outcome the test controls (see ad-loader.test.mjs). */
function pendingScript({ loaded = false } = {}) {
  const injected = [];
  const loadCbs = [];
  const env = {
    loaded: () => loaded,
    onLoad: (cb) => loadCbs.push(cb),
    idle: () => {},
    setTimeout: () => {},
    inject: (src, onLoad, onError) => injected.push({ onLoad, onError }),
  };
  return { script: adLoader.deferAdScript('https://ads.example/adsbygoogle.js', env), injected };
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
    const open = cmp.createCmpOpener(host);
    assert.equal(open(null, () => assert.fail('the caller shows the message')), false);
    assert.equal(host.googlefc, undefined);
  });

  it('a tap before the script arrived queues the dialog and fetches the script at once', () => {
    const host = {};
    const shown = [];
    const { script, injected } = pendingScript();
    const open = cmp.createCmpOpener(host);
    assert.equal(open(script), true);
    assert.equal(injected.length, 1, 'no waiting for the page after a tap');
    assert.ok(Array.isArray(host.googlefc.callbackQueue), "Google's documented queue: a plain array");
    assert.equal(host.googlefc.callbackQueue.length, 1);
    injected[0].onLoad();
    googleArrives(host, shown);
    assert.deepEqual(shown, ['dialog']);
  });

  it('two quick taps open the dialog once', () => {
    const host = {};
    const shown = [];
    const { script, injected } = pendingScript();
    const open = cmp.createCmpOpener(host);
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
    const open = cmp.createCmpOpener(host);
    const told = [];
    assert.equal(open(script, () => told.push('geen advertentiecookies')), true);
    injected[0].onError();
    assert.deepEqual(told, ['geen advertentiecookies']);
    assert.equal(open(script, () => told.push('again')), false, 'later taps: the caller shows the message itself');
    assert.deepEqual(told, ['geen advertentiecookies']);
  });

  it('once Google is on the page, a tap opens the dialog straight away', () => {
    const host = {};
    const shown = [];
    const { script, injected } = pendingScript({ loaded: true });
    script.now();
    injected[0].onLoad();
    googleArrives(host, shown);
    const open = cmp.createCmpOpener(host);
    assert.equal(open(script), true);
    assert.deepEqual(shown, ['dialog']);
    assert.equal(injected.length, 1, 'the script is not added twice');
  });

  it('also works with an AdSense script that some other tag put on the page', () => {
    const host = {};
    const shown = [];
    googleArrives(host, shown);
    assert.equal(cmp.createCmpOpener(host)(null), true);
    assert.deepEqual(shown, ['dialog']);
  });
});
