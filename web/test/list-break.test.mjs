/**
 * The break in the list of meldingen (ui/entity-list.ts): on a phone a busy place has a list of
 * 6,000 to 7,400 px without anything between the ad above it and the one far below. The break is
 * the spot for one ad slot inside the list: after the first dozen rows, never in a short list and
 * never inside a folded group. The DOM side (the slot stays in the page while the list is rebuilt
 * around it) needs a browser; the placement rule is pure and tested here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { entityList } from './helpers/src.mjs';

const { listBreakAt, BREAK_AFTER_ROWS, BREAK_MIN_ROWS_AFTER } = entityList;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const open = (...rows) => rows.map((n) => ({ rows: n }));

describe('listBreakAt', () => {
  it('a long first group is split after the first dozen rows', () => {
    assert.deepEqual(listBreakAt(open(42, 30)), { section: 0, row: BREAK_AFTER_ROWS });
    assert.equal(BREAK_AFTER_ROWS, 12);
  });

  it('a short "Nu actief" and a long "Gepland": the break falls in the second group', () => {
    // /plaats/maarssen/ on 16 Nov 2026: 6 active, 17 planned.
    assert.deepEqual(listBreakAt(open(6, 17)), { section: 1, row: 6 });
  });

  it('exactly a dozen rows in the first group: the break stands between the two groups', () => {
    assert.deepEqual(listBreakAt(open(12, 10)), { section: 1, row: 0 });
  });

  it('a list too short to have rows after the break gets none inside it', () => {
    assert.equal(listBreakAt(open(6)), null);
    assert.equal(listBreakAt(open(8, 7)), null, `fewer than ${BREAK_AFTER_ROWS} + ${BREAK_MIN_ROWS_AFTER} rows`);
    assert.deepEqual(listBreakAt(open(8, 8)), { section: 1, row: 4 }, 'exactly enough');
    assert.equal(listBreakAt([]), null);
  });

  it('a folded group ends the count: the break never goes inside it', () => {
    assert.equal(listBreakAt([{ rows: 5 }, { rows: 40, collapsed: true }]), null);
    assert.deepEqual(listBreakAt([{ rows: 20 }, { rows: 40, collapsed: true }]), { section: 0, row: 12 });
    assert.equal(listBreakAt([{ rows: 14 }, { rows: 40, collapsed: true }]), null, 'the folded rows do not count as rows after the break');
  });

  it('the break always leaves rows on both sides of a split group or stands on its edge', () => {
    for (const counts of [[13, 3], [1, 1, 30], [12, 4], [30], [11, 1, 4]]) {
      const at = listBreakAt(open(...counts));
      assert.ok(at, counts.join(','));
      assert.ok(at.row >= 0 && at.row < counts[at.section], counts.join(','));
      const above = counts.slice(0, at.section).reduce((n, c) => n + c, 0) + at.row;
      assert.equal(above, BREAK_AFTER_ROWS, counts.join(','));
    }
  });
});

describe('the slot in the list', () => {
  const FEED = '<div class="ad-slot ad-slot--article ad-slot--feed" data-ad-slot="feed" data-list-break aria-hidden="true"></div>';
  const ads = read('../src/ui/ads.ts');
  const list = read('../src/ui/entity-list.ts');

  it('road, place and bridge pages carry it inside the list, after the rows the build wrote', () => {
    for (const name of ['road', 'place', 'bridge']) {
      assert.ok(read(`../templates/${name}.html`).includes(`{{{snapshotList}}}${FEED}</div>`), name);
    }
    assert.doesNotMatch(read('../templates/list.html'), /data-list-break/, 'the list pages keep their one slot');
  });

  it('it is filled on one column only: a wide screen already has two ads side by side', () => {
    assert.match(ads, /if \(name === 'feed'\) return window\.matchMedia\(TWO_COLUMNS\)\.matches \? '' : slots\.feed \|\| slots\.article;/);
    assert.doesNotMatch(ads, /new Set<SlotName>\(\[[^\]]*'feed'/, 'it waits for the reader like the slot under the list');
  });

  it('no renderer takes the slot out of the page: an ad that leaves the document reloads', () => {
    const writers = list.slice(list.indexOf('function setListContent'));
    assert.doesNotMatch(writers, /root\.innerHTML\s*=/, 'innerHTML on the list would destroy the slot');
    assert.match(list, /for \(const child of Array\.from\(root\.childNodes\)\) if \(child !== keep\) child\.remove\(\);\s*keep\.before\(\.\.\.above\);\s*keep\.after\(\.\.\.below\);/);
    assert.doesNotMatch(read('../src/pages/entity-page.ts'), /listEl\.innerHTML\s*=/);
  });

  it('the list is only split while the slot shows or may still show an ad', () => {
    // The slot's own display, not offsetParent: the list is hidden while a melding is open
    // (`#id=…` deep link), and the first render must still put the break in its place.
    assert.match(list, /return el !== null && !el\.hidden && getComputedStyle\(el\)\.display !== 'none';/);
    assert.doesNotMatch(list, /offsetParent/);
    assert.match(list, /breakIsLive\(listBreak\(root\)\) \? listBreakAt\(/);
  });

  it('the second part of a split group is named for screen readers', () => {
    assert.match(list, /tail\.setAttribute\('role', 'group'\);\s*tail\.setAttribute\('aria-label', `\$\{section\.title \?\? 'Meldingen'\}, vervolg`\);/);
  });
});
