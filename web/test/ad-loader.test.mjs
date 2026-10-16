/**
 * ui/ad-loader.ts: the AdSense script (and the ~300 KB ad stack behind it) loads after the
 * window `load` event and the page's own start-up, in the first idle moment, so it never
 * competes with the answer and the first taps (INP). The cookie link in the footer can still ask
 * for it at once.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adLoader } from './helpers/src.mjs';

const SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1';
/** Lets settled promises run their callbacks. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** An environment the test steps by hand: nothing happens until the test says so. */
function fakeEnv({ loaded = false, idle = true } = {}) {
  const env = {
    isLoaded: loaded,
    loadCbs: [],
    idleCbs: [],
    timers: [],
    injected: [],
    loaded: () => env.isLoaded,
    onLoad: (cb) => env.loadCbs.push(cb),
    idle: idle ? (cb, timeoutMs) => env.idleCbs.push({ cb, timeoutMs }) : null,
    setTimeout: (cb, ms) => env.timers.push({ cb, ms }),
    inject: (src, onLoad, onError) => env.injected.push({ src, onLoad, onError }),
    fireLoad: () => {
      env.isLoaded = true;
      env.loadCbs.splice(0).forEach((cb) => cb());
    },
    runIdle: () => env.idleCbs.splice(0).forEach(({ cb }) => cb()),
    runTimers: () => env.timers.splice(0).forEach(({ cb }) => cb()),
  };
  return env;
}

describe('the ad script waits for the page (ui/ad-loader.ts)', () => {
  it('injects nothing during the boot, only after load and then idle', () => {
    const env = fakeEnv();
    const script = adLoader.deferAdScript(SRC, env);
    assert.equal(script.state(), 'waiting');
    assert.equal(env.injected.length, 0, 'not during the page boot');
    assert.equal(env.idleCbs.length, 0, 'not even an idle callback before load');
    env.fireLoad();
    assert.equal(env.injected.length, 0, 'not inside the load event either');
    assert.equal(env.idleCbs.length, 1);
    assert.equal(env.idleCbs[0].timeoutMs, adLoader.IDLE_TIMEOUT_MS, 'a busy page still gets its ads');
    env.runIdle();
    assert.equal(env.injected.length, 1);
    assert.equal(env.injected[0].src, SRC);
    assert.equal(script.state(), 'loading');
    env.injected[0].onLoad();
    assert.equal(script.state(), 'loaded');
  });

  it('goes straight to the idle wait when the page has already loaded', () => {
    const env = fakeEnv({ loaded: true });
    adLoader.deferAdScript(SRC, env);
    assert.equal(env.loadCbs.length, 0);
    assert.equal(env.idleCbs.length, 1);
    assert.equal(env.injected.length, 0);
  });

  it('falls back to a timer after load where there is no requestIdleCallback (Safari)', () => {
    const env = fakeEnv({ idle: false });
    adLoader.deferAdScript(SRC, env);
    assert.equal(env.timers.length, 0, 'no timer before load');
    env.fireLoad();
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].ms, adLoader.NO_IDLE_DELAY_MS);
    assert.ok(adLoader.NO_IDLE_DELAY_MS > 0 && adLoader.NO_IDLE_DELAY_MS <= adLoader.IDLE_TIMEOUT_MS);
    env.runTimers();
    assert.equal(env.injected.length, 1);
  });

  it('now() loads at once (the cookie link), and the scheduled run adds nothing', () => {
    const env = fakeEnv();
    const script = adLoader.deferAdScript(SRC, env);
    script.now();
    assert.equal(env.injected.length, 1, 'before load, without waiting');
    assert.equal(script.state(), 'loading');
    script.now();
    env.fireLoad();
    env.runIdle();
    assert.equal(env.injected.length, 1, 'the script is added once per page');
  });

  it('reports a blocked script to everyone who waits, and to later askers at once', () => {
    const env = fakeEnv({ loaded: true });
    const script = adLoader.deferAdScript(SRC, env);
    const calls = [];
    script.onFail(() => calls.push('slots'));
    env.runIdle();
    script.onFail(() => calls.push('cookie link'));
    assert.deepEqual(calls, [], 'nothing failed yet');
    env.injected[0].onError();
    assert.equal(script.state(), 'failed');
    assert.deepEqual(calls, ['slots', 'cookie link']);
    script.onFail(() => calls.push('late'));
    assert.deepEqual(calls, ['slots', 'cookie link', 'late']);
    script.now();
    assert.equal(env.injected.length, 1, 'a failed script is not retried');
  });

  it('after load, waits for the page\'s own work (data, answer, map) before the idle wait', async () => {
    const env = fakeEnv();
    const script = adLoader.deferAdScript(SRC, env);
    let finishPage;
    script.holdUntil(new Promise((resolve) => (finishPage = resolve)));
    env.fireLoad();
    await flush();
    assert.equal(env.idleCbs.length, 0, 'load fires before the page has its data: keep waiting');
    finishPage();
    await flush();
    assert.equal(env.idleCbs.length, 1);
    env.runIdle();
    assert.equal(env.injected.length, 1);
    env.runTimers();
    env.runIdle();
    assert.equal(env.injected.length, 1, 'the cap timer that is left over adds nothing');
  });

  it('a page that hangs or fails holds the ads back at most HOLD_MAX_MS after load', async () => {
    const env = fakeEnv();
    const script = adLoader.deferAdScript(SRC, env);
    script.holdUntil(new Promise(() => {}));
    env.fireLoad();
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].ms, adLoader.HOLD_MAX_MS);
    env.runTimers();
    assert.equal(env.idleCbs.length, 1, 'released by the cap');

    const env2 = fakeEnv();
    const failing = adLoader.deferAdScript(SRC, env2);
    failing.holdUntil(Promise.reject(new Error('data niet geladen')));
    env2.fireLoad();
    await flush();
    assert.equal(env2.idleCbs.length, 1, 'a failed start-up releases the ads too');
  });

  it('a hold that comes after load no longer counts', async () => {
    const env = fakeEnv({ loaded: true });
    const script = adLoader.deferAdScript(SRC, env);
    script.holdUntil(new Promise(() => {}));
    await flush();
    assert.equal(env.idleCbs.length, 1);
  });

  it('never calls the failure callbacks once the script has loaded', () => {
    const env = fakeEnv({ loaded: true });
    const script = adLoader.deferAdScript(SRC, env);
    const calls = [];
    script.onFail(() => calls.push('before'));
    env.runIdle();
    env.injected[0].onLoad();
    script.onFail(() => calls.push('after'));
    assert.deepEqual(calls, []);
  });
});
