import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entityPath, groupEntities, roadKey, sortEntityItems } from '../src/entities.js';
import { entityFileOf, featureOf } from '../src/output.js';

/** Minimal finalized item: only what the grouping looks at. */
function item(id, { road, gemeente, state = 'active', start = '2026-09-01T00:00:00Z' } = {}) {
  const props = { id, cat: 'werk', sev: 2, title: id, start, src: 'x', imp: 'hinder' };
  if (road) props.road = road;
  if (gemeente) props.gemeente = gemeente;
  return { id, role: 'planning', state, cat: 'werk', geometry: { type: 'Point', coordinates: [5, 52] }, mid: [5, 52], props, detail: { id, src: 'x', upd: start } };
}

test('roadKey: carriageway variants, branch letters, case and spaces collapse onto the base road', () => {
  assert.equal(roadKey('A12 hrb'), 'a12');
  assert.equal(roadKey('A15 prb'), 'a15');
  assert.equal(roadKey('a12'), 'a12');
  assert.equal(roadKey('A12'), 'a12');
  assert.equal(roadKey('N 57'), 'n57');
  assert.equal(roadKey('N282A'), 'n282');
  assert.equal(roadKey('s107A'), 's107a');
  assert.equal(roadKey('s107a'), 's107a');
  assert.equal(roadKey('S100'), 's100');
  assert.equal(roadKey('Krakeling'), 'krakeling');
  assert.equal(roadKey(''), undefined);
  assert.equal(roadKey('  '), undefined);
  assert.equal(roadKey(undefined), undefined);
});

test('groupEntities: an item on "A12 hrb" belongs to a12 and to an a12-hrb entry; only entities with items get a group', () => {
  const items = [item('x1', { road: 'A12 hrb' }), item('x2', { road: 'A12' }), item('x3', { road: 'N57' }), item('x4', {})];
  const roads = [
    { road: 'A12', slug: 'a12' },
    { road: 'A12 hrb', slug: 'a12-hrb' },
    { road: 'N57', slug: 'n57' },
    { road: 'A2', slug: 'a2' },
  ];
  const groups = groupEntities(items, roads, []);
  assert.deepEqual(
    groups.map((g) => [g.kind, g.key, g.slug, g.items.map((i) => i.id)]),
    [
      ['road', 'A12', 'a12', ['x1', 'x2']],
      ['road', 'A12 hrb', 'a12-hrb', ['x1', 'x2']],
      ['road', 'N57', 'n57', ['x3']],
    ],
  );
});

test('groupEntities: gemeenten match on slugify(naam) === slugify(item.gemeente), roads sort before gemeenten', () => {
  const items = [item('g1', { gemeente: "'s-Hertogenbosch" }), item('g2', { gemeente: 's-hertogenbosch' }), item('g3', { gemeente: 'Bergen (NH)' }), item('g4', { gemeente: 'Utrecht', road: 'A2' })];
  const gemeenten = [
    { naam: 'Utrecht', slug: 'utrecht' },
    { naam: "'s-Hertogenbosch", slug: 's-hertogenbosch' },
    { naam: 'Bergen (NH)', slug: 'bergen-nh' },
    { naam: 'Zwolle', slug: 'zwolle' },
  ];
  const groups = groupEntities(items, [{ road: 'A2', slug: 'a2' }], gemeenten);
  assert.deepEqual(
    groups.map((g) => [g.kind, g.slug, g.items.map((i) => i.id)]),
    [
      ['road', 'a2', ['g4']],
      ['gemeente', 'bergen-nh', ['g3']],
      ['gemeente', 's-hertogenbosch', ['g1', 'g2']],
      ['gemeente', 'utrecht', ['g4']],
    ],
  );
  assert.equal(groups[1].key, 'Bergen (NH)', 'key is the display name');
  // a duplicated registry slug is written once
  assert.equal(groupEntities(items, [], [gemeenten[0], gemeenten[0]]).length, 1);
});

test('sortEntityItems: active first, then start, then id; the input array is not mutated', () => {
  const items = [
    item('b', { state: 'upcoming', start: '2026-09-20T00:00:00Z' }),
    item('c', { state: 'active', start: '2026-09-05T00:00:00Z' }),
    item('a', { state: 'active', start: '2026-09-05T00:00:00Z' }),
    item('d', { state: 'active', start: '2026-09-01T00:00:00Z' }),
    item('e', { state: 'upcoming', start: '2026-09-15T00:00:00Z' }),
  ];
  const before = items.map((i) => i.id);
  assert.deepEqual(sortEntityItems(items).map((i) => i.id), ['d', 'a', 'c', 'e', 'b']);
  assert.deepEqual(items.map((i) => i.id), before);
  const groups = groupEntities(items.map((i) => ({ ...i, props: { ...i.props, road: 'A2' } })), [{ road: 'A2', slug: 'a2' }], []);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['d', 'a', 'c', 'e', 'b']);
});

test('entityPath and entityFileOf: EntityFile shape with the exact compact feature and detail per item', () => {
  assert.equal(entityPath('road', 'a2'), 'roads/a2.json');
  assert.equal(entityPath('gemeente', 's-hertogenbosch'), 'gemeenten/s-hertogenbosch.json');
  const a = item('a', { road: 'A2' });
  const file = entityFileOf('2026-09-10T12:00:00Z', { kind: 'road', key: 'A2', slug: 'a2', items: [a] });
  assert.deepEqual(Object.keys(file), ['generated', 'kind', 'key', 'slug', 'items']);
  assert.equal(file.generated, '2026-09-01T00:00:00Z', 'the latest upd of the items, not the run time (deterministic bytes)');
  const b = item('b', { road: 'A2', start: '2026-09-03T00:00:00Z' });
  assert.equal(entityFileOf('2026-09-10T12:00:00Z', { kind: 'road', key: 'A2', slug: 'a2', items: [a, b] }).generated, '2026-09-03T00:00:00Z');
  const noUpd = { ...a, detail: { id: 'a' } };
  assert.equal(entityFileOf('2026-09-10T12:00:00Z', { kind: 'road', key: 'A2', slug: 'a2', items: [noUpd] }).generated, '2026-09-10T12:00:00Z', 'run time only as a fallback');
  assert.equal(file.kind, 'road');
  assert.equal(file.key, 'A2');
  assert.equal(file.slug, 'a2');
  assert.deepEqual(Object.keys(file.items[0]), ['f', 'd']);
  assert.deepEqual(file.items[0].f, featureOf(a));
  assert.equal(file.items[0].f.geometry, a.geometry, 'geometry included');
  assert.equal(file.items[0].d, a.detail);
});
