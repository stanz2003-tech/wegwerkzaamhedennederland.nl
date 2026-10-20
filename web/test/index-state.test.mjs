/**
 * Noindex with a memory (scripts/lib/index-state.mjs): a page leaves Google only after 60 days
 * without anything to show, comes back at once, and protected pages never leave.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_INDEX_ROWS, buildActivity } from '../scripts/lib/activity.mjs';
import { NOINDEX_AFTER_DAYS, daysBetween, decideThin, loadIndexState, parseIndexState, serializeIndexState } from '../scripts/lib/index-state.mjs';
import { buildModel } from '../scripts/lib/pages.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};

const page = (path) => ({ path });
const TODAY = '2026-10-20';

function decide({ inactive = [], previous = null, alwaysIndex = [] }, paths) {
  return decideThin({
    candidates: paths.map(page),
    inactiveToday: (p) => inactive.includes(p.path),
    previous: previous ? new Map(Object.entries(previous)) : null,
    today: TODAY,
    alwaysIndex: new Set(alwaysIndex),
  });
}

describe('decideThin', () => {
  it('a page with activity today is indexable and remembered as active today', () => {
    const { thin, lastActive } = decide({}, ['/plaats/a/']);
    assert.equal(thin.size, 0);
    assert.equal(lastActive.get('/plaats/a/'), TODAY);
  });

  it(`stays indexable for ${NOINDEX_AFTER_DAYS} days without activity, then leaves`, () => {
    const previous = { '/plaats/recent/': '2026-08-21', '/plaats/oud/': '2026-08-20' };
    assert.equal(daysBetween('2026-08-21', TODAY), NOINDEX_AFTER_DAYS);
    const { thin, lastActive } = decide({ inactive: ['/plaats/recent/', '/plaats/oud/'], previous }, ['/plaats/recent/', '/plaats/oud/']);
    assert.deepEqual([...thin], ['/plaats/oud/']);
    assert.equal(lastActive.get('/plaats/recent/'), '2026-08-21', 'the last active day is kept, not moved to today');
  });

  it('comes back the first day it has something again', () => {
    const { thin } = decide({ previous: { '/plaats/a/': '2025-01-01' } }, ['/plaats/a/']);
    assert.equal(thin.size, 0);
  });

  it('without a memory (first run, failed fetch) an inactive page is thin, as before', () => {
    const { thin, lastActive } = decide({ inactive: ['/plaats/a/'] }, ['/plaats/a/']);
    assert.deepEqual([...thin], ['/plaats/a/']);
    assert.equal(lastActive.has('/plaats/a/'), false);
  });

  it('never makes a protected page thin', () => {
    const { thin } = decide({ inactive: ['/plaats/lexmond/'], alwaysIndex: ['/plaats/lexmond/'] }, ['/plaats/lexmond/']);
    assert.equal(thin.size, 0);
  });
});

describe('the state file', () => {
  it('round-trips and drops malformed entries', () => {
    const json = JSON.parse(serializeIndexState(new Map([['/b/', '2026-10-01'], ['/a/', '2026-10-02']]), '2026-10-20T04:41:00Z'));
    assert.deepEqual(Object.keys(json.lastActive), ['/a/', '/b/']);
    assert.deepEqual(parseIndexState(json), new Map([['/a/', '2026-10-02'], ['/b/', '2026-10-01']]));
    assert.deepEqual(parseIndexState({ v: 1, lastActive: { '/a/': 'gisteren', x: '2026-10-01', '/b/': '2026-10-01' } }), new Map([['/b/', '2026-10-01']]));
    assert.equal(parseIndexState({ v: 2, lastActive: {} }), null);
    assert.equal(parseIndexState(null), null);
  });

  it('is read from the live site, past the edge cache', async () => {
    const urls = [];
    const ok = await loadIndexState({
      siteUrl: 'https://www.example.nl/',
      fetchImpl: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => ({ v: 1, lastActive: { '/a/': '2026-10-01' } }) };
      },
      warn: quiet,
    });
    assert.ok(urls[0].startsWith('https://www.example.nl/index-state.json?t='), urls[0]);
    assert.equal(ok.status, 'ok');
    assert.equal(ok.state.get('/a/'), '2026-10-01');
  });

  it('a 404 is the first run ("missing"); anything else, after three tries, is "failed"', async () => {
    const missing = await loadIndexState({ siteUrl: 'https://www.example.nl', fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }), warn: quiet });
    assert.deepEqual(missing, { status: 'missing', state: null });

    for (const fetchImpl of [
      async () => ({ ok: false, status: 503, json: async () => ({}) }),
      async () => ({ ok: true, status: 200, json: async () => ({ v: 9 }) }),
      async () => {
        throw new Error('netwerk');
      },
    ]) {
      let calls = 0;
      const warnings = [];
      const counted = async (...a) => {
        calls++;
        return fetchImpl(...a);
      };
      const result = await loadIndexState({ siteUrl: 'https://www.example.nl', fetchImpl: counted, warn: (m) => warnings.push(m), retryDelayMs: 0 });
      assert.deepEqual(result, { status: 'failed', state: null });
      assert.equal(calls, 3);
      assert.equal(warnings.length, 1);
    }
  });

  it('a hiccup on the second try still reads the memory', async () => {
    let calls = 0;
    const result = await loadIndexState({
      siteUrl: 'https://www.example.nl',
      fetchImpl: async () => (++calls === 1 ? { ok: false, status: 502, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ v: 1, lastActive: {} }) }),
      warn: quiet,
      retryDelayMs: 0,
    });
    assert.equal(result.status, 'ok');
  });
});

describe('buildModel with a memory', () => {
  function row(gemeente, woonplaats = null) {
    return ['x', 'werk', null, 1, 't', null, null, gemeente, woonplaats, null, '2026-10-16T08:00:00Z', null, 5, 52, 0, null, 1, 'hinder', null, 0, null, null];
  }
  const model0 = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
  const filler = Array.from({ length: MIN_INDEX_ROWS }, () => row('Vulgemeente', 'Vulplaats'));
  const everyGemeente = model0.lists.gemeenten.map((g) => row(g.naam));
  const activity = buildActivity({ index: { generated: 'x', rows: [...filler, ...everyGemeente] }, bridges: null }, { warn: quiet });
  const lexmond = model0.pages.find((p) => p.path === '/plaats/lexmond/');
  const other = model0.pages.find((p) => p.kind === 'woonplaats' && p.path !== '/plaats/lexmond/');

  it('keeps a recently active woonplaats indexed and protects /plaats/lexmond/ (site.config.json)', () => {
    assert.ok(lexmond, 'Lexmond has a page');
    const indexState = new Map([[other.path, '2026-10-01']]);
    const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, activity, indexState, now: new Date('2026-10-20T04:41:00Z'), warn: quiet });
    assert.equal(model.byPath.get(other.path).thin, undefined);
    assert.equal(model.byPath.get('/plaats/lexmond/').thin, undefined);
    assert.equal(model.lastActive.get(other.path), '2026-10-01');
    assert.ok(model.counts.thin > 0, 'woonplaatsen without memory or activity still leave');
  });

  it('makes nothing thin when the memory exists but could not be read', () => {
    const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, activity, indexState: null, indexStateFailed: true, warn: quiet });
    assert.equal(model.counts.thin, 0);
    assert.ok(model.lastActive.size > 0, "today's active pages are still remembered");
  });

  it('carries the memory over unchanged when there is no data', () => {
    const indexState = new Map([[other.path, '2026-10-01']]);
    const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, activity: null, indexState, warn: quiet });
    assert.equal(model.counts.thin, 0);
    assert.equal(model.lastActive, indexState);
  });
});
