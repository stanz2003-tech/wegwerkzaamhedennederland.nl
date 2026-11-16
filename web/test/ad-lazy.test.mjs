/**
 * ui/ad-lazy.ts: a slot far down the page asks for its ad only when the reader comes near. On
 * 16 Nov 2026 the single slot sat 4 to 12 phone screens deep and AdSense measured 10% of its ads
 * as seen; an ad nobody scrolls to costs page weight and earns next to nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adLazy } from './helpers/src.mjs';

const { whenNear, standsApart, NEAR_MARGIN } = adLazy;

describe('standsApart: never two ads on one screen', () => {
  const SCREEN = 812;

  it('a slot a full screen below the ad above it may open', () => {
    assert.equal(standsApart({ top: 3933, bottom: 3933 }, [{ top: 1455, bottom: 1755 }], SCREEN), true);
  });

  it('a slot close under another ad stays shut (Merwedebrug page: 244 px apart)', () => {
    assert.equal(standsApart({ top: 2446, bottom: 2446 }, [{ top: 1902, bottom: 2202 }], SCREEN), false);
  });

  it('exactly one screen apart is enough', () => {
    assert.equal(standsApart({ top: 1000 + SCREEN, bottom: 1000 + SCREEN }, [{ top: 700, bottom: 1000 }], SCREEN), true);
    assert.equal(standsApart({ top: 999 + SCREEN, bottom: 999 + SCREEN }, [{ top: 700, bottom: 1000 }], SCREEN), false);
  });

  it('an ad below counts as well (the reader scrolled up from the end)', () => {
    assert.equal(standsApart({ top: 1000, bottom: 1000 }, [{ top: 1500, bottom: 1800 }], SCREEN), false);
    assert.equal(standsApart({ top: 1000, bottom: 1000 }, [{ top: 2000, bottom: 2300 }], SCREEN), true);
  });

  it('every other ad must be far enough, and a page without other ads always has room', () => {
    const far = { top: 0, bottom: 300 };
    const near = { top: 4200, bottom: 4500 };
    assert.equal(standsApart({ top: 4000, bottom: 4000 }, [far, near], SCREEN), false);
    assert.equal(standsApart({ top: 4000, bottom: 4000 }, [], SCREEN), true);
  });
});

/** An IntersectionObserver the test drives by hand. */
function fakeEnv() {
  const env = {
    watched: [],
    stopped: 0,
    observe: (el, margin, onNear) => {
      const entry = { el, margin, onNear };
      env.watched.push(entry);
      return () => {
        env.stopped += 1;
      };
    },
  };
  return env;
}

describe('whenNear', () => {
  it('does nothing until the slot comes near the screen', () => {
    const env = fakeEnv();
    let calls = 0;
    whenNear({}, () => (calls += 1), env);
    assert.equal(calls, 0);
    assert.equal(env.watched.length, 1);
    assert.equal(env.watched[0].margin, NEAR_MARGIN);
  });

  it('runs once when the slot comes near, and stops watching', () => {
    const env = fakeEnv();
    let calls = 0;
    whenNear({}, () => (calls += 1), env);
    env.watched[0].onNear();
    env.watched[0].onNear();
    assert.equal(calls, 1, 'a second sighting asks for no second ad');
    assert.equal(env.stopped, 1);
  });

  it('the returned cancel stops the watch and the callback never runs', () => {
    const env = fakeEnv();
    let calls = 0;
    const cancel = whenNear({}, () => (calls += 1), env);
    cancel();
    env.watched[0].onNear();
    assert.equal(calls, 0);
    assert.equal(env.stopped, 1);
    cancel();
    assert.equal(env.stopped, 1, 'cancelling twice is harmless');
  });

  it('a browser without IntersectionObserver shows the slot at once, as before', () => {
    let calls = 0;
    const cancel = whenNear({}, () => (calls += 1), { observe: null });
    assert.equal(calls, 1);
    cancel();
  });

  it('starts about one screen ahead, so the ad is there when the reader arrives', () => {
    // top right bottom left: only below the screen. A slot above it would open over the reader's head.
    assert.equal(NEAR_MARGIN, '0px 0px 100% 0px');
  });
});
