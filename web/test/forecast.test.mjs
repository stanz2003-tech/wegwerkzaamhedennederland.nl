/**
 * Unit tests for web/src/data/forecast.ts: period-aware moment/window selection and the
 * 7-day strip.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureFiles, readJson } from './helpers/fixtures.mjs';
import { forecast, periods as periodsMod, time, verdict } from './helpers/src.mjs';

const { dayStrip, isActiveAtMoment, itemsForCell, relativeDayLabel, selectAtMoment, selectInWindow, touchesWindow, STRIP_DAYS } = forecast;
const { parsePeriods } = periodsMod;
const { startOfDay, MS } = time;

const NOW = Date.parse('2026-09-09T12:00:00Z'); // Wednesday 14:00 CEST

function item(id, over = {}, d = null) {
  return {
    f: {
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [5.1, 52.1] },
      properties: { id, cat: 'werk', sev: 2, title: id, start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z', src: 'x', imp: 'hinder', ...over },
    },
    d,
  };
}

const nightly = [
  ['2026-09-09T19:00:00Z', '2026-09-10T03:00:00Z'],
  ['2026-09-10T19:00:00Z', '2026-09-11T03:00:00Z'],
  ['2026-09-11T19:00:00Z', '2026-09-12T03:00:00Z'],
];

describe('isActiveAtMoment / touchesWindow', () => {
  const span = { start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z' };
  const p = parsePeriods(nightly);

  it('without periods only the span counts', () => {
    assert.equal(isActiveAtMoment(span, [], NOW), true);
    assert.equal(isActiveAtMoment(span, [], Date.parse('2026-10-01T00:00:00Z')), false);
  });

  it('with periods the moment must fall inside one of them', () => {
    assert.equal(isActiveAtMoment(span, p, NOW), false);
    assert.equal(isActiveAtMoment(span, p, Date.parse('2026-09-09T22:00:00Z')), true);
  });

  it('a window touches when a period overlaps it', () => {
    const from = startOfDay(NOW, 4);
    assert.equal(touchesWindow(span, p, from, startOfDay(NOW, 5) - 1), false, 'no night on day +4 (the Friday night still covers Saturday until 05:00)');
    assert.equal(touchesWindow(span, p, startOfDay(NOW), startOfDay(NOW, 1) - 1), true);
    assert.equal(touchesWindow(span, [], from, from + MS.hour), true);
  });
});

describe('selectAtMoment / selectInWindow', () => {
  const items = [
    item('closed', { imp: 'dicht' }),
    item('cycle', { imp: 'dicht', veh: ['bicycle'] }),
    item('night', { imp: 'dicht', per: true }, { id: 'night', src: 'x', upd: '2026-09-01T00:00:00Z', periods: nightly }),
    item('later', { start: '2026-09-20T00:00:00Z' }),
  ];

  it('at noon: the closure counts, the cycle path is hidden, the nightly work is geen', () => {
    const sel = selectAtMoment(items, 'auto', NOW);
    assert.deepEqual(sel.items.map((x) => x.item.f.properties.id), ['closed', 'night']);
    assert.equal(sel.items[1].verdict.level, 'geen');
    assert.equal(sel.worst, 'dicht');
    assert.deepEqual(sel.hidden.map((x) => x.item.f.properties.id), ['cycle']);
  });

  it('at night the nightly work is dicht; for cyclists the cycle path counts too', () => {
    const night = Date.parse('2026-09-09T22:00:00Z');
    assert.equal(selectAtMoment(items, 'auto', night).items.find((x) => x.item.f.properties.id === 'night').verdict.level, 'dicht');
    const fiets = selectAtMoment(items, 'fiets', NOW);
    assert.ok(fiets.items.some((x) => x.item.f.properties.id === 'cycle'));
    assert.equal(fiets.hidden.length, 0);
  });

  it('a window includes the item that starts inside it', () => {
    const sel = selectInWindow(items, 'auto', NOW, Date.parse('2026-09-21T00:00:00Z'));
    assert.ok(sel.items.some((x) => x.item.f.properties.id === 'later'));
    assert.equal(sel.items[0].verdict.level, 'dicht', 'worst first');
  });
});

describe('live snapshots', () => {
  const { liveAppliesAt, LIVE_HORIZON_MS } = forecast;
  const incident = item('inc', { cat: 'incident', sub: 'accident', imp: 'hinder', start: '2026-09-09T11:30:00Z', end: undefined });
  const file = item('file', { cat: 'file', imp: 'hinder', start: '2026-09-09T11:00:00Z', end: '2026-09-09T13:00:00Z' });

  it('an open-ended incident counts now and within the horizon, not tomorrow', () => {
    assert.equal(liveAppliesAt(incident.f.properties, NOW, NOW), true);
    assert.equal(liveAppliesAt(incident.f.properties, NOW + LIVE_HORIZON_MS, NOW), true);
    assert.equal(liveAppliesAt(incident.f.properties, NOW + MS.day, NOW), false);
    assert.deepEqual(selectAtMoment([incident], 'auto', NOW, NOW).items.map((x) => x.item.f.properties.id), ['inc']);
    assert.deepEqual(selectAtMoment([incident], 'auto', NOW + MS.day, NOW).items, []);
    assert.deepEqual(selectInWindow([incident], 'auto', startOfDay(NOW, 1), startOfDay(NOW, 2) - 1, NOW).items, []);
  });

  it('a live item with an end date and every planned item follow their span', () => {
    assert.equal(liveAppliesAt(file.f.properties, NOW + MS.day, NOW), true);
    assert.equal(liveAppliesAt(item('w').f.properties, NOW + 20 * MS.day, NOW), true);
    // Without `now` nothing is excluded (pure callers that only know the asked moment).
    assert.equal(selectAtMoment([incident], 'auto', NOW + MS.day).items.length, 1);
  });
});

describe('dayStrip', () => {
  const items = [
    item('a', { imp: 'hinder' }),
    item('b', { imp: 'dicht', start: '2026-09-11T06:00:00Z', end: '2026-09-11T20:00:00Z' }),
    item('c', { imp: 'dicht', veh: ['bicycle', 'moped'] }),
    item('n', { imp: 'dicht', per: true }, { id: 'n', src: 'x', upd: '2026-09-01T00:00:00Z', periods: nightly }),
  ];

  it('produces seven cells from today with calendar bounds', () => {
    const cells = dayStrip(items, 'auto', NOW);
    assert.equal(cells.length, STRIP_DAYS);
    assert.equal(cells[0].from, startOfDay(NOW));
    assert.equal(cells[1].from, startOfDay(NOW, 1));
    assert.equal(cells[0].to, cells[1].from - 1);
  });

  it('the worst verdict per day ignores items that do not apply to the mode', () => {
    const auto = dayStrip(items, 'auto', NOW);
    assert.equal(auto[0].worst, 'dicht', 'nightly work tonight');
    assert.equal(auto[2].worst, 'dicht', 'Friday closure');
    assert.equal(auto[4].worst, 'hinder', 'only the lane closure remains');
    assert.equal(auto[4].counts.hinder, 1);
    assert.equal(auto[4].counts.nvt, 0);
    const fiets = dayStrip(items, 'fiets', NOW);
    assert.equal(fiets[4].worst, 'dicht', 'the cycle path counts for cyclists');
  });

  it('itemsForCell returns the items of a cell in input order', () => {
    const cells = dayStrip(items, 'auto', NOW);
    assert.deepEqual(itemsForCell(items, cells[2]).map((x) => x.f.properties.id), ['a', 'b', 'n']);
  });

  it('relativeDayLabel says vandaag / morgen and otherwise the fallback', () => {
    const cells = dayStrip(items, 'auto', NOW);
    assert.equal(relativeDayLabel(cells[0], NOW, 'wo 9'), 'vandaag');
    assert.equal(relativeDayLabel(cells[1], NOW, 'do 10'), 'morgen');
    assert.equal(relativeDayLabel(cells[2], NOW, 'vr 11'), 'vr 11');
  });
});

describe('a picked strip day lists the same items as its cell, worst first (vooruit-1)', () => {
  // forecast-block.ts lists a day with selectInWindow(items, mode, max(cell.from, now), cell.to, now):
  // the call dayStrip makes for the cell. This pins both halves of that promise on every fixture
  // road: the set equals cell.ids, and no row is lighter than the one after it.
  const ROADS = fixtureFiles().filter((f) => f.startsWith('roads/'));
  const FIXTURE_NOW = Date.parse(readJson('meta.json').generated);
  const { VERDICT_SEVERITY } = verdict;

  for (const mode of ['auto', 'vracht', 'fiets']) {
    it(`${mode}: every cell of every fixture road`, () => {
      let checked = 0;
      for (const file of ROADS) {
        const items = readJson(file).items;
        const cells = dayStrip(items, mode, FIXTURE_NOW);
        for (const cell of cells) {
          const sel = selectInWindow(items, mode, Math.max(cell.from, FIXTURE_NOW), cell.to, FIXTURE_NOW);
          const ids = sel.items.map((x) => x.item.f.properties.id);
          assert.deepEqual([...ids].sort(), [...cell.ids].sort(), `${file} ${mode} ${new Date(cell.from).toISOString()}`);
          const ranks = sel.items.map((x) => VERDICT_SEVERITY.indexOf(x.verdict.level));
          for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i - 1] <= ranks[i], `${file}: row ${i} is heavier than row ${i - 1}`);
          if (sel.items.length > 0) assert.equal(sel.items[0].verdict.level, cell.worst, 'the first row carries the cell verdict');
          checked += sel.items.length;
        }
      }
      assert.ok(checked > 0);
    });
  }
});

/* ------------------------------------------------------------------ 14 days, day parts */

const { constantIds, dayParts, heaviestSpan, PAGE_STRIP_DAYS } = forecast;
const RANK = (level) => (level === null ? Infinity : verdict.VERDICT_SEVERITY.indexOf(level));

/** Every night from 2026-09-01 for 40 nights, 21:00–05:00 CEST. */
const everyNight = Array.from({ length: 40 }, (_, i) => {
  const start = Date.parse('2026-09-01T19:00:00Z') + i * MS.day;
  return [new Date(start).toISOString(), new Date(start + 8 * MS.hour).toISOString()];
});

/** The A27 situation of vooruit-2: one closure without an end makes every day "Rijbaan dicht". */
const gorinchemItems = () => [
  item('gor', { imp: 'rijbaan', start: '2026-08-01T00:00:00Z', end: null, woonplaats: 'Gorinchem', road: 'A27' }),
  item('long', { imp: 'hinder', start: '2026-08-01T00:00:00Z', end: '2026-12-01T00:00:00Z', woonplaats: 'Hank', road: 'A27' }),
  item('houten', { imp: 'dicht', per: true, woonplaats: 'Houten', road: 'A27' }, { id: 'houten', src: 'x', upd: '2026-09-01T00:00:00Z', periods: nightly }),
  item('nights', { imp: 'dicht', per: true, end: '2026-11-01T00:00:00Z', woonplaats: 'Lexmond', road: 'A27' }, { id: 'nights', src: 'x', upd: '2026-09-01T00:00:00Z', periods: everyNight }),
  item('fri', { imp: 'hinder', start: '2026-09-11T06:00:00Z', end: '2026-09-11T20:00:00Z', woonplaats: 'Vianen', road: 'A27' }),
  item('cycle', { imp: 'dicht', veh: ['bicycle'], start: '2026-08-01T00:00:00Z', end: null, woonplaats: 'Gorinchem', road: 'A27' }),
];

describe('the 14-day strip (vooruit-8)', () => {
  it('has 14 cells from today, two weeks of calendar days', () => {
    const cells = dayStrip(gorinchemItems(), 'auto', NOW, PAGE_STRIP_DAYS);
    assert.equal(PAGE_STRIP_DAYS, 14);
    assert.equal(cells.length, 14);
    assert.equal(cells[13].from, startOfDay(NOW, 13));
    assert.equal(STRIP_DAYS, 7, 'other callers keep their 7');
  });
});

describe('constantIds: the measures that are the same every day, all day (vooruit-2)', () => {
  it('lifts out the open-ended closure and the long hinder, heaviest first', () => {
    const items = gorinchemItems();
    const cells = dayStrip(items, 'auto', NOW, PAGE_STRIP_DAYS);
    assert.deepEqual(constantIds(cells, items, 'auto', NOW), [
      { id: 'gor', level: 'rijbaan' },
      { id: 'long', level: 'hinder' },
    ]);
  });

  it('a nightly closure on every day is NOT constant: it is not there all day', () => {
    const items = gorinchemItems();
    const cells = dayStrip(items, 'auto', NOW, PAGE_STRIP_DAYS);
    assert.ok(cells.every((c) => c.ids.includes('nights')), 'it touches every day');
    assert.ok(!constantIds(cells, items, 'auto', NOW).some((c) => c.id === 'nights'));
  });

  it('a measure that ends inside the strip is not constant; one cell is no strip', () => {
    const items = [item('short', { imp: 'rijbaan', start: '2026-08-01T00:00:00Z', end: '2026-09-15T00:00:00Z' })];
    const cells = dayStrip(items, 'auto', NOW, PAGE_STRIP_DAYS);
    assert.deepEqual(constantIds(cells, items, 'auto', NOW), []);
    assert.deepEqual(constantIds(cells.slice(0, 1), items, 'auto', NOW), []);
  });

  it('for cyclists the cycle-path closure is the constant one', () => {
    const items = gorinchemItems();
    const cells = dayStrip(items, 'fiets', NOW, PAGE_STRIP_DAYS);
    assert.ok(constantIds(cells, items, 'fiets', NOW).some((c) => c.id === 'cycle' && c.level === 'dicht'));
  });
});

describe('dayParts and heaviestSpan', () => {
  const items = gorinchemItems();
  const cells = dayStrip(items, 'auto', NOW, PAGE_STRIP_DAYS);
  const constants = new Set(constantIds(cells, items, 'auto', NOW).map((c) => c.id));

  it('today: parts that are over are not judged; the evening carries the nightly closure', () => {
    const parts = dayParts(items, 'auto', cells[0], NOW, constants);
    assert.deepEqual(parts.map((p) => p.ahead), [false, false, true, true]);
    assert.equal(parts[0].worst, null);
    assert.equal(parts[3].worst, 'dicht');
  });

  it('without the constants the parts differ between days', () => {
    const fri = dayParts(items, 'auto', cells[2], NOW, constants).map((p) => p.worst);
    assert.deepEqual(fri, ['dicht', 'hinder', 'hinder', 'dicht']);
    const later = dayParts(items, 'auto', cells[10], NOW, constants).map((p) => p.worst);
    assert.deepEqual(later, ['dicht', null, null, 'dicht']);
  });

  it('heaviestSpan names the part hours, round the clock', () => {
    const p = (worsts, ahead = [true, true, true, true]) => worsts.map((worst, i) => ({ part: 'x', from: 0, to: 0, ahead: ahead[i], worst }));
    assert.equal(heaviestSpan(p(['dicht', null, null, 'dicht'])), '18:00–06:00');
    assert.equal(heaviestSpan(p(['hinder', 'rijbaan', 'rijbaan', 'hinder'])), '06:00–18:00');
    assert.equal(heaviestSpan(p(['rijbaan', 'rijbaan', 'rijbaan', 'rijbaan'])), 'hele dag');
    assert.equal(heaviestSpan(p(['dicht', null, 'dicht', null])), '00:00–06:00 en 12:00–18:00');
    assert.equal(heaviestSpan(p([null, 'dicht', 'dicht', 'dicht'], [false, true, true, true])), '06:00–24:00');
    assert.equal(heaviestSpan(p([null, null, null, null])), null);
  });
});

describe('no day or day part is ever lighter than an item in it', () => {
  // Independent recomputation straight from itemVerdict: the heaviest level of the items that
  // touch the window (the inclusion rule of selectInWindow), against what the strip draws.
  const heaviestIn = (items, mode, from, to, now) => {
    let worst = null;
    for (const x of selectInWindow(items, mode, from, to, now).items) {
      const level = forecast.itemVerdict(x.item, mode, undefined, { from, to }).level;
      if (RANK(level) < RANK(worst)) worst = level;
    }
    return worst;
  };
  const ROADS = fixtureFiles().filter((f) => f.startsWith('roads/') || f.startsWith('gemeenten/'));
  const FIXTURE_NOW = Date.parse(readJson('meta.json').generated);
  const SETS = [
    { name: 'gorinchem', items: gorinchemItems(), now: NOW },
    ...ROADS.map((file) => ({ name: file, items: readJson(file).items, now: FIXTURE_NOW })),
  ];

  for (const mode of ['auto', 'vracht', 'fiets']) {
    it(`${mode}: cell headline, parts and the constant edge`, () => {
      let parts = 0;
      for (const { name, items, now } of SETS) {
        const cells = dayStrip(items, mode, now, PAGE_STRIP_DAYS);
        const constants = constantIds(cells, items, mode, now);
        const excluded = new Set(constants.map((c) => c.id));
        const edge = constants[0]?.level ?? null;
        for (const cell of cells) {
          const label = `${name} ${mode} ${new Date(cell.from).toISOString()}`;
          assert.equal(cell.worst, heaviestIn(items, mode, Math.max(cell.from, now), cell.to, now), `${label}: the cell headline is its heaviest item`);
          const all = dayParts(items, mode, cell, now);
          const shown = dayParts(items, mode, cell, now, excluded);
          all.forEach((part, i) => {
            if (!part.ahead) return;
            const from = Math.max(part.from, now);
            const truth = heaviestIn(items, mode, from, part.to, now);
            assert.equal(part.worst, truth, `${label} ${part.part}: the part is its heaviest item`);
            assert.ok(RANK(cell.worst) <= RANK(part.worst), `${label} ${part.part}: the cell is never lighter than a part`);
            // Exclusion may only remove: the bar without the constants is never heavier...
            assert.ok(RANK(shown[i].worst) >= RANK(part.worst), `${label} ${part.part}: exclusion only removes`);
            // ...and bar plus top edge together are never lighter than what is really there.
            const drawn = RANK(shown[i].worst) <= RANK(edge) ? shown[i].worst : edge;
            assert.ok(RANK(drawn) <= RANK(truth), `${label} ${part.part}: bar + edge ${drawn} lighter than ${truth}`);
            parts += 1;
          });
        }
      }
      assert.ok(parts > 0);
    });
  }
});

describe('a picked date on the map: list pills are judged like the answer card (judge)', () => {
  // main.ts judges map features (no detail, d: null) with verdictFor(p, mode, { window }) for a
  // ?dag= window; the card uses selectInWindow on the same features. Same level for every item.
  const data = ['werk-actueel.geojson', 'werk-gepland.geojson', 'live.geojson'].flatMap((f) => readJson(f).features);
  const features = data.map((f) => ({ f, d: null }));
  const FIXTURE_NOW = Date.parse(readJson('meta.json').generated);

  for (const mode of ['auto', 'vracht', 'fiets']) {
    it(`${mode}: no pill is lighter than the card verdict for that item, on every strip day`, () => {
      let checked = 0;
      for (let i = 0; i < PAGE_STRIP_DAYS; i++) {
        const w = time.windowFromNow(time.dayWindow(time.localDateKey(startOfDay(FIXTURE_NOW, i))), FIXTURE_NOW);
        const sel = selectInWindow(features, mode, w.from, w.to, FIXTURE_NOW);
        for (const x of [...sel.items, ...sel.hidden]) {
          const pill = verdict.verdictFor(x.item.f.properties, mode, { window: w }).level;
          assert.ok(RANK(pill) <= RANK(x.verdict.level), `${x.item.f.properties.id}: pill ${pill} vs card ${x.verdict.level}`);
          checked += 1;
        }
      }
      assert.ok(checked > 0);
    });
  }
});
