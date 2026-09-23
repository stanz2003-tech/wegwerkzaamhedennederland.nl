/**
 * data/version.ts: the site reloads once when the data is newer than the code, and the version it
 * knows is the one the pipeline writes.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DATA_VERSION } from '../../pipeline/src/output.js';
import { version } from './helpers/src.mjs';

const { SUPPORTED_DATA_VERSION, isNewerThanSupported, reloadIfDataNewer } = version;

/** A minimal window with sessionStorage and a counting reload. */
function fakeWindow({ storageThrows = false } = {}) {
  const store = new Map();
  const win = {
    reloads: 0,
    location: { reload: () => (win.reloads += 1) },
    sessionStorage: {
      getItem: (k) => {
        if (storageThrows) throw new Error('blocked');
        return store.has(k) ? store.get(k) : null;
      },
      setItem: (k, v) => {
        if (storageThrows) throw new Error('blocked');
        store.set(k, String(v));
      },
    },
  };
  return win;
}

describe('data version', () => {
  afterEach(() => {
    delete globalThis.window;
  });

  it('the site knows the version the pipeline writes', () => {
    assert.equal(String(SUPPORTED_DATA_VERSION), DATA_VERSION);
  });

  it('only a higher, parsable version counts as newer', () => {
    assert.equal(isNewerThanSupported(String(SUPPORTED_DATA_VERSION + 1)), true);
    assert.equal(isNewerThanSupported(String(SUPPORTED_DATA_VERSION)), false);
    assert.equal(isNewerThanSupported('3'), false);
    assert.equal(isNewerThanSupported('abc'), false);
    assert.equal(isNewerThanSupported(undefined), false);
  });

  it('reloads once per newer version, never in a loop', () => {
    const win = fakeWindow();
    globalThis.window = win;
    const newer = { version: String(SUPPORTED_DATA_VERSION + 1) };
    assert.equal(reloadIfDataNewer(newer), true);
    assert.equal(reloadIfDataNewer(newer), false, 'the stale HTML came back: no second reload');
    assert.equal(win.reloads, 1);
    assert.equal(reloadIfDataNewer({ version: String(SUPPORTED_DATA_VERSION) }), false);
  });

  it('does nothing without a browser, and nothing when storage is blocked', () => {
    assert.equal(reloadIfDataNewer({ version: String(SUPPORTED_DATA_VERSION + 1) }), false);
    const win = fakeWindow({ storageThrows: true });
    globalThis.window = win;
    assert.equal(reloadIfDataNewer({ version: String(SUPPORTED_DATA_VERSION + 1) }), false);
    assert.equal(win.reloads, 0);
  });
});
