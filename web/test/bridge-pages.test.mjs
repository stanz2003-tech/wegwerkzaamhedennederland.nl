/**
 * The pages of bridges in a road (/brug/<slug>/ with an answer like a road page): titles and
 * names people search for, the build's snapshot with the bridge's own verdict, and the links from
 * road, place and list pages. Bridges without a road keep their openings page.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGE_TYPES, buildEntityManifest, buildModel, renderPage } from '../scripts/lib/pages.mjs';
import { loadPartials, loadTemplates } from '../scripts/lib/render.mjs';
import { createFingerprinter, createSnapshotter, loadSnapshotModules } from '../scripts/lib/snapshot.mjs';
import { TITLE_MAX } from '../scripts/lib/text.mjs';
import { roadBridgeTitle, shortBridgeName } from '../scripts/lib/bridge-pages.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = dirname(WEB_ROOT);
const quiet = () => {};
const partials = loadPartials(join(WEB_ROOT, 'templates'), { warn: quiet });
const { templates } = loadTemplates(join(WEB_ROOT, 'templates'), partials, PAGE_TYPES);
const model = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, warn: quiet });
const html = (m, path) => renderPage(m.byPath.get(path), m, templates);
const titleOf = (h) => /<title>([^<]*)<\/title>/.exec(h)?.[1];
const descriptionOf = (h) => /<meta name="description" content="([^"]*)"/.exec(h)?.[1];
const MERWEDE = '/brug/merwedebrug-bij-gorinchem/';

describe('a bridge in a road', () => {
  it('is named the way people search for it', () => {
    const page = html(model, MERWEDE);
    assert.equal(titleOf(page), 'Merwedebrug Gorinchem (A27): afsluitingen en werk');
    assert.match(page, /<h1>Merwedebrug bij Gorinchem<\/h1>/);
    assert.match(page, /Ook bekend als Gorkumse brug, Gorinchemse brug en Merwedebrug A27/);
    assert.match(page, /aria-label="Kan ik over de Merwedebrug bij Gorinchem\?"/);
    assert.match(page, /Werk vlak voor en na de brug telt mee: alle meldingen op de A27 binnen 1,2 km van de brug/);
    assert.match(page, /data-road="A27" data-road-type="A" data-road-slug="a27" data-gemeente-slug="gorinchem"/);
    // A fixed bridge has no openings block; a lift bridge in a road keeps one under the answer.
    assert.doesNotMatch(page, /id="bridge-openings-block"/);
    assert.match(html(model, '/brug/brug-in-de-rijksweg-a15-bij-botlek-rotterdam/'), /id="bridge-openings-block" aria-labelledby="openingen" hidden/);
  });

  it('every bridge title fits and is unique; a bridge without a road keeps its openings title', () => {
    for (const p of model.pages.filter((x) => x.type === 'bridge')) assert.ok(titleOf(html(model, p.path)).length <= TITLE_MAX || !p.entity.road, p.path);
    assert.equal(shortBridgeName({ name: 'Maasbrug (A2)', road: 'A2' }), 'Maasbrug');
    assert.equal(roadBridgeTitle({ id: 'VILD-1', name: 'Maasbrug (A2)', road: 'A2' }), 'Maasbrug (A2): afsluitingen en werk');
    const noRoad = model.pages.find((p) => p.type === 'bridge' && !p.entity.road);
    assert.match(titleOf(html(model, noRoad.path)), /^Brugopeningen /);
  });

  it('the road page lists its bridges along the road, north to south on the A27', () => {
    const page = html(model, '/weg/a27/');
    assert.match(page, /<h2 id="bridges-title">Bruggen op de A27<\/h2>/);
    const order = ['stichtse-brug', 'merwedebrug-bij-gorinchem', 'keizersveerbrug'].map((s) => page.indexOf(`href="/brug/${s}/"`));
    assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], order.join(','));
  });

  it('the gemeente page links its bridges, the road bridge first', () => {
    const page = html(model, '/gemeente/gorinchem/');
    assert.match(page, /Bruggen in de gemeente Gorinchem/);
    assert.ok(page.indexOf(`href="${MERWEDE}"`) > 0);
  });

  it('/bruggen/ has the road bridges per road and still every bridge exactly once', () => {
    const page = html(model, '/bruggen/');
    assert.match(page, /Bruggen in snelwegen en provinciale wegen/);
    for (const b of model.lists.bridges) {
      const n = page.split(`href="/brug/${b.slug}/"`).length - 1;
      assert.equal(n, 1, `${b.slug} listed ${n} times`);
    }
  });

  it('the map manifest carries the bridges, with the road where there is one', () => {
    const manifest = buildEntityManifest(model);
    assert.equal(manifest.bridges.length, model.lists.bridges.length);
    assert.deepEqual(manifest.bridges.find((b) => b.slug === 'merwedebrug-bij-gorinchem'), { slug: 'merwedebrug-bij-gorinchem', name: 'Merwedebrug bij Gorinchem', road: 'A27', gemeente: 'Gorinchem', lon: 4.94241, lat: 51.8273 });
  });
});

describe('the build snapshot of a bridge in a road', async () => {
  const mods = await loadSnapshotModules();
  const now = Date.parse('2026-11-04T12:00:00Z');
  const feature = (id, title, coordinates, imp, road = 'A27') => ({
    f: { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { id, cat: 'afsluiting', sev: 3, title, start: '2026-11-04T06:00Z', end: '2026-11-06T06:00Z', src: 'NDW', imp, ...(road ? { road } : {}) } },
    d: { id, from: 'Gorinchem', to: 'Werkendam' },
  });
  const onBridge = feature('on', 'A27 · Gorinchem → Werkendam', [[4.9424, 51.84], [4.9424, 51.81]], 'rijbaan');
  const farAway = feature('far', 'A27 · Breda → Oosterhout', [[4.8, 51.6], [4.8, 51.58]], 'dicht');
  const street = feature('street', 'Van Gochstraat, Gorinchem', [[4.95, 51.83], [4.951, 51.831]], 'dicht', null);
  const live = { index: { rows: [] }, meta: { generated: '2026-11-04T11:50:00Z' }, bridges: { bridges: [] } };
  const files = { roads: new Map([['a27', [onBridge, farAway]]]), gemeenten: new Map([['gorinchem', [street]]]), failed: 0 };
  const snapshotFor = createSnapshotter({ mods, live, files, now });
  const withData = buildModel({ webRoot: WEB_ROOT, repoRoot: REPO_ROOT, snapshotFor, warn: quiet });
  const page = html(withData, MERWEDE);

  it('holds the bridge question, its verdict and only the meldingen that touch the bridge', () => {
    assert.match(page, /Kan ik nu over de Merwedebrug bij Gorinchem\?/);
    assert.match(page, /Rijbaan dicht tussen Gorinchem en Werkendam/);
    assert.match(page, /1 melding op en rond de Merwedebrug bij Gorinchem/);
    assert.doesNotMatch(page, /Breda → Oosterhout|Van Gochstraat/);
    assert.match(page, /<section class="entity-forecast" id="entity-forecast" data-reserve/);
  });

  it('the meta description carries the current verdict', () => {
    assert.match(descriptionOf(page), /^Kan ik over de Merwedebrug bij Gorinchem \(A27\)\? Stand .+?: Rijbaan dicht tussen Gorinchem en Werkendam/);
  });

  it('its lastmod follows the meldingen on the bridge, not those elsewhere on the road', () => {
    const fp = (roadItems) => createFingerprinter({ mods, live, files: { ...files, roads: new Map([['a27', roadItems]]) }, now })(withData.byPath.get(MERWEDE));
    assert.equal(fp([onBridge, farAway]), fp([onBridge]));
    assert.notEqual(fp([onBridge]), fp([]));
  });
});
