/**
 * "Nu dicht op snelwegen: [A1] [A27] …": each badge leads straight to the road page (one tap to
 * the answer per day, every melding, the questions), carrying the map's vehicle and moment. When
 * the page manifest is not there (yet), a badge stays the button that opens road mode on the map.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closedRoads } from './helpers/src.mjs';

const fakeEl = () => ({ hidden: true, innerHTML: '' });
const ROADS = [
  { road: 'A27', level: 'dicht' },
  { road: 'A1', level: 'rijbaan' },
];

describe('closed motorway badges', () => {
  it('link each badge to its road page when the page exists', () => {
    const el = fakeEl();
    closedRoads.renderClosedRoads(el, ROADS, 'nu', false, (road) => `/weg/${road.toLowerCase()}/?v=fiets`);
    assert.equal(el.hidden, false);
    assert.match(el.innerHTML, /<a class="closed-roads__btn" href="\/weg\/a27\/\?v=fiets"/);
    assert.match(el.innerHTML, /<a class="closed-roads__btn" href="\/weg\/a1\/\?v=fiets"/);
    assert.match(el.innerHTML, /aria-label="A27: weg dicht\. Naar de pagina over de A27"/);
    assert.doesNotMatch(el.innerHTML, /<button/);
  });

  it('keeps the road-mode button for a road without a known page', () => {
    const el = fakeEl();
    closedRoads.renderClosedRoads(el, ROADS, 'nu', false, (road) => (road === 'A27' ? '/weg/a27/' : null));
    assert.match(el.innerHTML, /<a class="closed-roads__btn" href="\/weg\/a27\/"/);
    assert.match(el.innerHTML, /<button type="button" class="closed-roads__btn" data-road="A1"/);
  });

  it('keeps buttons when no page lookup is given (manifest not loaded)', () => {
    const el = fakeEl();
    closedRoads.renderClosedRoads(el, ROADS, 'nu', true);
    assert.equal((el.innerHTML.match(/<button type="button" class="closed-roads__btn"/g) ?? []).length, 2);
    assert.doesNotMatch(el.innerHTML, /<a class="closed-roads__btn"/);
    assert.match(el.innerHTML, /en meer/);
  });

  it('escapes the href', () => {
    const el = fakeEl();
    closedRoads.renderClosedRoads(el, [{ road: 'A27', level: 'dicht' }], 'nu', false, () => '/weg/a27/?v=fiets&dag=2026-11-20');
    assert.match(el.innerHTML, /href="\/weg\/a27\/\?v=fiets&amp;dag=2026-11-20"/);
  });
});
