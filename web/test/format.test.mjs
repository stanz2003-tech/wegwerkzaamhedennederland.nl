/**
 * Unit tests for web/src/ui/format.ts (Dutch formatting: dates in Europe/Amsterdam,
 * durations, status lines, impact labels, numbers).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { format } from './helpers/src.mjs';

const {
  delayLabel, directionLabel, esc, fmtDate, fmtDateTimeFull, fmtDay, fmtDayTime, fmtDuration,
  fmtPeriod, fmtPeriodMs, fmtRemaining, fmtTime, fmtWeekdayShort, formatCount, hindLabel,
  lanesLabel, plural, probabilityLabel, queueLabel, relatedIds, relatedNote, sourceLabel, statusLine,
  subLabel, vehiclesLabel,
} = format;

const ms = (iso) => Date.parse(iso);
/** Wednesday 9 September 2026, 14:00 Europe/Amsterdam. */
const NOW = ms('2026-09-09T12:00:00Z');
/** Saturday 12 September 2026, 22:00 Europe/Amsterdam (CEST). */
const SAT_22 = ms('2026-09-12T20:00:00Z');
/** Monday 5 January 2026, 08:05 Europe/Amsterdam (CET). */
const WINTER = ms('2026-01-05T07:05:00Z');

describe('date and time formatting (Europe/Amsterdam, nl-NL)', () => {
  it('formats times in local time in both summer and winter', () => {
    assert.equal(fmtTime(SAT_22), '22:00');
    assert.equal(fmtTime(WINTER), '08:05');
  });

  it('formats days without abbreviation dots', () => {
    assert.equal(fmtDay(SAT_22), 'za 12 sep');
    assert.equal(fmtDay(WINTER), 'ma 5 jan');
  });

  it('formats day + time without a comma', () => {
    assert.equal(fmtDayTime(SAT_22), 'za 12 sep 22:00');
    assert.equal(fmtDayTime(WINTER), 'ma 5 jan 08:05');
  });

  it('formats long dates and full date-times', () => {
    assert.equal(fmtDate(SAT_22), '12 september 2026');
    assert.equal(fmtDateTimeFull(SAT_22), 'zaterdag 12 september 2026 om 22:00');
  });

  it('formats a short weekday', () => {
    assert.equal(fmtWeekdayShort(SAT_22), 'za');
    assert.equal(fmtWeekdayShort(WINTER), 'ma');
  });

  it('shows a dash for an unusable timestamp', () => {
    for (const fn of [fmtTime, fmtDay, fmtDayTime, fmtDate, fmtDateTimeFull]) {
      assert.equal(fn(Number.NaN), '–');
      assert.equal(fn(Number.POSITIVE_INFINITY), '–');
    }
  });
});

describe('fmtDuration', () => {
  it('formats minutes, hours, days, weeks, months and years', () => {
    assert.equal(fmtDuration(0), 'minder dan 1 min');
    assert.equal(fmtDuration(20_000), 'minder dan 1 min');
    assert.equal(fmtDuration(30_000), '1 min'); // rounds up to the nearest minute
    assert.equal(fmtDuration(60_000), '1 min');
    assert.equal(fmtDuration(45 * 60_000), '45 min');
    assert.equal(fmtDuration(135 * 60_000), '2 u 15 min');
    assert.equal(fmtDuration(2 * 3_600_000), '2 u');
    assert.equal(fmtDuration(24 * 3_600_000), '1 dag');
    assert.equal(fmtDuration(3 * 86_400_000), '3 dagen');
    assert.equal(fmtDuration(13 * 86_400_000), '13 dagen');
    assert.equal(fmtDuration(20 * 86_400_000), '3 weken');
    assert.equal(fmtDuration(70 * 86_400_000), '2 maanden');
    assert.equal(fmtDuration(400 * 86_400_000), '13 maanden');
    assert.equal(fmtDuration(547 * 86_400_000), '1 jaar');
    assert.equal(fmtDuration(800 * 86_400_000), '2 jaar');
  });

  it('returns nothing for negative or non-finite input', () => {
    assert.equal(fmtDuration(-5), '');
    assert.equal(fmtDuration(Number.NaN), '');
    assert.equal(fmtDuration(Number.POSITIVE_INFINITY), '');
  });
});

describe('fmtRemaining and statusLine', () => {
  it('says how long something still runs', () => {
    assert.equal(fmtRemaining(ms('2026-09-09T14:15:00Z'), NOW), 'nog 2 u 15 min');
    assert.equal(fmtRemaining(ms('2026-09-09T12:45:00Z'), NOW), 'nog 45 min');
    assert.equal(fmtRemaining(Number.POSITIVE_INFINITY, NOW), '');
  });

  it('describes an active item with its remaining time', () => {
    const line = statusLine({ start: '2026-09-09T06:00:00Z', end: '2026-09-09T14:15:00Z' }, NOW);
    assert.deepEqual(line, { kind: 'active', text: 'Nu actief · nog 2 u 15 min' });
  });

  it('describes an active item without an end', () => {
    const line = statusLine({ start: '2026-09-09T06:00:00Z' }, NOW);
    assert.deepEqual(line, { kind: 'active', text: 'Nu actief · einde nog onbekend' });
  });

  it('describes an upcoming item with day + time within a week and a date beyond', () => {
    assert.deepEqual(statusLine({ start: '2026-09-12T20:00:00Z' }, NOW), { kind: 'upcoming', text: 'Start za 12 sep 22:00' });
    assert.deepEqual(statusLine({ start: '2026-10-12T20:00:00Z' }, NOW), { kind: 'upcoming', text: 'Start 12 oktober 2026' });
  });

  it('describes a finished item', () => {
    const line = statusLine({ start: '2026-09-01T06:00:00Z', end: '2026-09-02T14:00:00Z' }, NOW);
    assert.equal(line.kind, 'past');
    assert.equal(line.text, 'Afgelopen · wo 2 sep 16:00');
  });
});

describe('fmtPeriod', () => {
  it('collapses a period inside one day', () => {
    assert.equal(fmtPeriod('2026-09-12T20:00:00Z', '2026-09-12T21:30:00Z'), 'za 12 sep 22:00–23:30');
  });

  it('spells out both ends across days', () => {
    assert.equal(fmtPeriod('2026-09-12T20:00:00Z', '2026-09-14T03:00:00Z'), 'za 12 sep 22:00 – ma 14 sep 05:00');
  });

  it('says "vanaf" without an end', () => {
    assert.equal(fmtPeriod('2026-09-12T20:00:00Z', null), 'vanaf za 12 sep 22:00');
    assert.equal(fmtPeriod('2026-09-12T20:00:00Z', undefined), 'vanaf za 12 sep 22:00');
  });

  it('fmtPeriodMs behaves the same for epoch input', () => {
    assert.equal(fmtPeriodMs(SAT_22, ms('2026-09-12T21:30:00Z')), 'za 12 sep 22:00–23:30');
    assert.equal(fmtPeriodMs(SAT_22, ms('2026-09-14T03:00:00Z')), 'za 12 sep 22:00 – ma 14 sep 05:00');
  });
});

describe('impact labels', () => {
  it('prefers an exact delay in minutes over the band', () => {
    assert.equal(delayLabel('upToTenMinutes', undefined), 'tot 10 minuten');
    assert.equal(delayLabel('upToTenMinutes', 1140), '19 min');
    assert.equal(delayLabel(undefined, 30), '1 min');
    assert.equal(delayLabel(undefined, 0), null);
    assert.equal(delayLabel(undefined, undefined), null);
    assert.equal(delayLabel('longerThanThreeHours', undefined), 'meer dan 3 uur');
  });

  it('formats queue lengths in metres or kilometres', () => {
    assert.equal(queueLabel(400), '400 m');
    assert.equal(queueLabel(620), '600 m');
    assert.equal(queueLabel(1000), '1 km');
    assert.equal(queueLabel(4200), '4,2 km');
    assert.equal(queueLabel(11_500), '11,5 km');
    assert.equal(queueLabel(0), null);
    assert.equal(queueLabel(undefined), null);
  });

  it('labels the hindrance class', () => {
    assert.equal(hindLabel('A'), 'zeer veel hinder');
    assert.equal(hindLabel('E'), 'nauwelijks hinder');
    assert.equal(hindLabel(null), null);
    assert.equal(hindLabel(undefined), null);
  });

  it('labels lanes in plain words, never "0 rijstroken dicht" (taal-6)', () => {
    assert.equal(lanesLabel({ closed: 1, open: 2, total: 3 }), '1 van de 3 rijstroken dicht');
    assert.equal(lanesLabel({ closed: 1, open: 1 }), '1 van de 2 rijstroken dicht');
    assert.equal(lanesLabel({ closed: 2 }), '2 rijstroken dicht');
    assert.equal(lanesLabel({ closed: 1 }), '1 rijstrook dicht');
    assert.equal(lanesLabel({ closed: 0, open: 1 }), 'alle rijstroken open');
    assert.equal(lanesLabel({ open: 2 }), '2 rijstroken open');
    assert.equal(lanesLabel({ total: 2 }), '2 rijstroken');
    assert.equal(lanesLabel(undefined), null);
    assert.equal(lanesLabel({}), null);
  });

  it('prefers from → to over the coded direction', () => {
    assert.equal(directionLabel('both', 'Lunetten', 'Utrecht-Noord'), 'Lunetten → Utrecht-Noord');
    assert.equal(directionLabel(undefined, 'Gorinchem'), 'vanaf Gorinchem (richting niet gemeld)');
    assert.equal(directionLabel(undefined, undefined, 'Breda'), 'richting Breda');
    assert.equal(directionLabel('positive'), null, 'hectometre directions mean nothing to a driver');
    assert.equal(directionLabel('negative'), null);
    assert.equal(directionLabel('both'), 'beide richtingen');
    assert.equal(directionLabel(undefined), null);
  });

  it('labels probability, sub type and vehicles in plain words', () => {
    assert.equal(probabilityLabel('certain'), 'zeker');
    assert.equal(probabilityLabel('probable'), 'Gaat waarschijnlijk door');
    assert.equal(probabilityLabel('riskOf'), 'Misschien');
    assert.equal(probabilityLabel(undefined), null);
    assert.equal(subLabel('roadClosed'), 'weg afgesloten');
    assert.equal(subLabel('stationaryTraffic'), 'stilstaand verkeer');
    assert.equal(subLabel('vehicleObstruction'), 'stilstaand voertuig');
    assert.equal(subLabel('brokenDownVehicle'), 'voertuig met pech');
    assert.equal(subLabel('queueingTraffic'), 'file');
    assert.equal(subLabel('generalObstruction'), 'obstakel op de weg');
    assert.equal(subLabel('bridgeSwingInOperation'), 'brug open');
    assert.equal(subLabel('ietsNieuws'), null);
    assert.equal(subLabel(null), null);
    assert.equal(vehiclesLabel(['lorry', 'bicycle']), 'vrachtverkeer, fietsers');
    assert.equal(vehiclesLabel(['onbekendType']), 'onbekendType');
    assert.equal(vehiclesLabel([]), null);
    assert.equal(vehiclesLabel(undefined), null);
  });
});

describe('numbers and escaping', () => {
  it('formats numbers with Dutch thousand separators', () => {
    assert.equal(formatCount(1_234_567), '1.234.567');
    assert.equal(formatCount(0), '0');
  });

  it('pluralises with the formatted count', () => {
    assert.equal(plural(1, 'melding', 'meldingen'), '1 melding');
    assert.equal(plural(0, 'melding', 'meldingen'), '0 meldingen');
    assert.equal(plural(2367, 'melding', 'meldingen'), '2.367 meldingen');
  });

  it('escapes every character that matters in HTML', () => {
    assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(5), '5');
  });
});

describe('merged double publications (ItemDetail.related)', () => {
  it('says in plain words that one work stood in the data more than once, without ids (taal-6)', () => {
    assert.equal(
      relatedNote(['RWS01_SM1013188_D2']),
      'Deze werkzaamheid stond twee keer in de gegevens (aankondiging en uitvoering); we tonen ze als één melding.',
    );
    assert.equal(
      relatedNote(['NDW03_2100901', 'RWS01_SM1052757_D2']),
      'Deze werkzaamheid stond drie keer in de gegevens (aankondiging en uitvoering); we tonen ze als één melding.',
    );
    assert.equal(relatedNote(['RWS01_SM1013188_D2'])?.includes('RWS01'), false, 'the ids go in the "Melding …" line');
    assert.deepEqual(relatedIds(['', 'NDW03_2100901']), ['NDW03_2100901']);
  });

  it('names the wegbeheerder readably', () => {
    assert.equal(sourceLabel('RWS10'), 'Rijkswaterstaat');
    assert.equal(sourceLabel('WNZ-Z [RWS West-Nederland Zuid District Zuid]'), 'Rijkswaterstaat West-Nederland Zuid District Zuid');
    assert.equal(sourceLabel('NDW06'), 'Nationaal Dataportaal Wegverkeer');
    assert.equal(sourceLabel('Gemeente Utrecht'), 'Gemeente Utrecht');
  });

  it('stays silent when nothing was merged', () => {
    assert.equal(relatedNote(undefined), null);
    assert.equal(relatedNote([]), null);
    assert.equal(relatedNote(['', '  ']), null, 'empty ids are not a merge');
  });
});
