/**
 * Entity pages without any roadworks are kept out of Google (noindex, follow + not in the
 * sitemap) and load no ads; see web/scripts/lib/activity.mjs for why. These tests pin down which
 * pages count as empty — the same items the page itself would show — and that a data outage never
 * makes a page empty.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataIndex } from './helpers/src.mjs';
import { generate } from '../scripts/gen-pages.mjs';

import { MIN_INDEX_ROWS, buildActivity, isThinPage, loadActivity, woonplaatsKey } from '../scripts/lib/activity.mjs';
import { buildModel, renderPage, PAGE_TYPES } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};

/** An IndexRow (web/src/data/types.ts) with only the fields activity.mjs reads filled in. */
function row({ id = 'x', cat = 'werk', gemeente = null, woonplaats = null } = {}) {
  return [id, cat, null, 1, 'titel', null, null, gemeente, woonplaats, null, '2026-10-16T08:00:00Z', null, 5, 52, 0, null, 1, 'hinder', null, 0, null, null];
}

/** Enough filler rows to pass the broken-data guard, none of them in a place the tests ask about. */
function filler(n = MIN_INDEX_ROWS) {
  return Array.from({ length: n }, (_, i) => row({ id: `f${i}`, gemeente: 'Vulgemeente', woonplaats: 'Vulplaats' }));
}

function index(rows) {
  return { generated: '2026-10-16T17:25:01Z', rows: [...filler(), ...rows] };
}

const BRIDGES = {
  generated: '2026-10-16T17:25:01Z',
  bridges: [
    { id: 'BRUG_OPEN', openNow: true, openings: [] },
    { id: 'BRUG_PLAN', openNow: false, openings: [['2026-10-17T06:00:00Z', '2026-10-17T06:10:00Z']] },
    { id: 'BRUG_LEEG', openNow: false, openings: [] },
  ],
};

const woonplaats = (naam, gemeente) => ({ type: 'place', kind: 'woonplaats', entity: { naam, gemeente } });
const gemeente = (naam) => ({ type: 'place', kind: 'gemeente', entity: { naam } });
const bridge = (id) => ({ type: 'bridge', entity: { id } });

describe('buildActivity', () => {
  it('reads the IndexRow positions the web reads (types.ts contract)', () => {
    const item = dataIndex.indexItemFromRow(row({ cat: 'afsluiting', gemeente: 'Lingewaard', woonplaats: 'Angeren' }));
    assert.equal(item.cat, 'afsluiting');
    assert.equal(item.gemeente, 'Lingewaard');
    assert.equal(item.woonplaats, 'Angeren');
  });

  it('matches a woonplaats within its own gemeente, ignoring case and accents', () => {
    const activity = buildActivity({ index: index([row({ gemeente: "'s-Hertogenbosch", woonplaats: 'ROSMALEN' })]), bridges: BRIDGES }, { warn: quiet });
    assert.equal(isThinPage(woonplaats('Rosmalen', "'s-Hertogenbosch"), activity), false);
    assert.equal(isThinPage(gemeente("'s-Hertogenbosch"), activity), false);
    // Same name, other gemeente: that page shows nothing (it reads its own gemeente's file).
    assert.equal(isThinPage(woonplaats('Rosmalen', 'Oss'), activity), true);
    assert.equal(woonplaatsKey('Súdwest-Fryslân', 'Ylst'), woonplaatsKey('sudwest fryslan', 'ylst'));
  });

  it('counts roadworks, closures and events, not traffic jams, incidents or bridge openings', () => {
    const rows = [
      row({ cat: 'file', gemeente: 'Lingewaard', woonplaats: 'Angeren' }),
      row({ cat: 'incident', gemeente: 'Lingewaard', woonplaats: 'Angeren' }),
      row({ cat: 'brug', gemeente: 'Lingewaard', woonplaats: 'Angeren' }),
      row({ cat: 'evenement', gemeente: 'Uden', woonplaats: 'Volkel' }),
      row({ cat: 'afsluiting', gemeente: 'Berkelland', woonplaats: null }),
    ];
    const activity = buildActivity({ index: index(rows), bridges: BRIDGES }, { warn: quiet });
    assert.equal(isThinPage(woonplaats('Angeren', 'Lingewaard'), activity), true);
    assert.equal(isThinPage(gemeente('Lingewaard'), activity), true);
    assert.equal(isThinPage(woonplaats('Volkel', 'Uden'), activity), false);
    // An item with only a gemeente fills the gemeente page, not a woonplaats page.
    assert.equal(isThinPage(gemeente('Berkelland'), activity), false);
    assert.equal(isThinPage(woonplaats('Gelselaar', 'Berkelland'), activity), true);
  });

  it('treats a bridge as active when it is open now or has a planned opening', () => {
    const activity = buildActivity({ index: index([]), bridges: BRIDGES }, { warn: quiet });
    assert.equal(isThinPage(bridge('BRUG_OPEN'), activity), false);
    assert.equal(isThinPage(bridge('BRUG_PLAN'), activity), false);
    assert.equal(isThinPage(bridge('BRUG_LEEG'), activity), true);
    assert.equal(isThinPage(bridge('NIET_IN_BESTAND'), activity), true);
  });

  it('never marks road, list or static pages as thin', () => {
    const activity = buildActivity({ index: index([]), bridges: BRIDGES }, { warn: quiet });
    assert.equal(isThinPage({ type: 'road', entity: { road: 'A28', slug: 'a28' } }, activity), false);
    assert.equal(isThinPage({ type: 'list', slug: 'files' }, activity), false);
    assert.equal(isThinPage({ type: 'static', slug: 'over' }, activity), false);
  });

  it('gives up on an index that looks broken, so nothing is thin', () => {
    const warnings = [];
    const tooSmall = buildActivity({ index: { generated: 'x', rows: [row({ gemeente: 'Uden', woonplaats: 'Volkel' })] }, bridges: BRIDGES }, { warn: (m) => warnings.push(m) });
    assert.equal(tooSmall, null);
    assert.equal(buildActivity({ index: { rows: 'kapot' }, bridges: BRIDGES }, { warn: (m) => warnings.push(m) }), null);
    assert.equal(buildActivity({ index: null, bridges: BRIDGES }, { warn: (m) => warnings.push(m) }), null);
    assert.equal(warnings.length, 3);
    assert.equal(isThinPage(woonplaats('Angeren', 'Lingewaard'), null), false);
  });

  it('keeps every bridge page when bruggen.json is missing, empty or its source failed', () => {
    for (const [bridges, meta] of [
      [null, undefined],
      [{ generated: 'x', bridges: [] }, undefined], // a dead NDW bridge feed still publishes an empty list
      [BRIDGES, { sources: { bruggen: { ok: false } } }],
    ]) {
      const activity = buildActivity({ index: index([]), bridges, meta }, { warn: quiet });
      assert.equal(isThinPage(bridge('BRUG_LEEG'), activity), false);
      assert.equal(isThinPage(woonplaats('Angeren', 'Lingewaard'), activity), true);
    }
  });

  it('believes nothing when the planning source failed in the last run', () => {
    const warnings = [];
    const meta = { sources: { planning: { ok: false }, bruggen: { ok: true } } };
    assert.equal(buildActivity({ index: index([]), bridges: BRIDGES, meta }, { warn: (m) => warnings.push(m) }), null);
    assert.match(warnings[0], /planning/);
  });
});

describe('loadActivity', () => {
  const okFetch = (bodies) => async (url) => {
    const body = bodies[new URL(url).pathname.replace(/^\/v1\//, '')];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };

  it('does nothing without a data address', async () => {
    let called = false;
    const result = await loadActivity({ dataBase: '', fetchImpl: async () => { called = true; }, warn: quiet });
    assert.equal(result, null);
    assert.equal(called, false);
  });

  it('reads index/all.json, bruggen.json and meta.json under the data address', async () => {
    const meta = { sources: { planning: { ok: true }, bruggen: { ok: true } } };
    const fetchImpl = okFetch({ 'index/all.json': index([row({ gemeente: 'Uden', woonplaats: 'Volkel' })]), 'bruggen.json': BRIDGES, 'meta.json': meta });
    const activity = await loadActivity({ dataBase: 'https://data.example.nl/v1', fetchImpl, warn: quiet });
    assert.equal(isThinPage(woonplaats('Volkel', 'Uden'), activity), false);
    assert.equal(isThinPage(bridge('BRUG_LEEG'), activity), true);
  });

  it('returns null with a warning when the index cannot be fetched', async () => {
    const warnings = [];
    const activity = await loadActivity({ dataBase: 'https://data.example.nl/v1/', fetchImpl: okFetch({ 'bruggen.json': BRIDGES }), warn: (m) => warnings.push(m) });
    assert.equal(activity, null);
    assert.match(warnings.join('\n'), /404/);
  });

  it('still judges places when only bruggen.json and meta.json fail', async () => {
    const warnings = [];
    const fetchImpl = okFetch({ 'index/all.json': index([row({ gemeente: 'Uden', woonplaats: 'Volkel' })]) });
    const activity = await loadActivity({ dataBase: 'https://data.example.nl/v1/', fetchImpl, warn: (m) => warnings.push(m) });
    assert.equal(isThinPage(woonplaats('Volkel', 'Uden'), activity), false);
    assert.equal(isThinPage(bridge('BRUG_LEEG'), activity), false);
    assert.equal(warnings.length, 3); // bruggen.json, meta.json, and "brugpagina's blijven indexeerbaar"
  });
});

describe('generated pages', () => {
  const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
  const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);
  const model0 = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
  const [busy, empty] = model0.lists.woonplaatsen;
  const busyBridge = model0.lists.bridges[0];
  // Every gemeente has something (a quiet day leaves only a few gemeenten empty, see the guard below).
  const everyGemeente = model0.lists.gemeenten.map((g) => row({ id: `g-${g.slug}`, gemeente: g.naam }));
  const activity = buildActivity(
    {
      index: index([...everyGemeente, row({ gemeente: busy.gemeente, woonplaats: busy.naam })]),
      bridges: { generated: 'x', bridges: [{ id: busyBridge.id, openNow: true, openings: [] }] },
    },
    { warn: quiet },
  );
  const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, activity, warn: quiet });
  const pageOf = (path) => model.byPath.get(path);
  const robotsOf = (html) => /<meta name="robots" content="([^"]+)">/.exec(html)?.[1];

  it('an empty woonplaats page gets noindex, follow and leaves the sitemap', () => {
    const page = pageOf(`/plaats/${empty.slug}/`);
    assert.equal(page.thin, true);
    assert.equal(page.sitemap, false);
    assert.equal(robotsOf(renderPage(page, model, templates)), 'noindex, follow');
  });

  it('a woonplaats with roadworks and every road page stay indexed', () => {
    const page = pageOf(`/plaats/${busy.slug}/`);
    assert.equal(page.thin, undefined);
    assert.equal(page.sitemap, true);
    assert.match(robotsOf(renderPage(page, model, templates)), /^index, follow/);
    for (const road of model.pages.filter((p) => p.type === 'road')) assert.equal(road.sitemap, true);
  });

  it('a bridge with an opening stays indexed, the others do not', () => {
    const bridges = model.pages.filter((p) => p.type === 'bridge');
    assert.equal(bridges.find((p) => p.entity.id === busyBridge.id).sitemap, true);
    assert.ok(bridges.filter((p) => p.entity.id !== busyBridge.id).every((p) => p.thin === true));
  });

  it('an empty page that had roadworks within 60 days stays indexed, but without ads', () => {
    const path = `/plaats/${empty.slug}/`;
    const recent = buildModel({
      webRoot: WEB_ROOT, repoRoot: REPO_ROOT, activity, indexState: new Map([[path, '2026-10-01']]), now: new Date('2026-10-25T12:00:00Z'), warn: quiet,
    });
    const page = recent.byPath.get(path);
    assert.equal(page.thin, undefined);
    assert.equal(page.quiet, true);
    const html = renderPage(page, recent, templates);
    assert.match(robotsOf(html), /^index, follow/);
    assert.match(html, /<meta name="wegwerk-ads" content="off">/);
    assert.doesNotMatch(renderPage(recent.byPath.get(`/plaats/${busy.slug}/`), recent, templates), /wegwerk-ads/);
    assert.doesNotMatch(renderPage(recent.byPath.get('/over/'), recent, templates), /wegwerk-ads/);
  });

  it('without data no page is quiet: an outage never switches ads off', () => {
    assert.equal(model0.counts.quiet, 0);
  });

  it('without data every page is indexable, as before', () => {
    assert.equal(model0.pages.filter((p) => p.thin).length, 0);
    assert.equal(model0.counts.thin, 0);
    assert.ok(model.counts.thin > 0);
  });

  it('does not believe data in which most gemeenten have nothing: then no page is thin', () => {
    const warnings = [];
    const broken = buildActivity({ index: index([row({ gemeente: busy.gemeente, woonplaats: busy.naam })]), bridges: BRIDGES }, { warn: quiet });
    const m = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, activity: broken, warn: (w) => warnings.push(w) });
    assert.equal(m.counts.thin, 0);
    assert.match(warnings.join('\n'), /gemeenten zouden zonder meldingen zijn/);
  });

  it('generate() leaves thin pages out of the sitemap and writes noindex into them', () => {
    const out = mkdtempSync(join(tmpdir(), 'wegwerk-gen-'));
    try {
      generate({ out, sample: true, quiet: true, activity });
      const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
      assert.ok(sitemap.includes(`/plaats/${busy.slug}/`));
      assert.ok(!sitemap.includes(`/plaats/${empty.slug}/`));
      assert.ok(existsSync(join(out, 'plaats', empty.slug, 'index.html')), 'the thin page itself is still written');
      assert.match(readFileSync(join(out, 'plaats', empty.slug, 'index.html'), 'utf8'), /<meta name="robots" content="noindex, follow">/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('entity pages carry no templated FAQPage markup; the FAQ page itself still does', () => {
    for (const type of ['road', 'place', 'bridge']) {
      const page = model.pages.find((p) => p.type === type);
      assert.ok(!renderPage(page, model, templates).includes('"FAQPage"'), `${type} page still has FAQPage JSON-LD`);
    }
    const faq = pageOf('/veelgestelde-vragen/');
    assert.ok(renderPage(faq, model, templates).includes('"FAQPage"'));
  });
});
