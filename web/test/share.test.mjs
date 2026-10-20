/**
 * The "Deel" button (web/src/ui/share.ts). On a phone it only copied the link with a small toast,
 * which Stan reported on 2026-10-20 as "er gebeurt niks". It now opens the system share sheet and
 * copies only where there is none.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { share } from './helpers/src.mjs';

const target = { url: 'https://www.wegwerkzaamhedennederland.nl/?id=NDW03_1', title: 'Nieuwe Dijk, Exloërveen' };

function fakeEnv({ share: shareImpl, canShare, writeText } = {}) {
  const calls = { shared: [], copied: [], toasts: [] };
  const env = {
    share: shareImpl && (async (data) => { calls.shared.push(data); return shareImpl(data); }),
    canShare,
    writeText: writeText && (async (text) => { calls.copied.push(text); return writeText(text); }),
    toast: (message, kind = 'info') => calls.toasts.push({ message, kind }),
  };
  return { env, calls };
}

const abort = () => Object.assign(new Error('Share canceled'), { name: 'AbortError' });

describe('Deel button', () => {
  it('opens the share sheet with the melding and its link when the phone has one', async () => {
    const { env, calls } = fakeEnv({ share: async () => {}, writeText: async () => {} });
    assert.equal(await share.shareLink(target, env), 'shared');
    assert.deepEqual(calls.shared, [{ title: 'Nieuwe Dijk, Exloërveen · Wegwerk', text: 'Nieuwe Dijk, Exloërveen', url: target.url }]);
    assert.deepEqual(calls.copied, []);
    assert.deepEqual(calls.toasts, []);
  });

  it('does nothing more when the visitor closes the share sheet', async () => {
    const { env, calls } = fakeEnv({ share: async () => { throw abort(); }, writeText: async () => {} });
    assert.equal(await share.shareLink(target, env), 'cancelled');
    assert.deepEqual(calls.copied, []);
    assert.deepEqual(calls.toasts, []);
  });

  it('copies the link with a clear toast when there is no share sheet (desktop)', async () => {
    const { env, calls } = fakeEnv({ writeText: async () => {} });
    assert.equal(await share.shareLink(target, env), 'copied');
    assert.deepEqual(calls.copied, [target.url]);
    assert.equal(calls.toasts.length, 1);
    assert.match(calls.toasts[0].message, /Link gekopieerd/);
  });

  it('falls back to copying when the share sheet refuses for another reason', async () => {
    const { env, calls } = fakeEnv({ share: async () => { throw new Error('NotAllowedError'); }, writeText: async () => {} });
    assert.equal(await share.shareLink(target, env), 'copied');
    assert.deepEqual(calls.copied, [target.url]);
  });

  it('copies instead when the browser says it cannot share this', async () => {
    const { env, calls } = fakeEnv({ share: async () => {}, canShare: () => false, writeText: async () => {} });
    assert.equal(await share.shareLink(target, env), 'copied');
    assert.deepEqual(calls.shared, []);
  });

  it('says so when neither sharing nor copying works', async () => {
    const { env, calls } = fakeEnv({ writeText: async () => { throw new Error('denied'); } });
    assert.equal(await share.shareLink(target, env), 'failed');
    assert.equal(calls.toasts[0].kind, 'error');
    const none = fakeEnv();
    assert.equal(await share.shareLink(target, none.env), 'failed');
  });

  it('shares a bare link under the site name when the melding has no title', () => {
    assert.deepEqual(share.shareData({ url: target.url, title: '  ' }), { title: 'Wegwerk', text: undefined, url: target.url });
  });
});
