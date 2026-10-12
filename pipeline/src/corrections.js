/**
 * Hand corrections of a publisher's data (`pipeline/static/correcties.json`), for the rare melding
 * whose own text and data plainly disagree and that matters to drivers — the Merwedebrug at
 * Gorinchem: "Langdurige afsluiting fietspad Merwedebrug westzijde", filed as a closure for cars,
 * painted the A27 bridge red while cars cross it at 70 km/u (Rijkswaterstaat's own records).
 *
 * A correction is pinned to one version of one situation and to the exact vehicle list it fixes:
 *   { id, ver, van: ['car'], naar: ['bicycle'], reden }
 * It rewrites `van` → `naar` on the closure records (`roadClosed` / `carriagewayClosures`) of that
 * situation, and nothing else. When the publisher edits the melding (`ver` changes) or the closure
 * no longer reads `van`, the correction does nothing and is reported as expired (`meta.qa`,
 * bin/check-teksten.js): a stale correction can never hide a later closure.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATH = fileURLToPath(new URL('../static/correcties.json', import.meta.url));
const CLOSURE_LANES = new Set(['roadClosed', 'carriagewayClosures']);

/**
 * @typedef {object} Correction
 * @property {string} id       situation id
 * @property {string} ver      situation version (situationVersionTime) the correction was made for
 * @property {string[]} van    the closure's vehicle list as published
 * @property {string[]} naar   what it should be
 * @property {string} reden    shown on the site, one or two Dutch sentences
 */

/** @param {string=} path @returns {Correction[]} */
export function loadCorrections(path = DEFAULT_PATH) {
  return JSON.parse(readFileSync(path, 'utf8')).correcties;
}

/** @param {string[] | undefined} a @param {string[]} b */
function sameList(a, b) {
  return a !== undefined && a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** @param {Correction[]} list */
export function createCorrections(list) {
  /** @type {Map<string, Correction>} */
  const byId = new Map();
  for (const c of list) {
    if (!c.id || !c.ver || !c.van?.length || !c.naar?.length || !c.reden) throw new Error(`correctie ${c.id ?? '?'}: id, ver, van, naar en reden zijn verplicht`);
    byId.set(c.id, c);
  }
  /** @type {string[]} */
  const applied = [];
  /** @type {string[]} */
  const expired = [];

  return {
    /**
     * @param {import('./parse.js').Situation} situation
     * @returns {{ situation: import('./parse.js').Situation, reden?: string }}
     */
    apply(situation) {
      const c = byId.get(situation.id);
      if (!c) return { situation };
      const hits = situation.recs.some((r) => r.lane && CLOSURE_LANES.has(r.lane) && sameList(r.vehicles, c.van));
      if (situation.ver !== c.ver || !hits) {
        expired.push(c.id);
        return { situation };
      }
      applied.push(c.id);
      const recs = situation.recs.map((r) => (r.lane && CLOSURE_LANES.has(r.lane) && sameList(r.vehicles, c.van) ? { ...r, vehicles: [...c.naar] } : r));
      return { situation: { ...situation, recs }, reden: c.reden };
    },
    stats() {
      return { applied: [...applied], expired: [...expired] };
    },
  };
}
