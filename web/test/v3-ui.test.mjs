/**
 * Contract v3 UI helpers that can run without a browser: the URL state additions (`v`, `weg`,
 * `t=<datetime-local>`), the Google Maps detour URL, the verdict-first list row markup, the
 * road parsing of search results, the verdict map colours vs. tokens.css, and the detour layers.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { categories, listItem, mapLayers, uiDetail, uiSearch, urlState } from './helpers/src.mjs';

const { parseUrlState, serializeUrlState, parseLocalDateTime, formatLocalDateTime, normalizeRoadParam } = urlState;
const { detourMapsUrl, waypointIndices, GMAPS_DETOUR_NOTE } = uiDetail;
const { renderListItem, modelFromProps, sectionOf } = listItem;
const { roadFromName } = uiSearch;
const { VERDICT_HEX, DETOUR_HEX } = categories;
const { LAYERS, overlayLayers, detourCollection, verdictScale } = mapLayers;

const NOW = Date.parse('2026-09-09T12:00:00Z');

describe('url state v3', () => {
  it('reads the vehicle mode and the road, defaults to auto / no road', () => {
    assert.equal(parseUrlState('?v=fiets&weg=a27').mode, 'fiets');
    assert.equal(parseUrlState('?v=fiets&weg=a27').road, 'A27');
    assert.equal(parseUrlState('?weg=A%2027').road, 'A27');
    assert.equal(parseUrlState('?v=boot&weg=breda').mode, 'auto');
    assert.equal(parseUrlState('?v=boot&weg=breda').road, null);
  });

  it('t= is either a window or an exact Europe/Amsterdam moment', () => {
    const w = parseUrlState('?t=weekend');
    assert.equal(w.time, 'weekend');
    assert.equal(w.moment, null);
    const m = parseUrlState('?t=2026-09-20T14:00');
    assert.equal(m.time, 'nu');
    assert.equal(m.moment, Date.parse('2026-09-20T12:00:00Z'), '14:00 CEST = 12:00Z');
    assert.equal(parseUrlState('?t=2026-13-40T99:00').moment, null);
    assert.equal(parseUrlState('?t=morgen').time, 'morgen');
  });

  it('round-trips mode, road and moment; omits the defaults', () => {
    const s = parseUrlState('?v=vracht&weg=n57&t=2026-09-20T14:00&cat=werk');
    assert.equal(serializeUrlState(s), 'cat=werk&t=2026-09-20T14:00&v=vracht&weg=n57');
    assert.equal(serializeUrlState(parseUrlState('')), '');
    assert.equal(formatLocalDateTime(parseLocalDateTime('2026-01-05T08:05')), '2026-01-05T08:05');
    assert.equal(normalizeRoadParam(' a027 '), 'A27');
  });
});

describe('Google Maps detour link', () => {
  const coords = [[5.0, 52.0], [5.1, 52.1], [5.2, 52.2], [5.3, 52.3], [5.4, 52.4], [5.5, 52.5], [5.6, 52.6]];

  it('uses first/last as origin/destination and at most three evenly spaced waypoints', () => {
    const url = detourMapsUrl(coords);
    assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1&origin=52.00000,5.00000&destination=52.60000,5.60000&waypoints='));
    assert.ok(url.endsWith('&travelmode=driving'));
    const wp = /waypoints=([^&]+)/.exec(url)[1];
    assert.equal(wp.split('%7C').length, 3);
    assert.equal(wp.includes('|'), false, 'the separator is encoded');
    assert.equal(wp, '52.20000,5.20000%7C52.30000,5.30000%7C52.50000,5.50000');
  });

  it('a two-point detour has no waypoints; a single point is no route', () => {
    assert.equal(detourMapsUrl([[5, 52], [6, 53]]).includes('waypoints'), false);
    assert.equal(detourMapsUrl([[5, 52]]), null);
    assert.deepEqual(waypointIndices(2), []);
    assert.deepEqual(waypointIndices(4), [1, 2]);
    assert.deepEqual(waypointIndices(12), [3, 6, 8]);
  });

  it('carries no departure time and says so honestly', () => {
    assert.equal(detourMapsUrl(coords).includes('departure'), false);
    assert.match(GMAPS_DETOUR_NOTE, /kent de omleiding niet zelf/);
  });
});

describe('verdict-first list row', () => {
  const props = {
    id: 'x1', cat: 'werk', sub: 'laneClosures', sev: 2, title: 'A27 · Lunetten → Utrecht-Noord', road: 'A27', roadType: 'A',
    woonplaats: 'Utrecht', start: '2026-09-09T10:00:00Z', end: '2026-09-09T18:00:00Z', src: 'Rijkswaterstaat', imp: 'hinder', lc: 1, spd: 70,
  };

  it('puts the verdict pill before the title and marks the row with the level', () => {
    const html = renderListItem(modelFromProps(props), NOW);
    assert.ok(html.indexOf('vpill--hinder') < html.indexOf('item__title'), 'pill first');
    assert.ok(html.includes('data-verdict="hinder"'));
    assert.ok(html.includes('Doorrijden mogelijk'));
    assert.ok(html.includes('1 rijstrook dicht · max 70 km/u'));
    assert.ok(html.includes('Lunetten → Utrecht-Noord'), 'section without the road prefix');
    assert.ok(html.includes('nog 6 u'), 'when line without "Nu actief"');
    assert.ok(html.includes('data-road="A27"'), 'badge is a road-mode target');
    assert.ok(html.includes('Rijkswaterstaat'), 'wegbeheerder on the muted line');
  });

  it('follows the vehicle mode: a cycle path is nvt for cars and dicht for cyclists', () => {
    const cycle = modelFromProps({ ...props, imp: 'dicht', veh: ['bicycle', 'moped'], road: undefined, roadType: 'lokaal', title: 'Fietspad dicht' });
    assert.ok(renderListItem(cycle, NOW, { mode: 'auto' }).includes("Geldt niet voor auto"));
    assert.ok(renderListItem(cycle, NOW, { mode: 'auto' }).includes('alleen fietspad'));
    assert.ok(renderListItem(cycle, NOW, { mode: 'fiets' }).includes('data-verdict="dicht"'));
  });

  it('renders as a link on the generated pages and reads a v2 feature as onbekend', () => {
    const html = renderListItem(modelFromProps({ ...props, imp: undefined }), NOW, { href: '/?id=x1' });
    assert.ok(html.startsWith('<a class="item"'));
    assert.ok(html.includes('Hinder onbekend'));
    assert.equal(sectionOf({ title: 'Los', road: null }), 'Los');
  });
});

describe('search: road numbers in PDOK names', () => {
  it('finds the road number in typical Locatieserver names', () => {
    assert.equal(roadFromName('A27, Gorinchem'), 'A27');
    assert.equal(roadFromName('Rijksweg A2'), 'A2');
    assert.equal(roadFromName('N 57, Veere'), 'N57');
    assert.equal(roadFromName('Coolsingel, Rotterdam'), null);
    assert.equal(roadFromName('Amsterdam'), null);
  });
});

describe('map colours by verdict', () => {
  const CSS = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const tokens = (name) => [...CSS.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))].map((m) => m[1].toLowerCase());

  it('VERDICT_HEX mirrors the --v-* tokens (light, then dark twice)', () => {
    for (const level of ['dicht', 'rijbaan', 'hinder', 'geen', 'nvt', 'onbekend']) {
      const found = tokens(`--v-${level}`);
      assert.equal(found.length, 3, `${level} has a light and two dark declarations`);
      assert.equal(found[0], VERDICT_HEX.light[level], `${level} light`);
      assert.equal(found[1], VERDICT_HEX.dark[level], `${level} dark`);
      assert.equal(found[2], VERDICT_HEX.dark[level], `${level} dark fallback`);
    }
    const detour = tokens('--omleiding');
    assert.deepEqual(detour, [DETOUR_HEX.light, DETOUR_HEX.dark, DETOUR_HEX.dark]);
  });

  it('the overlay has the detour layers and colours lines by the v property', () => {
    const layers = overlayLayers({ theme: 'light', labelFont: ['Noto Sans Regular'], cluster: true });
    const byId = new Map(layers.map((l) => [l.id, l]));
    assert.ok(byId.has(LAYERS.detour));
    assert.ok(byId.has(LAYERS.detourLabel));
    assert.equal(byId.get(LAYERS.detour).source, 'ww-detour');
    assert.equal(JSON.stringify(byId.get(LAYERS.line).paint['line-color']).includes('"v"'), true, 'line colour reads the verdict');
    assert.deepEqual(byId.get(LAYERS.dash).filter, ['all', ['!=', ['get', 'cat'], 'file'], ['==', ['coalesce', ['get', 'v'], 'onbekend'], 'dicht']]);
    assert.equal(verdictScale[0], 'match');
  });

  it('detourCollection builds one LineString or nothing', () => {
    assert.equal(detourCollection(null).features.length, 0);
    assert.equal(detourCollection([[5, 52]]).features.length, 0);
    const fc = detourCollection([[5, 52], [5.1, 52.1]]);
    assert.equal(fc.features[0].geometry.type, 'LineString');
    assert.equal(fc.features[0].geometry.coordinates.length, 2);
  });
});
