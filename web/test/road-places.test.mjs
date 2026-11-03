/**
 * Links between roads and the places they run through (scripts/lib/road-places.mjs). Until
 * 2026-11 road pages linked only to other roads and place pages only to other places, so the
 * ~1,900 pages Google had not indexed were reachable only through two long lists. Now a road page
 * names the gemeenten and plaatsen along it, and a place page the roads through it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_INDEX_ROWS, buildActivity } from '../scripts/lib/activity.mjs';
import { PAGE_TYPES, buildModel, renderPage } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';
import { MAX_CELL_DISTANCE_M, MIN_STRETCH_M, roadPlaceLinks } from '../scripts/lib/road-places.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};

/* Synthetic places on a line of latitude: ~0.0146° longitude ≈ 1 km at 52° N. */
const KM = 0.0146;
const place = (naam, kmEast, kmNorth = 0) => ({ naam, slug: naam.toLowerCase(), gemeenteCode: 'G1', lon: 5 + kmEast * KM, lat: 52 + kmNorth / 111 });

describe('roadPlaceLinks', () => {
  const west = place('West', 0);
  const oost = place('Oost', 10);
  const ver = place('Ver', 5, 30);
  const road = { slug: 'n1', road: 'N1', type: 'N', lon: 5 + 5 * KM, lat: 52 };
  const lines = new Map([['n1', [[[5, 52], [5 + 10 * KM, 52]]]]]);

  it('assigns each stretch of a road to the nearest place, both ways (by slug)', () => {
    const { placesByRoad, roadsByPlace } = roadPlaceLinks({ roads: [road], woonplaatsen: [west, oost, ver], lines });
    assert.deepEqual(placesByRoad.get('n1').map((x) => x.slug).sort(), ['oost', 'west']);
    assert.ok(placesByRoad.get('n1').every((x) => x.metres > 4000 && x.metres < 6000), 'each place gets about half of the 10 km');
    assert.deepEqual(roadsByPlace.get('west').map((x) => x.slug), ['n1']);
    assert.equal(roadsByPlace.has('ver'), false, 'a place 30 km away is not along the road');
  });

  it(`does not count a road that only clips a place for less than ${MIN_STRETCH_M} m`, () => {
    const tip = new Map([['n1', [[[5 + 9.9 * KM, 52], [5 + 10.1 * KM, 52]], [[5 - 20 * KM, 52], [5 - 10 * KM, 52]]]]]);
    const { roadsByPlace } = roadPlaceLinks({ roads: [road], woonplaatsen: [oost, place('Verweg', -15)], lines: tip });
    assert.equal(roadsByPlace.has('oost'), false);
  });

  it(`leaves stretches more than ${MAX_CELL_DISTANCE_M / 1000} km from every place unassigned (a dam, a lake)`, () => {
    const dam = new Map([['n1', [[[5, 52.5], [5 + 10 * KM, 52.5]]]]]);
    const { placesByRoad } = roadPlaceLinks({ roads: [road], woonplaatsen: [west, oost], lines: dam });
    assert.deepEqual(placesByRoad.get('n1') ?? [], []);
  });

  it('a road without a line (city ring roads) goes with the place nearest to its centre', () => {
    const ring = { slug: 's100', road: 's100', type: 'S', lon: 5 + 9.5 * KM, lat: 52 };
    const { placesByRoad, roadsByPlace } = roadPlaceLinks({ roads: [ring], woonplaatsen: [west, oost], lines: new Map() });
    assert.deepEqual(placesByRoad.get('s100').map((x) => x.slug), ['oost']);
    assert.deepEqual(roadsByPlace.get('oost').map((x) => x.slug), ['s100']);
  });
});

describe('the pages', () => {
  const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
  const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);
  const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
  const html = (m, path) => renderPage(m.byPath.get(path), m, templates);
  const hrefs = (page) => new Set([...page.matchAll(/href="(\/(?:weg|gemeente|plaats)\/[^"]+)"/g)].map((m) => m[1]));

  it('a gemeente page links to the roads in and around it', () => {
    const page = html(model, '/gemeente/nieuwegein/');
    assert.match(page, /Wegen in en rond Nieuwegein/);
    for (const road of ['/weg/a2/', '/weg/a12/', '/weg/a27/']) assert.ok(hrefs(page).has(road), road);
  });

  it('a woonplaats page links to the roads by it', () => {
    const page = html(model, '/plaats/hurdegaryp/');
    assert.match(page, /Wegen bij Hurdegaryp/);
    assert.ok(hrefs(page).has('/weg/n356/'));
  });

  it('a road page links to the gemeenten and plaatsen along it', () => {
    const page = html(model, '/weg/n246/');
    assert.match(page, /<h2 id="along-title">Langs de N246<\/h2>/);
    assert.ok(hrefs(page).has('/gemeente/zaanstad/'));
    assert.ok(hrefs(page).has('/plaats/westknollendam/'));
  });

  it('never links to a woonplaats that redirects to its gemeente', () => {
    const redirected = new Set(model.redirects.map((r) => r.from));
    for (const path of ['/weg/a2/', '/weg/a58/', '/weg/n246/', '/gemeente/nieuwegein/']) {
      for (const href of hrefs(html(model, path))) assert.ok(!redirected.has(href), `${path} → ${href}`);
    }
  });

  it('never links to a page that is out of Google (noindex)', () => {
    // Every gemeente has roadworks, of the woonplaatsen only Westknollendam: the rest is thin.
    const row = (gemeente, woonplaats = null) => ['x', 'werk', null, 1, 't', null, null, gemeente, woonplaats, null, '2026-10-16T08:00:00Z', null, 5, 52, 0, null, 1, 'hinder', null, 0, null, null];
    const rows = [
      ...Array.from({ length: MIN_INDEX_ROWS }, () => row('Vulgemeente', 'Vulplaats')),
      ...model.lists.gemeenten.map((g) => row(g.naam)),
      row('Zaanstad', 'Westknollendam'),
    ];
    const activity = buildActivity({ index: { generated: 'x', rows }, bridges: null }, { warn: quiet });
    const thinModel = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, activity, warn: quiet });
    const links = hrefs(html(thinModel, '/weg/n246/'));
    assert.ok(links.has('/plaats/westknollendam/'));
    for (const href of links) assert.notEqual(thinModel.byPath.get(href)?.thin, true, href);
  });

  it('almost every gemeente and every road with a known course gets such links', () => {
    const { placesByRoad } = model.index.roadPlaces();
    const gemeentenWithout = model.pages.filter((p) => p.kind === 'gemeente' && !/class="related__sub">Wegen in en rond/.test(html(model, p.path)));
    assert.ok(gemeentenWithout.length <= 15, `${gemeentenWithout.length} gemeenten zonder wegen: ${gemeentenWithout.map((p) => p.entity.naam).join(', ')}`);
    const roadsWithout = model.lists.roads.filter((r) => (placesByRoad.get(r.slug) ?? []).length === 0);
    assert.ok(roadsWithout.length <= 10, roadsWithout.map((r) => r.road).join(', '));
  });

  it('tells two places with the same name apart by their gemeente', () => {
    const a1 = html(model, '/weg/a1/');
    const chips = [...a1.matchAll(/<a class="chip" href="\/plaats\/[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
    assert.equal(new Set(chips).size, chips.length, `duplicate chip text on /weg/a1/: ${chips.join(', ')}`);
    assert.ok(chips.some((c) => /^Klarenbeek \(.+\)$/.test(c)), chips.join(', '));
  });

  it('works out the links once per process, also for the dev server that builds a model per request', () => {
    const again = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
    assert.equal(again.index.roadPlaces(), model.index.roadPlaces());
  });

  it('keeps the blocks short enough to read', () => {
    const a2 = html(model, '/weg/a2/');
    const along = /<section class="related" aria-labelledby="along-title">([\s\S]*?)<\/section>/.exec(a2)[1];
    assert.ok((along.match(/<li>/g) ?? []).length <= 80);
  });
});
