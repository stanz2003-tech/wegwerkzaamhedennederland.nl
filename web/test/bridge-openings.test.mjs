/**
 * The openings list of a bridge page (ui/bridge-openings.ts): the page script and the build
 * (scripts/lib/snapshot.mjs) render it with the same function.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bridgeOpenings } from './helpers/src.mjs';

const { parseOpenings, openingsHtml } = bridgeOpenings;
const NOW = Date.parse('2026-09-09T12:00:00Z'); // wo 9 sep 14:00
const iso = (s) => new Date(Date.parse(s)).toISOString();

describe('parseOpenings', () => {
  it('drops past, broken and reversed openings and sorts the rest', () => {
    const entry = {
      openings: [
        [iso('2026-09-10T08:00:00Z'), iso('2026-09-10T08:10:00Z')],
        [iso('2026-09-09T06:00:00Z'), iso('2026-09-09T06:10:00Z')], // over
        ['geen datum', iso('2026-09-10T08:10:00Z')],
        [iso('2026-09-10T09:00:00Z'), iso('2026-09-10T08:00:00Z')], // reversed
        [iso('2026-09-09T11:55:00Z'), iso('2026-09-09T12:05:00Z')], // running
      ],
    };
    const list = parseOpenings(entry, NOW);
    assert.deepEqual(list.map((o) => new Date(o.start).toISOString()), [iso('2026-09-09T11:55:00Z'), iso('2026-09-10T08:00:00Z')]);
  });

  it('keeps only the coming days when asked', () => {
    const entry = { openings: [[iso('2026-09-10T08:00:00Z'), iso('2026-09-10T08:10:00Z')], [iso('2026-09-20T08:00:00Z'), iso('2026-09-20T08:10:00Z')]] };
    assert.equal(parseOpenings(entry, NOW, 7).length, 1);
    assert.equal(parseOpenings({}, NOW).length, 0);
  });
});

describe('openingsHtml', () => {
  const openings = [
    { start: Date.parse('2026-09-09T11:55:00Z'), end: Date.parse('2026-09-09T12:05:00Z') },
    { start: Date.parse('2026-09-10T08:00:00Z'), end: Date.parse('2026-09-10T08:10:00Z') },
    { start: Date.parse('2026-09-10T15:00:00Z'), end: Date.parse('2026-09-10T15:12:00Z') },
  ];

  it('groups per day with times, the count and the running one marked', () => {
    const html = openingsHtml(openings, NOW);
    assert.equal((html.match(/<li class="bridge-openings__day">/g) ?? []).length, 2);
    assert.match(html, /Vandaag <span class="bridge-openings__count">1 opening<\/span>/);
    assert.match(html, /Morgen <span class="bridge-openings__count">2 openingen<\/span>/);
    assert.match(html, /<time datetime="2026-09-10T08:00:00.000Z">10:00<\/time>–<time datetime="2026-09-10T08:10:00.000Z">10:10<\/time>/);
    assert.equal((html.match(/nu open/g) ?? []).length, 1);
  });

  it('names the days by date instead of "vandaag" when the HTML must outlive the day', () => {
    const html = openingsHtml(openings, NOW, { relativeDays: false });
    assert.doesNotMatch(html, /Vandaag|Morgen|nu open/);
    assert.match(html, /Wo 9 sep/i);
  });
});
