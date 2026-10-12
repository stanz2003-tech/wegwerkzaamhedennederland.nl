/**
 * Consistency check: does what the site says agree with what the publisher wrote?
 *
 * The verdict (src/impact.js) is read from the DATEX measure records. The same situation also
 * carries the publisher's own words: Melvin's "gevolg voor het verkeer" drop-down ("Weg dicht in
 * beide richtingen") and free text ("Langdurige afsluiting fietspad Merwedebrug westzijde"). When
 * the two disagree, a visitor sees "Weg dicht" over a text about a cycle path and stops trusting
 * the site. This module compares them after the verdict is final (after roll-up and de-duplication)
 * and never changes a verdict: impact.js already reads the label and "is afgesloten" where that
 * can only make the verdict heavier, and reading the text the other way was tried and removed
 * (impact.js, 2026-09-21) because it told drivers they could pass closed streets.
 *
 * Checks in VISIBLE_CHECKS go to the item's detail as `chk` and the site explains them; the
 * others only reach the run report (`qa` in meta.json) so their counts can be watched.
 *
 * | Code              | Shown | When                                                                          |
 * |-------------------|-------|-------------------------------------------------------------------------------|
 * | `gevolg-dicht`    | yes   | the verdict comes from Melvin's label, not from a closure record               |
 * | `tekst-dicht`     | yes   | the verdict comes from a sentence like "De A15 is afgesloten" plus a detour     |
 * | `tekst-fietspad`  | yes   | closed for cars, while the text only names a cycle/foot path as closed          |
 * | `gevolg-geen`     | yes   | closed, while the label says "Geen gevolgen voor verkeer"                       |
 * | `gevolg-langzaam` | yes   | closed for cars, while the label says "Beperking voor langzaam verkeer"         |
 * | `gevolg-fiets`    | no    | the label says "weg dicht", the closure record only lists bicycles or mopeds    |
 * | `hinderklasse`    | no    | closed, while the hindrance class is D/E ("weinig/nauwelijks hinder")           |
 * | `snelheid`        | no    | the text names a speed limit the records do not publish (or another one)        |
 */

import { closedByText, sentencesOf } from './impact.js';

/** @typedef {'gevolg-dicht'|'tekst-dicht'|'tekst-fietspad'|'gevolg-geen'|'gevolg-langzaam'|'gevolg-fiets'|'hinderklasse'|'snelheid'} CheckCode */
/** @typedef {{ c: CheckCode, q?: string }} Check */
/** @typedef {{ key: string, text: string }} Gevolg */

/**
 * @typedef {object} CheckInput
 * @property {string} imp                       final verdict of the item
 * @property {string[]=} veh
 * @property {'gevolg'|'tekst'=} by             what impactOf() read the verdict from, when not a record
 * @property {Gevolg=} gevolg
 * @property {(string | undefined)[]} texts     the publisher's comments, description, cause
 * @property {string=} hind
 * @property {number=} spd
 */

/** @type {ReadonlySet<CheckCode>} */
export const VISIBLE_CHECKS = new Set(['gevolg-dicht', 'tekst-dicht', 'tekst-fietspad', 'gevolg-geen', 'gevolg-langzaam']);

/** Melvin's six "gevolg voor het verkeer" labels, heaviest first (title.js demotes the same six). */
const GEVOLG_LABELS = [
  'weg dicht in beide richtingen',
  'weg dicht in een richting',
  'verminderd aantal rijstroken beschikbaar',
  'snelheidsbeperking',
  'beperking voor langzaam verkeer',
  'geen gevolgen voor verkeer',
];
const CLOSED = new Set(['dicht', 'rijbaan']);
const LABEL_CLOSED = new Set(['weg dicht in beide richtingen', 'weg dicht in een richting']);

/** A sentence that closes a cycle or foot path ("afsluiting fietspad …", "het voetpad is dicht"). */
const PATH = String.raw`(?:(?:brom)?fiets|voet|wandel|ruiter)(?:pad|paden|strook|stroken|tunnel|brug|gangersbrug)|trottoirs?|stoep`;
const CLOSING = String.raw`afsluiting|afgesloten|dicht|gesloten|gestremd|stremming`;
const PATH_CLOSED_RE = new RegExp(String.raw`\b(?:(?:${CLOSING})\b[^.\n|]{0,40}\b(?:${PATH})\b|(?:${PATH})\b[^.\n|]{0,40}\b(?:${CLOSING}))\b`, 'i');
/** Anything that says the road itself is (also) shut: then the path is a detail, not the subject. */
const ROAD_CLOSED_RE =
  /\b(?:weg\s*dicht|wegafsluiting|afsluiting\s+van\s+de\s+(?:weg|straat|rijbaan)|(?:weg|straat|rijbaan)\s+en\s+(?:het\s+)?(?:fiets|voet)pad|rijbaan|rijbanen|rijweg|wegvak|autoverkeer|gemotoriseerd\w*|al het verkeer|alle verkeer|doorgaand verkeer|bestemmingsverkeer|(?:straat|weg|kruising|brug)\s+(?:is\s+|wordt\s+)?(?:afgesloten|dicht))\b/i;
/** "Afsluiting fietspad komt te vervallen", "geen afsluiting van het fietspad": not a closure. */
const NEGATED_RE = /\b(?:vervalt|vervallen|niet|geen|opgeheven)\b/i;
const SPEED_RE = /\b(\d{2,3})\s*km\s*\/?\s*u(?:ur)?\b/gi;

/**
 * Melvin's label among the comments: only a line that is exactly one of the six labels counts.
 * @param {(string | undefined)[]} texts
 * @returns {Gevolg | undefined}
 */
export function gevolgOf(texts) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const text of texts) {
    for (const line of (text ?? '').split('\n')) {
      const key = line.replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim().toLowerCase();
      if (GEVOLG_LABELS.includes(key) && !found.has(key)) found.set(key, line.trim().replace(/[.!]+$/, ''));
    }
  }
  const key = GEVOLG_LABELS.find((k) => found.has(k));
  return key ? { key, text: /** @type {string} */ (found.get(key)) } : undefined;
}

/**
 * @param {CheckInput} input
 * @returns {Check[]}
 */
export function checkItem(input) {
  const { imp, veh, by, gevolg, hind, spd } = input;
  const text = input.texts.filter(Boolean).join('\n');
  const closed = CLOSED.has(imp);
  const forCars = !veh || veh.includes('car');
  /** @type {Check[]} */
  const out = [];

  if (closed && by === 'gevolg' && gevolg) out.push({ c: 'gevolg-dicht', q: gevolg.text });
  if (closed && by === 'tekst') out.push({ c: 'tekst-dicht', q: closedByText(text) });
  if (closed && forCars && !by && !LABEL_CLOSED.has(gevolg?.key ?? '') && !ROAD_CLOSED_RE.test(text)) {
    const sentence = pathSentence(text);
    if (sentence) out.push({ c: 'tekst-fietspad', q: sentence });
  }
  if (closed && gevolg?.key === 'geen gevolgen voor verkeer') out.push({ c: 'gevolg-geen', q: gevolg.text });
  if (closed && forCars && gevolg?.key === 'beperking voor langzaam verkeer') out.push({ c: 'gevolg-langzaam', q: gevolg.text });

  if (closed && veh && !veh.includes('car') && LABEL_CLOSED.has(gevolg?.key ?? '')) out.push({ c: 'gevolg-fiets', q: gevolg?.text });
  if (imp === 'dicht' && (hind === 'D' || hind === 'E')) out.push({ c: 'hinderklasse', q: hind });
  const speeds = [...new Set([...text.matchAll(SPEED_RE)].map((m) => Number(m[1])))];
  if (speeds.length === 1 && speeds[0] !== spd) out.push({ c: 'snelheid', q: `${speeds[0]} km/u` });
  return out;
}

/** @param {string} text */
function pathSentence(text) {
  return sentencesOf(text).find((s) => PATH_CLOSED_RE.test(s) && !NEGATED_RE.test(s));
}

/**
 * Run the checks over the final items: visible checks become `detail.chk`, every check is counted.
 * Reads the working copy `item.qa` that finalizeItem() leaves behind, and drops it.
 * @param {import('./item.js').Item[]} items
 * @returns {{ counts: Partial<Record<CheckCode, number>>, ids: Partial<Record<CheckCode, string[]>> }}
 */
export function annotateConsistency(items) {
  /** @type {Partial<Record<CheckCode, number>>} */
  const counts = {};
  /** @type {Partial<Record<CheckCode, string[]>>} */
  const ids = {};
  for (const item of items) {
    const qa = /** @type {{ texts: (string|undefined)[], gevolg?: Gevolg, by?: 'gevolg'|'tekst', imp?: string } | undefined} */ (item.qa);
    if (!qa) continue;
    const p = item.props;
    const checks = checkItem({
      imp: /** @type {string} */ (p.imp),
      veh: /** @type {string[] | undefined} */ (p.veh),
      hind: /** @type {string | undefined} */ (p.hind),
      spd: /** @type {number | undefined} */ (p.spd),
      // Raised later by a related situation's closure record: no longer read from the words.
      by: qa.imp === p.imp ? qa.by : undefined,
      gevolg: qa.gevolg,
      texts: qa.texts,
    });
    for (const { c } of checks) {
      counts[c] = (counts[c] ?? 0) + 1;
      (ids[c] ??= []).push(item.id);
    }
    const visible = checks.filter((x) => VISIBLE_CHECKS.has(x.c));
    if (visible.length > 0) item.detail.chk = visible;
    delete item.qa;
  }
  return { counts, ids };
}
