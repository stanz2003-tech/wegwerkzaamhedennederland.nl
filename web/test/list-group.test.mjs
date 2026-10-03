/**
 * Folding list rows (web/src/ui/list-group.ts, overzicht-3). A folded row must never read
 * lighter than any of its members, never mix two clock windows, and never make a melding
 * unreachable: every member stays in the group and in the expansion under the row.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureFiles, readJson } from './helpers/fixtures.mjs';
import { entityFile, entityList, listGroup, listGroupRow, verdict } from './helpers/src.mjs';

const { groupSeries, memberCount, seriesWhen, groupToggleLabel, partsNote } = listGroup;
const { VERDICT_SEVERITY } = verdict;
const NOW = Date.parse('2026-09-27T10:00:00Z');
const rank = (level) => VERDICT_SEVERITY.indexOf(level);
const worstOf = (levels) => levels.reduce((a, b) => (rank(b) < rank(a) ? b : a));

/** A night block 20:00–05:00 Amsterdam (CEST: 18:00Z–03:00Z) starting on 2026-09-<day>. */
function night(id, day, extra = {}) {
  const d = String(day).padStart(2, '0');
  const next = String(day + 1).padStart(2, '0');
  return {
    id,
    road: 'A27',
    title: 'A27 · Lunetten → Nieuwegein',
    start: `2026-09-${d}T18:00:00Z`,
    end: `2026-09-${next}T03:00:00Z`,
    to: 'Nieuwegein',
    level: 'rijbaan',
    pos: [5.15, 52.05],
    ...extra,
  };
}

const levelOf = (r) => r.level;
const fieldsOf = (r) => r;
const group = (rows) => groupSeries(rows, levelOf, fieldsOf);
const ids = (rows) => rows.map((r) => r.id).sort();

describe('groupSeries: a nightly series becomes one row', () => {
  it('folds four nights of the same stretch, direction, verdict and clock window', () => {
    const rows = [night('ma', 28), night('di', 29), night('wo', 30)];
    rows.push({ ...night('do', 30), id: 'do', start: '2026-10-01T18:00:00Z', end: '2026-10-02T03:00:00Z' });
    const groups = group(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].kind, 'series');
    assert.deepEqual(ids(groups[0].members), ['di', 'do', 'ma', 'wo']);
    assert.equal(seriesWhen(groups[0].members), 'ma 28 sep – do 1 okt, 4 nachten · 20:00–05:00');
    assert.equal(groupToggleLabel(groups[0], (m) => m), 'Alle 4 nachten');
  });

  it('lists the real dates when a night is missing, and never says "elke nacht"', () => {
    const rows = [night('ma', 28), night('di', 29), { ...night('do', 28), id: 'do', start: '2026-10-01T18:00:00Z', end: '2026-10-02T03:00:00Z' }];
    const text = seriesWhen(group(rows)[0].members);
    assert.equal(text, 'ma 28, di 29 sep, do 1 okt · nachts 20:00–05:00');
    assert.equal(/elke/.test(text), false);
  });

  it('says "niet elke nacht" for a long series with a gap', () => {
    const days = [1, 2, 3, 4, 6, 7, 8];
    const rows = days.map((d) => night(`n${d}`, d));
    const text = seriesWhen(group(rows)[0].members);
    assert.match(text, /^di 1 sep – di 8 sep, 7 nachten, niet elke nacht · nachts 20:00–05:00$/);
  });

  it('a daytime series has no "nachts"', () => {
    const day = (id, d) => ({ ...night(id, d), start: `2026-09-${d}T07:00:00Z`, end: `2026-09-${d}T13:00:00Z` });
    assert.equal(seriesWhen([day('a', 28), day('b', 29)]), 'ma 28 sep – di 29 sep, 2 dagen · 09:00–15:00');
  });
});

describe('groupSeries: safety', () => {
  it('never merges different verdict levels', () => {
    const rows = [night('a', 28), night('b', 29, { level: 'hinder' }), night('c', 30, { level: 'dicht' })];
    const groups = group(rows);
    assert.equal(groups.length, 3);
    for (const g of groups) assert.equal(new Set(g.members.map(levelOf)).size, 1);
  });

  it('never merges different clock windows', () => {
    const rows = [night('a', 28), night('b', 29), { ...night('c', 30), start: '2026-09-30T19:00:00Z' }];
    const groups = group(rows);
    const c = groups.find((g) => g.members.some((m) => m.id === 'c'));
    assert.equal(c.members.length, 1, '21:00–05:00 is not the 20:00–05:00 series');
    for (const g of groups) {
      const windows = new Set(g.members.map((m) => `${new Date(m.start).getUTCHours()}-${new Date(m.end).getUTCHours()}`));
      assert.equal(windows.size, 1);
    }
  });

  it('never merges different directions or stretches', () => {
    const rows = [night('a', 28), night('b', 29, { to: 'Utrecht' }), night('c', 30, { title: 'A27 · Houten → Lunetten', to: undefined })];
    assert.equal(group(rows).length, 3);
  });

  it('never folds the two directions of a road as parts', () => {
    const base = { road: 'A27', title: 'A27 vanuit Breda', start: '2026-10-12T18:00:00Z', end: '2026-11-20T04:00:00Z', level: 'rijbaan', pos: [4.9, 51.7] };
    const rows = [{ ...base, id: 'n', to: 'Utrecht' }, { ...base, id: 's', to: 'Breda', pos: [4.901, 51.701] }];
    assert.equal(group(rows).filter((g) => g.kind !== 'single').length, 0);
  });

  it('two blocks on the same day are not a series', () => {
    const rows = [night('a', 28), night('b', 28, { id: 'b' })];
    assert.equal(group(rows).filter((g) => g.kind === 'series').length, 0);
  });

  it('a group shows its worst member level, and every member stays reachable', () => {
    const rows = [
      night('a', 28),
      night('b', 29),
      night('c', 30, { level: 'hinder' }),
      { id: 'p1', road: null, title: 'Olivier van Noortweg, Venlo', start: '2026-09-20T06:00:00Z', end: '2026-10-09T15:00:00Z', level: 'dicht', pos: [6.17, 51.37] },
      { id: 'p2', road: null, title: 'Olivier van Noortweg, Venlo', start: '2026-09-20T06:00:00Z', end: '2026-10-09T15:00:00Z', level: 'dicht', pos: [6.171, 51.372] },
      { id: 'p3', road: null, title: 'Olivier van Noortweg, Venlo', start: '2026-09-21T06:00:00Z', end: '2026-10-09T15:00:00Z', level: 'dicht', pos: [6.173, 51.374] },
    ];
    const groups = group(rows);
    for (const g of groups) {
      assert.equal(g.level, worstOf(g.members.map(levelOf)), 'group level is the worst member level');
      assert.equal(levelOf(g.lead), g.level, 'the row shows a member with that level');
    }
    assert.deepEqual(ids(groups.flatMap((g) => g.members)), ids(rows), 'no id lost or doubled');
    assert.equal(memberCount(groups), rows.length);
    const parts = groups.find((g) => g.kind === 'parts');
    assert.deepEqual(ids(parts.members), ['p1', 'p2', 'p3']);
    assert.equal(partsNote(parts.members.length, false), '3 delen van deze straat');
  });

  it('does not fold parts of a street that lie far apart, or without a position', () => {
    const base = { road: null, title: 'Hoofdstraat', start: '2026-09-20T06:00:00Z', end: '2026-10-09T15:00:00Z', level: 'dicht' };
    const rows = [
      { ...base, id: 'x', pos: [5.0, 52.0] },
      { ...base, id: 'y', pos: [6.0, 52.5] },
      { ...base, id: 'z', pos: null },
    ];
    assert.equal(group(rows).filter((g) => g.kind !== 'single').length, 0);
  });

  it('keeps the input order: a group stands where its first member stood', () => {
    const rows = [night('a', 28), { ...night('x', 28), id: 'x', title: 'A27 · Hooipolder → Gorinchem', to: 'Gorinchem' }, night('b', 29)];
    const groups = group(rows);
    assert.deepEqual(groups.map((g) => g.lead.id), ['a', 'x']);
  });
});

describe('group rows in the page lists', () => {
  it('render every member as its own link under the lead row', () => {
    const rows = [night('ma', 28), night('di', 29), night('wo', 30)];
    const g = group(rows)[0];
    const html = listGroupRow.renderGroupHtml(g, (m, extra) => `<a class="item" data-id="${m.id}" href="/?id=${m.id}">${extra.whenText ?? ''}</a>`);
    assert.match(html, /<details class="item-group__more">/);
    for (const r of rows) assert.ok(html.includes(`href="/?id=${r.id}"`), r.id);
    assert.ok(html.includes('ma 28 sep – wo 30 sep, 3 nachten · 20:00–05:00'));
  });

  it('on every fixture entity file: groups carry the worst pill and keep every row', () => {
    const files = fixtureFiles().filter((f) => f.startsWith('roads/') || f.startsWith('gemeenten/'));
    for (const file of files) {
      const items = readJson(file).items;
      const details = new Map(items.map((it) => [it.f.properties.id, it.d]));
      const rows = items.map((it) => entityFile.indexItemFromFeature(it.f));
      for (const mode of ['auto', 'vracht', 'fiets']) {
        for (const at of [NOW, Date.parse(readJson('meta.json').generated)]) {
          const opts = { mode, at, details };
          const groups = entityList.groupRows(rows, at, opts);
          assert.deepEqual(ids(groups.flatMap((g) => g.members)), ids(rows), `${file} ${mode}`);
          for (const g of groups) {
            const levels = g.members.map((m) => entityList.rowVerdict(m, at, opts).level);
            assert.equal(g.level, worstOf(levels), `${file} ${mode}: group level`);
            assert.equal(entityList.rowVerdict(g.lead, at, opts).level, g.level, `${file}: the row shows the worst pill`);
          }
        }
      }
    }
  });
});
