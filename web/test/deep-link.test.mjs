/**
 * A link from a road, place or list page to one melding (`/#id=…`, moved to `/?id=…` on load).
 * Reported on 2026-11-11: a *planned* melding (`NDW03_537000`, only in werk-gepland.geojson) never
 * opened — the map dropped the id and showed the default view, while an active one opened fine.
 * Two causes: the lookup only saw werk-gepland while the question already looked ahead (so after
 * loading it for the link the melding was still "missing"), and a werk-gepland load already in
 * flight (a link with `t=` or `dag=`) was not waited for.
 *
 * Covered here: the lookup (ui/deep-link.ts), the item index of the map page (ui/map-data.ts)
 * and the moment a deep-linked item is shown at (ui/map-selection.ts `whenShowing`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { deepLink, mapData, mapSelection, urlState } from './helpers/src.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../fixtures/data/${name}`, import.meta.url), 'utf8')).features;
const actueel = read('werk-actueel.geojson');
const gepland = read('werk-gepland.geojson');
const live = read('live.geojson');
/** The fixture base moment (scripts/make-fixtures.mjs `--now` default). */
const NOW = Date.parse('2026-09-09T12:00:00Z');
const { DEFAULT_URL_STATE } = urlState;

const ACTIVE = actueel[0];
const PLANNED = gepland.find((f) => Date.parse(f.properties.start) > NOW);
const BRIDGE = live.find((f) => f.properties.cat === 'brug');
assert.ok(ACTIVE && PLANNED && BRIDGE, 'the fixtures need an active item, a planned one and a bridge opening');

/** A stand-in for the map page's data: `find` sees werk-gepland only once its load resolved. */
function fakeData({ start = [...live, ...actueel], planned = gepland, fails = false } = {}) {
  let loaded = false;
  let pending = null;
  const calls = { ensure: 0 };
  const all = () => (loaded ? [...start, ...planned] : start);
  const data = {
    find: (id) => all().find((f) => f.properties.id === id),
    geplandLoaded: () => loaded,
    ensureGepland: () => {
      calls.ensure++;
      pending ??= new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
        if (fails) pending = null;
        else loaded = true;
      });
      return pending;
    },
  };
  return { data, calls };
}

describe('deep link lookup (ui/deep-link.ts)', () => {
  it('opens an active melding from the start data without loading werk-gepland', async () => {
    const { data, calls } = fakeData();
    const result = await deepLink.lookupDeepLink(ACTIVE.properties.id, data);
    assert.equal(result.kind, 'found');
    assert.equal(result.feature, ACTIVE);
    assert.equal(calls.ensure, 0);
  });

  it('opens a bridge opening that is in live.geojson without loading werk-gepland', async () => {
    const { data, calls } = fakeData();
    const result = await deepLink.lookupDeepLink(BRIDGE.properties.id, data);
    assert.equal(result.kind, 'found');
    assert.equal(result.feature, BRIDGE);
    assert.equal(calls.ensure, 0);
  });

  it('loads werk-gepland for a melding that is only planned, then opens it', async () => {
    const { data, calls } = fakeData();
    const result = await deepLink.lookupDeepLink(PLANNED.properties.id, data);
    assert.equal(result.kind, 'found');
    assert.equal(result.feature, PLANNED);
    assert.equal(calls.ensure, 1);
  });

  it('waits for a werk-gepland load already in flight (a link that carries t= or dag=)', async () => {
    const { data, calls } = fakeData();
    void data.ensureGepland(); // start() kicked it off because the question looks ahead
    const result = await deepLink.lookupDeepLink(PLANNED.properties.id, data);
    assert.equal(result.kind, 'found');
    assert.equal(result.feature, PLANNED);
    assert.equal(calls.ensure, 2, 'joined the load in flight instead of giving up');
  });

  it('does not load werk-gepland again once it is in', async () => {
    const { data, calls } = fakeData();
    await data.ensureGepland();
    const result = await deepLink.lookupDeepLink('NDW03_bestaat_niet', data);
    assert.equal(result.kind, 'gone');
    assert.equal(calls.ensure, 1);
  });

  it('calls a melding gone only when it is in none of the files (ended, or a bridge opening that is over)', async () => {
    const { data } = fakeData();
    const result = await deepLink.lookupDeepLink('BMS01_NLCRU002020472000143_736747092', data);
    assert.deepEqual(result, { kind: 'gone' });
  });

  it('says unknown, not gone, when werk-gepland could not be loaded', async () => {
    const { data } = fakeData({ fails: true });
    const result = await deepLink.lookupDeepLink(PLANNED.properties.id, data);
    assert.deepEqual(result, { kind: 'unknown' });
  });

  it('survives an ensureGepland that rejects', async () => {
    const data = { find: () => undefined, geplandLoaded: () => false, ensureGepland: () => Promise.reject(new Error('offline')) };
    assert.deepEqual(await deepLink.lookupDeepLink(PLANNED.properties.id, data), { kind: 'unknown' });
  });
});

describe('map page item index (ui/map-data.ts)', () => {
  function create(needs = { value: false }, load = async () => gepland) {
    const events = { gepland: 0, errors: 0 };
    const md = mapData.createMapData(
      { needsGepland: () => needs.value, onGepland: () => events.gepland++, onGeplandError: () => events.errors++ },
      load,
    );
    md.setStart({ meta: {}, actueel, live });
    return { md, needs, events };
  }

  it('finds a planned melding once werk-gepland is in, also while the question is "Nu"', async () => {
    const { md, events } = create();
    assert.equal(md.find(PLANNED.properties.id), undefined, 'not in the start data');
    await md.ensureGepland();
    assert.equal(events.gepland, 1);
    assert.equal(md.find(PLANNED.properties.id), PLANNED);
  });

  it('byId follows the question: planned meldingen count as soon as it looks ahead, without a reload', async () => {
    const needs = { value: false };
    const { md } = create(needs);
    await md.ensureGepland();
    assert.equal(md.byId(PLANNED.properties.id), undefined, '"Nu" does not show planned work');
    needs.value = true; // e.g. the deep link moved the question to the melding's start
    assert.equal(md.byId(PLANNED.properties.id), PLANNED);
    assert.ok(md.items().includes(PLANNED));
  });

  it('active and live meldingen are found exactly as before, whatever the question', async () => {
    const needs = { value: false };
    const { md } = create(needs);
    for (const f of [ACTIVE, BRIDGE]) {
      assert.equal(md.byId(f.properties.id), f);
      assert.equal(md.find(f.properties.id), f);
    }
    await md.ensureGepland();
    needs.value = true;
    for (const f of [ACTIVE, BRIDGE]) {
      assert.equal(md.byId(f.properties.id), f);
      assert.equal(md.find(f.properties.id), f);
    }
  });

  it('an id in werk-actueel and werk-gepland resolves to the active one, as the list shows it', async () => {
    const twin = { ...PLANNED, properties: { ...PLANNED.properties, id: ACTIVE.properties.id } };
    const needs = { value: true };
    const { md } = create(needs, async () => [twin]);
    await md.ensureGepland();
    assert.equal(md.find(ACTIVE.properties.id), ACTIVE);
    assert.equal(md.byId(ACTIVE.properties.id), ACTIVE);
  });

  it('a failed werk-gepland load leaves the start data and allows another try', async () => {
    let fail = true;
    const { md, events } = create({ value: false }, async () => {
      if (fail) throw new Error('offline');
      return gepland;
    });
    await md.ensureGepland();
    assert.equal(events.errors, 1);
    assert.equal(md.geplandLoaded(), false);
    assert.equal(md.geplandPending(), null);
    assert.equal(md.find(ACTIVE.properties.id), ACTIVE);
    fail = false;
    await md.ensureGepland();
    assert.equal(md.find(PLANNED.properties.id), PLANNED);
  });
});

describe('the moment a deep-linked melding is shown at (ui/map-selection.ts whenShowing)', () => {
  const { whenShowing, inTime, needsGepland } = mapSelection;
  const NU = { time: 'nu', moment: null, day: null, part: null };

  it('leaves the question alone when it already shows the melding', () => {
    assert.equal(whenShowing(ACTIVE.properties, NU, NOW), null);
    assert.equal(whenShowing(BRIDGE.properties, NU, NOW), null);
    assert.equal(whenShowing(PLANNED.properties, { ...NU, moment: Date.parse(PLANNED.properties.start) }, NOW), null);
  });

  it('moves a planned melding to the moment it starts, where list and map show it', () => {
    const q = whenShowing(PLANNED.properties, NU, NOW);
    assert.deepEqual(q, { time: 'nu', moment: Date.parse(PLANNED.properties.start), day: null, part: null });
    assert.equal(inTime(PLANNED.properties, q, NOW), true);
    assert.equal(needsGepland(q, NOW), true, 'so werk-gepland is part of what the map shows');
  });

  it('every planned fixture melding is shown at its start', () => {
    for (const f of gepland) {
      const q = whenShowing(f.properties, NU, NOW) ?? NU;
      assert.equal(inTime(f.properties, q, NOW), true, f.properties.id);
    }
  });

  it('goes back to "Nu" for a running melding the asked day does not touch', () => {
    const later = { ...DEFAULT_URL_STATE, time: 'nu', moment: Date.parse('2027-03-01T08:00:00Z') };
    const running = { ...ACTIVE.properties, start: '2026-09-01T00:00Z', end: '2026-09-20T00:00Z' };
    assert.deepEqual(whenShowing(running, later, NOW), NU);
  });
});
