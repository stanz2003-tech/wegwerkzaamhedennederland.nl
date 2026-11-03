/**
 * An honest <lastmod> per page (scripts/lib/lastmod.mjs): the day the page's content last
 * changed, remembered between deploys in /index-state.json, instead of the build day on all
 * 2,578 URLs (which told Google nothing, so it learns to ignore the field).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '../scripts/gen-pages.mjs';
import { MIN_INDEX_ROWS, buildActivity } from '../scripts/lib/activity.mjs';
import { loadIndexState, serializeIndexState } from '../scripts/lib/index-state.mjs';
import { decideLastmod, fingerprint, itemsFingerprint, pageFingerprint, parseLastmodMemory } from '../scripts/lib/lastmod.mjs';
import { buildModel } from '../scripts/lib/pages.mjs';
import { buildSitemaps } from '../scripts/lib/sitemap.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};
/** An IndexRow (web/src/data/types.ts) with only the fields activity.mjs reads filled in. */
const row = (gemeente, woonplaats = null) => ['x', 'werk', null, 1, 't', null, null, gemeente, woonplaats, null, '2026-10-16T08:00:00Z', null, 5, 52, 0, null, 1, 'hinder', null, 0, null, null];
const TODAY = '2026-11-03';
const NOW = Date.parse('2026-11-03T04:41:00Z');

/** An entity-file item as the snapshot sees it: `{ f: feature, d: detail }`. */
function item(props) {
  return {
    f: { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 52] }, properties: { cat: 'werk', sev: 1, title: 'Teststraat', start: '2026-11-10T06:00:00Z', end: '2026-11-20T16:00:00Z', imp: 'hinder', src: 'Gemeente', ...props } },
    d: null,
  };
}

describe('itemsFingerprint', () => {
  const a = item({ id: 'A' });
  const b = item({ id: 'B', title: 'Dorpsstraat' });

  it('is the same for the same roadworks, in any order', () => {
    assert.equal(itemsFingerprint([a, b], NOW), itemsFingerprint([b, a], NOW));
  });

  it('ignores traffic jams and incidents, which come and go within the hour', () => {
    const jam = item({ id: 'F', cat: 'file', start: '2026-11-03T04:00:00Z', end: undefined });
    const crash = item({ id: 'I', cat: 'incident', start: '2026-11-03T04:10:00Z', end: undefined });
    assert.equal(itemsFingerprint([a, jam, crash], NOW), itemsFingerprint([a], NOW));
  });

  it('changes when a roadwork is added, removed or rescheduled', () => {
    const base = itemsFingerprint([a], NOW);
    assert.notEqual(itemsFingerprint([a, b], NOW), base);
    assert.notEqual(itemsFingerprint([], NOW), base);
    assert.notEqual(itemsFingerprint([item({ id: 'A', end: '2026-11-21T16:00:00Z' })], NOW), base);
    assert.notEqual(itemsFingerprint([item({ id: 'A', closed: true })], NOW), base);
  });

  it('changes when a roadwork starts or ends: the page then answers differently', () => {
    const before = itemsFingerprint([a], Date.parse('2026-11-09T12:00:00Z'));
    const during = itemsFingerprint([a], Date.parse('2026-11-10T12:00:00Z'));
    const after = itemsFingerprint([a], Date.parse('2026-11-21T12:00:00Z'));
    assert.notEqual(before, during);
    assert.notEqual(during, after);
    assert.equal(before, itemsFingerprint([a], Date.parse('2026-11-08T12:00:00Z')), 'days passing alone change nothing');
  });

  it('an empty page has a fingerprint too: "nothing" is content that can change', () => {
    assert.equal(typeof itemsFingerprint([], NOW), 'string');
  });
});

describe('decideLastmod', () => {
  const previous = new Map([
    ['/weg/a2/', { h: 'h-a2', d: '2026-10-20' }],
    ['/weg/a12/', { h: 'h-a12-oud', d: '2026-10-20' }],
    ['/gemeente/x/', { h: 'h-x', d: '2026-10-25' }],
  ]);

  it('keeps the old day while the content is the same, and moves to today when it changed', () => {
    const { lastmod, memory } = decideLastmod({
      fingerprints: new Map([['/weg/a2/', 'h-a2'], ['/weg/a12/', 'h-a12-nieuw']]),
      previous,
      today: TODAY,
    });
    assert.equal(lastmod.get('/weg/a2/'), '2026-10-20');
    assert.equal(lastmod.get('/weg/a12/'), TODAY);
    assert.deepEqual(memory.get('/weg/a12/'), { h: 'h-a12-nieuw', d: TODAY });
  });

  it('a page seen for the first time, or a build without memory, says today', () => {
    const fresh = decideLastmod({ fingerprints: new Map([['/weg/n57/', 'h']]), previous, today: TODAY });
    assert.equal(fresh.lastmod.get('/weg/n57/'), TODAY);
    const noMemory = decideLastmod({ fingerprints: new Map([['/weg/a2/', 'h-a2']]), previous: null, today: TODAY });
    assert.equal(noMemory.lastmod.get('/weg/a2/'), TODAY);
  });

  it('without data for a page (null) it keeps what it knew: an outage is no change', () => {
    const { lastmod, memory } = decideLastmod({ fingerprints: new Map([['/gemeente/x/', null], ['/gemeente/nieuw/', null]]), previous, today: TODAY });
    assert.equal(lastmod.get('/gemeente/x/'), '2026-10-25');
    assert.deepEqual(memory.get('/gemeente/x/'), { h: 'h-x', d: '2026-10-25' });
    assert.equal(lastmod.get('/gemeente/nieuw/'), TODAY);
    assert.equal(memory.has('/gemeente/nieuw/'), false, 'nothing to remember without a fingerprint');
  });

  it('never claims a day after today (a clock that ran ahead once)', () => {
    const ahead = new Map([['/weg/a2/', { h: 'h-a2', d: '2026-12-01' }]]);
    assert.equal(decideLastmod({ fingerprints: new Map([['/weg/a2/', 'h-a2']]), previous: ahead, today: TODAY }).lastmod.get('/weg/a2/'), TODAY);
  });
});

describe('the memory in /index-state.json', () => {
  it('round-trips next to lastActive, and an older file without it reads as no memory', () => {
    const memory = new Map([['/weg/a2/', { h: fingerprint('x'), d: '2026-10-20' }]]);
    const json = JSON.parse(serializeIndexState(new Map([['/plaats/a/', '2026-11-01']]), '2026-11-03T04:41:00Z', memory));
    assert.deepEqual(json.lastActive, { '/plaats/a/': '2026-11-01' });
    assert.deepEqual(parseLastmodMemory(json), memory);
    assert.equal(parseLastmodMemory({ v: 1, lastActive: {} }), null);
  });

  it('drops malformed entries', () => {
    const parsed = parseLastmodMemory({ v: 1, lastActive: {}, lastmod: { '/a/': ['h', '2026-10-01'], '/b/': ['h', 'gisteren'], c: ['h', '2026-10-01'], '/d/': 'h' } });
    assert.deepEqual([...parsed.keys()], ['/a/']);
  });

  it('is read together with the noindex memory from the live site', async () => {
    const body = { v: 1, generated: 'x', lastActive: {}, lastmod: { '/weg/a2/': ['h', '2026-10-20'] } };
    const fetchImpl = async () => new Response(JSON.stringify(body), { status: 200 });
    const { status, lastmod } = await loadIndexState({ siteUrl: 'https://example.nl', fetchImpl, warn: quiet, retryDelayMs: 0 });
    assert.equal(status, 'ok');
    assert.deepEqual(lastmod.get('/weg/a2/'), { h: 'h', d: '2026-10-20' });
  });
});

describe('the sitemap', () => {
  it('writes each entry its own <lastmod>, the build day only as fallback', () => {
    const [file] = buildSitemaps(
      [{ path: '/weg/a2/', lastmod: '2026-10-20' }, { path: '/' }],
      { siteUrl: 'https://example.nl', lastmod: TODAY },
    );
    assert.match(file.xml, /<loc>https:\/\/example\.nl\/weg\/a2\/<\/loc><lastmod>2026-10-20<\/lastmod>/);
    assert.match(file.xml, /<loc>https:\/\/example\.nl\/<\/loc><lastmod>2026-11-03<\/lastmod>/);
  });

  it('generate() dates unchanged pages back, changed and live pages today, and publishes the memory', () => {
    const out = mkdtempSync(join(tmpdir(), 'wegwerk-lastmod-'));
    try {
      const lastmodState = new Map([
        ['/weg/a2/', { h: 'zelfde', d: '2026-10-20' }],
        ['/weg/a12/', { h: 'anders', d: '2026-10-20' }],
      ]);
      generate({
        out, sample: true, quiet: true, now: new Date(NOW), lastmodState,
        fingerprintFor: (page) => (page.path === '/weg/a2/' ? 'zelfde' : `nieuw:${page.path}`),
      });
      const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
      const dayOf = (path) => new RegExp(`<loc>[^<]*${path.replace(/\//g, '\\/')}</loc><lastmod>([^<]+)</lastmod>`).exec(sitemap)?.[1];
      assert.equal(dayOf('/weg/a2/'), '2026-10-20');
      assert.equal(dayOf('/weg/a12/'), TODAY);
      assert.equal(dayOf('/afsluitingen/'), TODAY, 'a live list changes all day');
      assert.equal(dayOf('/'), TODAY);
      const state = JSON.parse(readFileSync(join(out, 'index-state.json'), 'utf8'));
      assert.deepEqual(state.lastmod['/weg/a2/'], ['zelfde', '2026-10-20']);
      assert.deepEqual(state.lastmod['/weg/a12/'], ['nieuw:/weg/a12/', TODAY]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('remembers only the pages in the sitemap: a noindex page has no <lastmod> to keep', () => {
    const out = mkdtempSync(join(tmpdir(), 'wegwerk-lastmod-'));
    try {
      const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
      const woonplaats = model.pages.find((p) => p.kind === 'woonplaats');
      const rows = [
        ...Array.from({ length: MIN_INDEX_ROWS }, () => row('Vulgemeente', 'Vulplaats')),
        ...model.lists.gemeenten.map((g) => row(g.naam)),
      ];
      const activity = buildActivity({ index: { generated: 'x', rows }, bridges: null }, { warn: quiet });
      generate({ out, sample: true, quiet: true, now: new Date(NOW), activity, fingerprintFor: () => 'h' });
      const state = JSON.parse(readFileSync(join(out, 'index-state.json'), 'utf8'));
      assert.ok(!(woonplaats.path in state.lastmod), 'the thin woonplaats is not remembered');
      assert.ok('/weg/a2/' in state.lastmod);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("a list page's day moves when its text is edited, not only its data", () => {
    const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
    const page = model.byPath.get('/wegen/');
    const content = new Map(model.content);
    const entry = content.get('wegen');
    content.set('wegen', { ...entry, body: `${entry.body}\n\nNieuwe alinea.` });
    assert.notEqual(pageFingerprint(page, model, null), pageFingerprint(page, { ...model, content }, null));
    assert.equal(pageFingerprint(page, model, null), pageFingerprint(page, { ...model, buildIso: '2027-01-01T00:00:00Z' }, null), 'the build moment is not content');
  });

  it('a static page keeps its day until its text is edited', () => {
    const run = (lastmodState) => {
      const out = mkdtempSync(join(tmpdir(), 'wegwerk-lastmod-'));
      try {
        generate({ out, sample: true, quiet: true, now: new Date(NOW), lastmodState });
        return JSON.parse(readFileSync(join(out, 'index-state.json'), 'utf8')).lastmod;
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    };
    const first = run(null);
    const [h] = first['/over/'];
    const second = run(new Map([['/over/', { h, d: '2026-09-01' }]]));
    assert.deepEqual(second['/over/'], [h, '2026-09-01']);
  });
});
