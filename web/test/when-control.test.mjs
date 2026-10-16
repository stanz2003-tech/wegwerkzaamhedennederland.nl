/**
 * Unit tests for the pure part of web/src/ui/when-control.ts: the words of the folded
 * "Wanneer?" line that replaces the chips and the date row on a phone once a road or place is
 * chosen (review 2026-10-16), so the answer card starts higher on the screen.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { whenControl } from './helpers/src.mjs';

const { whenSummaryText } = whenControl;

describe('the folded "Wanneer?" line names the chosen moment', () => {
  it('a chip in its own word', () => {
    assert.equal(whenSummaryText('nu', null), 'nu');
    assert.equal(whenSummaryText('vandaag', null), 'vandaag');
    assert.equal(whenSummaryText('morgen', null), 'morgen');
    assert.equal(whenSummaryText('weekend', null), 'dit weekend');
  });

  it('a date, a date with a day part, or an exact moment as the date field says it', () => {
    assert.equal(whenSummaryText('nu', { kind: 'day', date: '2026-10-18', part: null }), 'zo 18 okt');
    assert.equal(whenSummaryText('nu', { kind: 'day', date: '2026-10-18', part: 'ochtend' }), 'zo 18 okt, ochtend');
    assert.equal(whenSummaryText('vandaag', { kind: 'moment', at: Date.parse('2026-10-18T06:00:00Z') }), 'zo 18 okt 08:00');
  });
});
