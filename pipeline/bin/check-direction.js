#!/usr/bin/env node
/**
 * Check the AlertC direction semantics on real NDW feeds, without the from/to code
 * (`describe()` in src/vild.js): only the raw AlertC codes, the gml line and the VILD
 * point coordinates are used. See README "Direction".
 *
 *   T1  Does the gml line run secondary → primary or primary → secondary?
 *   T2  Two measures with opposite AlertC direction on one stretch (one per carriageway):
 *       with Dutch right-hand traffic, the measure for travel X → Y lies to the RIGHT of the
 *       other one when looking from X to Y. Tested with X → Y = secondary → primary.
 *
 * Both should come out overwhelmingly "secondary → primary" / "right".
 *
 *   node bin/check-direction.js <feed.xml.gz>... [--vild static/vild.json]
 */

import { createReadStream } from 'node:fs';
import { parseArgs } from 'node:util';
import { createGunzip } from 'node:zlib';
import { parseFeed } from '../src/parse.js';
import { loadVild } from '../src/vild.js';

/** Line ends closer than this to both candidate orders tell nothing. */
const UNCLEAR_M = 200;
/** A twin carriageway lies this far from the other line (closer = the same line). */
const TWIN_MIN_M = 3;
const TWIN_MAX_M = 80;
const M_LAT = 110540;
const M_LON = 111320 * Math.cos((52 * Math.PI) / 180);

/** @param {[number, number]} p @returns {[number, number]} */
const xy = ([lon, lat]) => [lon * M_LON, lat * M_LAT];
/** @param {[number, number]} a @param {[number, number]} b */
const dist = (a, b) => Math.hypot((a[0] - b[0]) * M_LON, (a[1] - b[1]) * M_LAT);

/**
 * Nearest point of a polyline to `p`, in local metres.
 * @param {[number, number][]} line
 * @param {[number, number]} p
 */
function nearest(line, p) {
  const P = xy(p);
  let best = { d: Infinity, q: P };
  for (let i = 0; i + 1 < line.length; i++) {
    const A = xy(line[i]);
    const B = xy(line[i + 1]);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2));
    const Q = [A[0] + t * dx, A[1] + t * dy];
    const d = Math.hypot(P[0] - Q[0], P[1] - Q[1]);
    if (d < best.d) best = { d, q: Q };
  }
  return best;
}

/**
 * Situations with exactly one gml line and an AlertC linear location with two known ends.
 * @param {string[]} feeds
 * @param {import('../src/vild.js').Vild} vild
 */
async function collect(feeds, vild) {
  const items = [];
  for (const feed of feeds) {
    await parseFeed(createReadStream(feed).pipe(createGunzip()), (sit) => {
      for (const rec of sit.recs) {
        const lines = rec.locs.filter((l) => l.kind === 'line' && l.line);
        const ac = rec.locs.find((l) => l.alertC?.p && l.alertC.s && l.alertC.p !== l.alertC.s)?.alertC;
        const p = vild.lookup(ac?.p);
        const s = vild.lookup(ac?.s);
        if (lines.length !== 1 || !ac || !p?.lonlat || !s?.lonlat) continue;
        items.push({ id: sit.id, line: lines[0].line, dir: ac.dir, p, s });
        return;
      }
    });
  }
  return items;
}

/** @param {Awaited<ReturnType<typeof collect>>} items */
function lineDirection(items) {
  const out = { sp: 0, ps: 0, unclear: 0 };
  for (const it of items) {
    const a = it.line[0];
    const b = it.line[it.line.length - 1];
    const sp = dist(a, it.s.lonlat) + dist(b, it.p.lonlat);
    const ps = dist(a, it.p.lonlat) + dist(b, it.s.lonlat);
    out[Math.abs(sp - ps) < UNCLEAR_M ? 'unclear' : sp < ps ? 'sp' : 'ps']++;
  }
  return out;
}

/** @param {Awaited<ReturnType<typeof collect>>} items */
function carriagewaySide(items) {
  const out = { right: 0, left: 0, examples: /** @type {string[]} */ ([]) };
  const seen = new Set();
  for (const a of items) {
    for (const b of items) {
      if (a === b || !a.dir || !b.dir || a.dir === b.dir || a.p.road !== b.p.road) continue;
      const ends = new Set([a.p.nr, a.s.nr]);
      if (!ends.has(b.p.nr) && !ends.has(b.s.nr)) continue;
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const S = xy(a.s.lonlat);
      const P = xy(a.p.lonlat);
      const v = [P[0] - S[0], P[1] - S[1]];
      let side = 0;
      let samples = 0;
      for (const q of a.line) {
        const near = nearest(b.line, q);
        if (near.d < TWIN_MIN_M || near.d > TWIN_MAX_M) continue;
        const Q = xy(q);
        side += Math.sign(v[0] * (Q[1] - near.q[1]) - v[1] * (Q[0] - near.q[0])); // > 0: left
        samples++;
      }
      if (samples < 2) continue;
      const right = side < 0;
      out[right ? 'right' : 'left']++;
      if (out.examples.length < 8) {
        out.examples.push(`${a.id} ${a.p.road} ${a.s.name1} → ${a.p.name1} (${a.dir}): ${right ? 'right' : 'LEFT'} of ${b.id}`);
      }
    }
  }
  return out;
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { vild: { type: 'string' } } });
if (positionals.length === 0) {
  process.stderr.write('usage: node bin/check-direction.js <feed.xml.gz>... [--vild static/vild.json]\n');
  process.exit(1);
}
const items = await collect(positionals, loadVild(values.vild));
const t1 = lineDirection(items);
const t2 = carriagewaySide(items);
process.stdout.write(
  [
    `situations with one gml line and AlertC linear (two known ends): ${items.length}`,
    `T1 line runs secondary → primary: ${t1.sp} | primary → secondary: ${t1.ps} | unclear (< ${UNCLEAR_M} m): ${t1.unclear}`,
    `T2 right of its twin looking secondary → primary: ${t2.right} | left: ${t2.left}`,
    ...t2.examples.map((e) => `   ${e}`),
  ].join('\n') + '\n',
);
