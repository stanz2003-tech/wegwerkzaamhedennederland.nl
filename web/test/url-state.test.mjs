/** Unit tests for web/src/data/url-state.ts (shareable deep-link state). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { types, urlState } from './helpers/src.mjs';

const { DEFAULT_URL_STATE, itemDeepLink, parseUrlState, serializeUrlState } = urlState;
const { CATEGORIES } = types;

describe('parseUrlState', () => {
  it('returns the defaults for an empty query string', () => {
    for (const input of ['', '?', '?x=1']) {
      assert.deepEqual(parseUrlState(input), DEFAULT_URL_STATE);
    }
  });

  it('reads every supported parameter', () => {
    const state = parseUrlState('?cat=werk,file&t=7d&z=9.2&c=5.291,52.132&id=NDW03_2100001&q=a2%20breda');
    assert.deepEqual(state.cats, ['werk', 'file']);
    assert.equal(state.time, '7d');
    assert.equal(state.zoom, 9.2);
    assert.deepEqual(state.center, [5.291, 52.132]);
    assert.equal(state.id, 'NDW03_2100001');
    assert.equal(state.query, 'a2 breda');
  });

  it('accepts a query string with or without the leading question mark', () => {
    assert.deepEqual(parseUrlState('t=30d'), parseUrlState('?t=30d'));
  });

  it('ignores unknown categories and keeps the known ones', () => {
    assert.deepEqual(parseUrlState('?cat=werk,onzin,file').cats, ['werk', 'file']);
    assert.equal(parseUrlState('?cat=onzin').cats, null);
    assert.equal(parseUrlState('?cat=').cats, null);
  });

  it('treats "all categories" as no filter at all', () => {
    assert.equal(parseUrlState(`?cat=${CATEGORIES.join(',')}`).cats, null);
  });

  it('deduplicates categories', () => {
    assert.deepEqual(parseUrlState('?cat=werk,werk,file').cats, ['werk', 'file']);
  });

  it('falls back to the default window for an unknown time id', () => {
    assert.equal(parseUrlState('?t=ooit').time, DEFAULT_URL_STATE.time);
    assert.equal(parseUrlState('?t=weekend').time, 'weekend');
  });

  it('rejects out-of-range or unparsable zoom and centre values', () => {
    assert.equal(parseUrlState('?z=23').zoom, null);
    assert.equal(parseUrlState('?z=-1').zoom, null);
    assert.equal(parseUrlState('?z=veel').zoom, null);
    assert.equal(parseUrlState('?c=200,52').center, null);
    assert.equal(parseUrlState('?c=5.2').center, null);
    assert.equal(parseUrlState('?c=lon,lat').center, null);
    assert.equal(parseUrlState('?z=0').zoom, 0);
  });

  it('caps the id length and truncates the query', () => {
    assert.equal(parseUrlState(`?id=${'x'.repeat(201)}`).id, null);
    assert.equal(parseUrlState(`?id=${'x'.repeat(200)}`).id?.length, 200);
    assert.equal(parseUrlState(`?q=${'a'.repeat(150)}`).query.length, 100);
  });
});

describe('serializeUrlState', () => {
  it('writes nothing when everything is default', () => {
    assert.equal(serializeUrlState(DEFAULT_URL_STATE), '');
  });

  it('omits a category list that covers everything', () => {
    assert.equal(serializeUrlState({ ...DEFAULT_URL_STATE, cats: [...CATEGORIES] }), '');
    assert.equal(serializeUrlState({ ...DEFAULT_URL_STATE, cats: [] }), '');
  });

  it('sorts categories in contract order and keeps commas readable', () => {
    const qs = serializeUrlState({ ...DEFAULT_URL_STATE, cats: ['file', 'werk'] });
    assert.equal(qs, 'cat=werk,file');
    assert.equal(qs.includes('%2C'), false);
  });

  it('rounds zoom to one and centre to three decimals', () => {
    const qs = serializeUrlState({ ...DEFAULT_URL_STATE, zoom: 9.23456, center: [5.291234, 52.132456] });
    assert.equal(qs, 'z=9.2&c=5.291,52.132');
  });

  it('encodes the id and the query', () => {
    const qs = serializeUrlState({ ...DEFAULT_URL_STATE, id: 'AND01_a b', query: 'a2 & n57' });
    assert.ok(qs.includes('id=AND01_a+b'));
    assert.ok(qs.includes('q=a2+%26+n57'));
  });

  it('drops a non-finite zoom', () => {
    assert.equal(serializeUrlState({ ...DEFAULT_URL_STATE, zoom: Number.NaN }), '');
  });
});

describe('round trip', () => {
  const cases = [
    '',
    'cat=werk,file',
    't=weekend',
    'z=9.2&c=5.291,52.132',
    'id=NDW03_2100001',
    'q=breda',
    'cat=afsluiting,brug&t=30d&z=11.0&c=4.478,51.924&id=NLRWS_0005415104&q=a16',
  ];

  it('parse → serialise → parse loses no state', () => {
    for (const qs of cases) {
      const once = parseUrlState(`?${qs}`);
      const serialized = serializeUrlState(once);
      assert.deepEqual(parseUrlState(`?${serialized}`), once, `round trip of "${qs}"`);
    }
  });

  it('serialising is stable: a second pass changes nothing', () => {
    for (const qs of cases) {
      const first = serializeUrlState(parseUrlState(`?${qs}`));
      const second = serializeUrlState(parseUrlState(`?${first}`));
      assert.equal(second, first, `stable for "${qs}"`);
    }
  });

  it('unknown parameters are dropped, not carried along', () => {
    assert.equal(serializeUrlState(parseUrlState('?cat=werk&onbekend=1')), 'cat=werk');
  });
});

describe('itemDeepLink', () => {
  it('builds an absolute link with an encoded id', () => {
    assert.equal(itemDeepLink('NDW03_2100001', 'https://wegwerk.nl'), 'https://wegwerk.nl/?id=NDW03_2100001');
    assert.equal(itemDeepLink('a b&c', 'https://wegwerk.nl'), 'https://wegwerk.nl/?id=a%20b%26c');
  });

  it('works without an origin (server-side rendering)', () => {
    assert.equal(itemDeepLink('x', ''), '/?id=x');
  });
});

describe('place mode in the URL (?plaats= / ?gemeente=)', () => {
  const { parsePlaceParam } = urlState;

  it('round-trips ?plaats= and ?gemeente= as a slug without a name', () => {
    const plaats = parseUrlState('?plaats=almkerk');
    assert.deepEqual(plaats.place, { kind: 'woonplaats', slug: 'almkerk', name: '' });
    assert.equal(serializeUrlState(plaats), 'plaats=almkerk');
    const gemeente = parseUrlState('?gemeente=altena&v=fiets');
    assert.deepEqual(gemeente.place, { kind: 'gemeente', slug: 'altena', name: '' });
    assert.equal(serializeUrlState(gemeente), 'v=fiets&gemeente=altena');
    // A named place serialises to the same slug.
    assert.equal(serializeUrlState({ ...DEFAULT_URL_STATE, place: { kind: 'woonplaats', slug: 's-hertogenbosch', name: "'s-Hertogenbosch" } }), 'plaats=s-hertogenbosch');
  });

  it('road and place are mutually exclusive: road mode wins both ways', () => {
    assert.equal(parseUrlState('?weg=a27&plaats=almkerk').place, null);
    assert.equal(parseUrlState('?weg=a27&plaats=almkerk').road, 'A27');
    const both = { ...DEFAULT_URL_STATE, road: 'A27', place: { kind: 'woonplaats', slug: 'almkerk', name: 'Almkerk' } };
    assert.equal(serializeUrlState(both), 'weg=a27');
  });

  it('drops a slug that gen-pages could not have written', () => {
    for (const bad of ['alm kerk', '-almkerk', 'almkerk-', 'a/b', '../x', 'x'.repeat(81)]) {
      assert.equal(parsePlaceParam(new URLSearchParams({ plaats: bad })), null, bad);
    }
    assert.deepEqual(parsePlaceParam(new URLSearchParams({ plaats: 'ALMKERK' })), { kind: 'woonplaats', slug: 'almkerk', name: '' });
  });

  it('a plaats parameter wins over a gemeente parameter', () => {
    assert.equal(parseUrlState('?plaats=almkerk&gemeente=altena').place.kind, 'woonplaats');
  });
});

describe('writeUrlState and the back button (mobiel-5)', () => {
  const { writeUrlState, detailStepBackAllowed } = urlState;

  /** A minimal window with a history stack, enough for writeUrlState. */
  function fakeWindow(search = '') {
    const stack = [{ state: null, url: `/${search}` }];
    let i = 0;
    const location = { pathname: '/', hash: '' };
    Object.defineProperty(location, 'search', { get: () => (stack[i].url.split('?')[1] ? `?${stack[i].url.split('?')[1]}` : '') });
    return {
      stack,
      location,
      history: {
        get state() {
          return stack[i].state;
        },
        get length() {
          return stack.length;
        },
        pushState(state, _t, url) {
          stack.splice(i + 1);
          stack.push({ state, url });
          i += 1;
        },
        replaceState(state, _t, url) {
          stack[i] = { state, url };
        },
        back() {
          i = Math.max(0, i - 1);
        },
      },
    };
  }

  const wait = () => new Promise((r) => setTimeout(r, 5));

  it('pushes a step at once, keeps the marker on later replaces, and writes a pending replace first', async () => {
    const w = fakeWindow();
    globalThis.window = w;
    try {
      assert.equal(detailStepBackAllowed(), false, 'nothing pushed yet in this test window');
      const road = { ...DEFAULT_URL_STATE, road: 'A27' };
      // A pending camera replace, then the step: the old entry must keep that camera.
      writeUrlState({ ...DEFAULT_URL_STATE, zoom: 9 }, 50);
      assert.equal(writeUrlState(road, { push: true }), true);
      assert.deepEqual(w.stack.map((e) => e.url), ['/?z=9.0', '/?weg=a27']);
      assert.deepEqual(w.history.state, { wegwerk: true });
      // Opening an item: its own entry, marked as a detail.
      writeUrlState({ ...road, id: 'x1' }, { push: true, marker: { wegwerk: true, detail: true } });
      assert.equal(detailStepBackAllowed(), true);
      // A camera move afterwards replaces the entry and keeps the marker.
      writeUrlState({ ...road, id: 'x1', zoom: 12 }, 0);
      await wait();
      assert.equal(w.stack.length, 3);
      assert.equal(w.stack[2].url, '/?z=12.0&id=x1&weg=a27');
      assert.equal(detailStepBackAllowed(), true);
      // Back: the road entry is no detail, so "Terug" would not step back from there.
      w.history.back();
      assert.equal(detailStepBackAllowed(), false);
    } finally {
      delete globalThis.window;
    }
  });

  it('does not push when the address would not change, and a number still means delayMs', async () => {
    const w = fakeWindow('?weg=a27');
    globalThis.window = w;
    try {
      assert.equal(writeUrlState({ ...DEFAULT_URL_STATE, road: 'A27' }, { push: true }), false);
      assert.equal(w.stack.length, 1);
      writeUrlState({ ...DEFAULT_URL_STATE, road: 'A2' }, 0);
      await wait();
      assert.deepEqual(w.stack.map((e) => e.url), ['/?weg=a2']);
    } finally {
      delete globalThis.window;
    }
  });
});
