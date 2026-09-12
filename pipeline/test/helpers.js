/** Shared test helpers: fixture loading and in-memory feed parsing. */

import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseFeed, wrapFixture } from '../src/parse.js';

export const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** @param {string} name */
export function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/**
 * Parse one or more fixture snippets (situation elements) into situations.
 * @param {string} inner
 * @returns {Promise<import('../src/parse.js').Situation[]>}
 */
export async function parseSnippet(inner) {
  /** @type {import('../src/parse.js').Situation[]} */
  const out = [];
  await parseFeed(Readable.from([wrapFixture(inner)]), (s) => {
    out.push(s);
  });
  return out;
}

/** @param {string} name */
export async function parseFixture(name) {
  const situations = await parseSnippet(fixture(name));
  if (situations.length !== 1) throw new Error(`fixture ${name} has ${situations.length} situations`);
  return situations[0];
}

/**
 * Turn a string into an async iterable in chunks of `size` characters
 * (exercises the parser's chunk boundaries).
 * @param {string} text
 * @param {number} size
 */
export async function* chunked(text, size) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

/** Tiny VILD table used across tests (subset of the real one). */
export const VILD_SAMPLE = {
  10139: ['P3.3', 'A7', '', 'Wildinghe', '', [5.42661, 53.09211], 3402, 2585, -1],
  3402: ['L3.0', 'A7', '', '', '', null, 3407, 203, -1],
  3407: ['L4.0', 'A7', '', 'Knooppunt Zurich', 'Ring-Sneek-West', null, 3411, 50, -1],
  3411: ['L4.0', 'A7', 'Afsluitdijk', 'Den Oever', 'Knooppunt Zurich', null, 3406, 50, -1],
  21728: ['P3.4', 'A7', 'Afsluitdijk', 'Monument-Rechts', '', [5.10789, 52.96873], 3411, 2468, 770],
  10572: ['P1.3', 'A9', '', 'Amstelveen', 'N522', [4.8793, 52.29664], 3460, 2414, 256],
  10568: ['P1.1', 'A9', '', 'Holendrecht', 'A2', [4.94287, 52.29207], 3460, 2455, 110],
  3460: ['L3.0', 'A9', '', 'Diemen', 'Amstelveen', null, 3462, 207, -1],
  22370: ['P1.3', 'N2', '', 'A2: Maastricht-Centrum Zuid', 'A2/N278', [5.71723, 50.84086], 3121, 2674, 2575],
  3121: ['L1.2', 'N2', '', 'Europaplein', 'Kruisdonk', null, 0, 2674, -1],
  7031: ['P3.2', 'A1', '', 'Eembrug', 'Eem', [5.3081, 52.2187], 3000, 2380, 346],
  7874: ['P1.3', 'A2', '', 'Roosteren', 'N296', [5.82441, 51.07288], 3102, 2659, 2288],
  9999: ['P1.3', 'A12 hrb', '', 'Buiten NL', '', [10.5, 48.2], 0, 0, -1],
  8888: ['P1.3', 'N57', '', 'Geen coords', '', null, 0, 0, -1],
};
