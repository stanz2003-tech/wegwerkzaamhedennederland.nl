/**
 * Unit tests for web/src/data/time-phrase.ts: the "tot za 3 okt 10:00" under the answer, after
 * every closed specific, in the list rows and in the detail banner.
 *
 * The safety guard comes first. A time phrase that names an end can suggest a reopening, so:
 *   - back-to-back closed phases report the end of the LAST one;
 *   - a lighter verdict never reaches past a heavier stretch that follows it;
 *   - nothing past `tlTo` is ever stated as an end;
 * and a randomised check over many timelines proves those rules hold for every moment, not only
 * for the hand-written cases.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forecast, timePhrase, verdict } from './helpers/src.mjs';

const { phraseAt, phraseIn, factAt, OPEN_END_PHRASE } = timePhrase;
const { itemVerdict } = forecast;
const { VERDICT_SEVERITY } = verdict;

const ms = (iso) => Date.parse(iso);
const HOUR = 3_600_000;

/** A v4 item with a timeline; start/end of the item follow the timeline unless given. */
function item(tl, extra = {}, props = {}) {
  const ends = tl.map((r) => r[1]);
  return {
    f: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5.1, 52.0] },
      properties: {
        id: 't1', cat: 'werk', sev: 3, title: 'A27 · Houten → Utrecht', road: 'A27', src: 'RWS', imp: 'dicht', per: true,
        start: tl[0]?.[0] ?? '2026-10-01T00:00:00Z',
        ...(ends.includes('') ? {} : { end: ends.sort().at(-1) }),
        ...props,
      },
    },
    d: { tl, ...extra },
  };
}

// Friday 2 October 2026, Europe/Amsterdam is UTC+2.
const FRI_22 = '2026-10-02T20:00:00Z';
const SAT_06 = '2026-10-03T04:00:00Z';
const SAT_10 = '2026-10-03T08:00:00Z';
const SAT_14 = '2026-10-03T12:00:00Z';

describe('phraseAt: the run around the moment', () => {
  it('two back-to-back closed phases give the end of the second one', () => {
    const x = item([[FRI_22, SAT_06, 'dicht'], [SAT_06, SAT_10, 'dicht', ['car', 'bicycle']]]);
    assert.equal(phraseAt(x, 'auto', ms(FRI_22) + HOUR), 'tot za 3 okt 10:00');
  });

  it('a closure followed by a heavier one runs on: rijbaan then weg dicht ends with the second', () => {
    const x = item([[FRI_22, SAT_06, 'rijbaan'], [SAT_06, SAT_10, 'dicht']]);
    assert.equal(phraseAt(x, 'auto', ms(FRI_22) + HOUR), 'tot za 3 okt 10:00');
  });

  it('closed then hinder: "tot X, daarna doorrijden mogelijk"', () => {
    const x = item([[FRI_22, SAT_06, 'dicht'], [SAT_06, SAT_10, 'hinder']]);
    assert.equal(phraseAt(x, 'auto', ms(FRI_22) + HOUR), 'tot za 3 okt 06:00, daarna doorrijden mogelijk');
  });

  it('a lighter verdict never swallows a heavier stretch that follows it', () => {
    const x = item([[FRI_22, SAT_06, 'hinder'], [SAT_06, SAT_10, 'dicht']]);
    assert.equal(phraseAt(x, 'auto', ms(FRI_22) + HOUR), 'tot za 3 okt 06:00, daarna weg dicht');
  });

  it('a phase that does not concern the mode is named after the run', () => {
    const x = item([[FRI_22, SAT_06, 'dicht'], [SAT_06, SAT_10, 'dicht', ['bicycle']]]);
    assert.equal(phraseAt(x, 'auto', ms(FRI_22) + HOUR), "tot za 3 okt 06:00, daarna geldt niet voor auto's");
  });

  it('an open end says so instead of guessing', () => {
    const x = item([[FRI_22, '', 'rijbaan']]);
    assert.equal(phraseAt(x, 'auto', ms(SAT_10)), OPEN_END_PHRASE);
    assert.equal(OPEN_END_PHRASE, 'einde niet opgegeven');
  });

  it('a gap gives the next start; the next stretch for this mode wins over one for cyclists', () => {
    const x = item([[FRI_22, SAT_06, 'dicht'], [SAT_10, SAT_14, 'dicht']]);
    assert.equal(phraseAt(x, 'auto', ms(SAT_06) + HOUR), 'begint za 3 okt 10:00');
    assert.equal(phraseAt(x, 'auto', ms(FRI_22) - HOUR), 'begint vr 2 okt 22:00');
    const cycle = item([[FRI_22, SAT_06, 'dicht', ['bicycle']], [SAT_10, SAT_14, 'dicht']]);
    assert.equal(phraseAt(cycle, 'auto', ms(FRI_22) - HOUR), 'begint za 3 okt 10:00');
  });

  it('after the last stretch nothing is said', () => {
    const x = item([[FRI_22, SAT_06, 'dicht']]);
    assert.equal(phraseAt(x, 'auto', ms(SAT_14)), '');
  });
});

describe('phraseAt: tlTo is a hard stop', () => {
  // tlTo = vr 9 okt 22:00: past it the working times are not known.
  const TL_TO = '2026-10-09T20:00:00Z';

  it('a run that reaches tlTo says "tot minstens <tlTo>, daarna nog niet bekend"', () => {
    const x = item([[FRI_22, TL_TO, 'dicht']], { tlTo: TL_TO });
    assert.equal(phraseAt(x, 'auto', ms(SAT_10)), 'tot minstens vr 9 okt 22:00, daarna nog niet bekend');
  });

  it('a stretch published past tlTo is still cut at tlTo', () => {
    const x = item([[FRI_22, '2026-10-20T20:00:00Z', 'dicht']], { tlTo: TL_TO });
    const fact = factAt(x, 'auto', ms(SAT_10));
    assert.deepEqual(fact, { kind: 'atLeast', until: ms(TL_TO) });
  });

  it('a moment past tlTo gets no phrase at all (the verdict says "nog niet bekend")', () => {
    const x = item([[FRI_22, TL_TO, 'dicht']], { tlTo: TL_TO });
    assert.equal(phraseAt(x, 'auto', ms(TL_TO) + HOUR), '');
  });

  it('an open last stretch with a tlTo: the open end is reported, never a date past tlTo', () => {
    const x = item([[FRI_22, '', 'dicht']], { tlTo: TL_TO });
    assert.equal(phraseAt(x, 'auto', ms(SAT_10)), OPEN_END_PHRASE);
  });
});

describe('phraseAt without a timeline', () => {
  const plain = (props, d = null) => ({ f: { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 52] }, properties: { id: 'p', cat: 'werk', sev: 2, title: 'x', src: 's', imp: 'dicht', ...props } }, d });

  it('uses the item end: the latest possible end (the map has d: null)', () => {
    const x = plain({ start: FRI_22, end: SAT_10, per: true });
    assert.equal(phraseAt(x, 'auto', ms(SAT_06)), 'tot za 3 okt 10:00');
    assert.equal(phraseAt(plain({ start: FRI_22 }), 'auto', ms(SAT_06)), OPEN_END_PHRASE);
    assert.equal(phraseAt(x, 'auto', ms(FRI_22) - HOUR), 'begint vr 2 okt 22:00');
  });

  it('with v3 periods: the end of the running block, or the next start between two blocks', () => {
    const periods = [[FRI_22, SAT_06], ['2026-10-03T20:00:00Z', '2026-10-04T04:00:00Z']];
    const x = plain({ start: FRI_22, end: '2026-10-04T04:00:00Z', per: true }, { periods });
    assert.equal(phraseAt(x, 'auto', ms(FRI_22) + HOUR), 'tot za 3 okt 06:00');
    assert.equal(phraseAt(x, 'auto', ms(SAT_14)), 'begint za 3 okt 22:00');
  });
});

describe('phraseIn: the stretches inside a window', () => {
  const WED = { from: ms('2026-09-29T22:00:00Z'), to: ms('2026-09-30T21:59:59Z') }; // wo 30 sep
  const nights = [
    ['2026-09-29T18:00:00Z', '2026-09-30T03:00:00Z', 'rijbaan'],
    ['2026-09-30T18:00:00Z', '2026-10-01T03:00:00Z', 'rijbaan'],
  ];

  it('a nightly closure on one day: the evening stretch with clock times, the morning one as "tot"', () => {
    assert.equal(phraseIn(item(nights), 'auto', WED.from, WED.to), 'tot wo 30 sep 05:00, wo 30 sep 20:00–05:00');
  });

  it('a stretch covering the whole window is "hele dag" / "het hele weekend"', () => {
    const allWeek = item([['2026-09-28T00:00:00Z', '2026-10-06T00:00:00Z', 'dicht']]);
    assert.equal(phraseIn(allWeek, 'auto', WED.from, WED.to), 'hele dag');
    assert.equal(phraseIn(allWeek, 'auto', ms('2026-10-02T18:00:00Z'), ms('2026-10-05T04:00:00Z')), 'het hele weekend');
  });

  it('more than two stretches: "o.a." and the first two', () => {
    const many = item([
      ['2026-10-02T18:00:00Z', '2026-10-02T20:00:00Z', 'dicht'],
      ['2026-10-03T18:00:00Z', '2026-10-03T20:00:00Z', 'dicht'],
      ['2026-10-04T18:00:00Z', '2026-10-04T20:00:00Z', 'dicht'],
    ]);
    assert.equal(phraseIn(many, 'auto', ms('2026-10-02T10:00:00Z'), ms('2026-10-05T04:00:00Z')), 'o.a. vr 2 okt 20:00–22:00, za 3 okt 20:00–22:00');
  });

  it('only the stretches with the pill\'s level or heavier count', () => {
    const mixed = item([
      ['2026-09-30T06:00:00Z', '2026-09-30T10:00:00Z', 'hinder'],
      ['2026-09-30T18:00:00Z', '2026-10-01T03:00:00Z', 'dicht'],
    ]);
    assert.equal(phraseIn(mixed, 'auto', WED.from, WED.to), 'wo 30 sep 20:00–05:00');
  });

  it('says nothing for a mode the window does not concern', () => {
    const cycle = item([['2026-09-30T06:00:00Z', '2026-09-30T10:00:00Z', 'dicht', ['bicycle']]], {}, { veh: ['bicycle'] });
    assert.equal(phraseIn(cycle, 'auto', WED.from, WED.to), '');
  });

  it('a window reaching past tlTo says that the rest is not known', () => {
    const x = item([['2026-09-30T06:00:00Z', '2026-09-30T10:00:00Z', 'dicht']], { tlTo: '2026-09-30T12:00:00Z' });
    assert.equal(phraseIn(x, 'auto', WED.from, WED.to), 'wo 30 sep 08:00–12:00, daarna nog niet bekend');
  });

  it('without a timeline the item span is clipped to the window', () => {
    const x = { f: { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 52] }, properties: { id: 'n', cat: 'werk', sev: 2, title: 'x', src: 's', imp: 'rijbaan', start: '2026-09-30T18:00:00Z', end: '2026-10-01T03:00:00Z' } }, d: null };
    assert.equal(phraseIn(x, 'auto', WED.from, WED.to), 'wo 30 sep 20:00–05:00');
  });
});

/* ----------------------------- randomised safety ----------------------------- */

/** Small deterministic PRNG (mulberry32), so a failure can be replayed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IMPACTS = ['dicht', 'rijbaan', 'hinder', 'geen'];
const sev = (level) => VERDICT_SEVERITY.indexOf(level);
const closure = (level) => level === 'dicht' || level === 'rijbaan';

function randomItem(rand) {
  const t0 = ms('2026-10-01T00:00:00Z');
  let t = t0 + Math.floor(rand() * 24) * HOUR;
  const tl = [];
  const n = 2 + Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) {
    if (rand() < 0.3) t += (1 + Math.floor(rand() * 10)) * HOUR; // a gap
    const end = t + (1 + Math.floor(rand() * 30)) * HOUR;
    const open = i === n - 1 && rand() < 0.15;
    const veh = rand() < 0.2 ? ['bicycle'] : rand() < 0.1 ? ['car'] : undefined;
    tl.push([new Date(t).toISOString(), open ? '' : new Date(end).toISOString(), IMPACTS[Math.floor(rand() * IMPACTS.length)], ...(veh ? [veh] : [])]);
    t = end;
  }
  const tlTo = rand() < 0.4 ? new Date(t0 + Math.floor(rand() * 200) * HOUR).toISOString() : undefined;
  return { x: item(tl, tlTo ? { tlTo } : {}), t0, last: t, tlTo: tlTo ? ms(tlTo) : Number.NaN };
}

describe('randomised: the stated end never suggests a reopening that is not there', () => {
  it('holds for 400 random timelines at every hour', () => {
    const rand = rng(20261003);
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const { x, t0, last, tlTo } = randomItem(rand);
      for (let at = t0; at < last + 2 * HOUR; at += HOUR) {
        const fact = factAt(x, 'auto', at);
        if (!fact || fact.kind === 'starts') continue;
        const level = itemVerdict(x, 'auto', at).level;
        const runEnd = fact.kind === 'until' ? fact.end : fact.kind === 'atLeast' ? fact.until : Math.min(last + 2 * HOUR, Number.isFinite(tlTo) ? tlTo : Infinity);
        // Never a stated end past what the timeline knows.
        if (Number.isFinite(tlTo) && fact.kind === 'until') assert.ok(fact.end < tlTo, `end past tlTo (seed item ${k})`);
        if (fact.kind === 'atLeast') assert.equal(fact.until, tlTo);
        // Inside the run: the same level, or heavier while closed — a lighter verdict never
        // hides a heavier stretch, and a closure is never "tot X" while a lighter moment sits inside.
        for (let t = at; t < runEnd; t += 15 * 60_000) {
          const l = itemVerdict(x, 'auto', t).level;
          const ok = l === level || (closure(level) && sev(l) < sev(level));
          assert.ok(ok, `item ${k}: at ${new Date(at).toISOString()} level ${level}, but ${l} at ${new Date(t).toISOString()} before the stated end`);
        }
        // Right at the stated end the run really stops: a closure stated to end at X is not
        // still (as) closed at X. ("Geen hinder tot X" followed by a gap is still no hindrance;
        // that is no reopening, so the lightest levels are not held to this.)
        if (fact.kind === 'until' && sev(level) <= sev('hinder')) {
          const l = itemVerdict(x, 'auto', fact.end).level;
          const continues = l === level || (closure(level) && sev(l) < sev(level));
          assert.ok(!continues, `item ${k}: the run goes on past the stated end ${new Date(fact.end).toISOString()}`);
        }
        checked += 1;
      }
    }
    assert.ok(checked > 2000, `enough moments were checked (${checked})`);
  });
});
