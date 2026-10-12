/**
 * The consistency report behind bin/check-teksten.js: reads published data and lists, in Dutch for
 * the site owner, where what the site says and what the publisher wrote disagree (src/consistency.js).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA = 'https://data.wegwerkzaamhedennederland.nl/v1/';
const SITE = 'https://www.wegwerkzaamhedennederland.nl/';
const SHARDS = 32;
const SHOWN_PER_KIND = 10;

/** What each check means, in the order the report lists them. */
export const KINDS = Object.freeze({
  'gevolg-dicht': 'Dicht omdat de wegbeheerder "weg dicht" kiest, zonder afsluiting in de gegevens',
  'tekst-dicht': 'Dicht omdat de tekst het zegt ("De A15 is afgesloten"), zonder afsluiting in de gegevens',
  'tekst-fietspad': 'Dicht voor auto\'s, maar de tekst noemt alleen een fiets- of voetpad',
  'gevolg-geen': 'Dicht, maar de wegbeheerder kiest "Geen gevolgen voor verkeer"',
  'gevolg-langzaam': 'Dicht voor auto\'s, maar de wegbeheerder kiest "Beperking voor langzaam verkeer"',
  'gevolg-fiets': 'Wegbeheerder kiest "weg dicht", de gegevens sluiten alleen fiets/brommer af (niet op de site)',
  hinderklasse: 'Dicht, met hinderklasse "weinig/nauwelijks" (die regel verbergt de site)',
  snelheid: 'De tekst noemt een snelheid die niet in de gegevens staat (niet op de site)',
});

/**
 * @param {{ meta: { generated?: string, qa?: Record<string, number> }, rows: unknown[][], details: Record<string, { chk?: { c: string, q?: string }[] }> }} data
 * @param {{ all?: boolean }} [opts]
 * @returns {string}
 */
export function formatReport(data, opts = {}) {
  const titles = new Map(data.rows.map((r) => [String(r[0]), { title: String(r[4]), imp: String(r[17] ?? '') }]));
  /** @type {Record<string, { id: string, q?: string }[]>} */
  const shown = {};
  for (const [id, d] of Object.entries(data.details)) for (const c of d.chk ?? []) (shown[c.c] ??= []).push({ id, q: c.q });
  const counts = data.meta.qa ?? {};
  const total = data.rows.length;
  const out = [`Teksten-check · data van ${data.meta.generated ?? 'onbekend'} · ${total} meldingen`, ''];
  for (const [code, label] of Object.entries(KINDS)) {
    const list = shown[code] ?? [];
    const n = counts[code] ?? list.length;
    out.push(`${String(n).padStart(5)}  ${label}`);
    for (const { id, q } of (opts.all ? list : list.slice(0, SHOWN_PER_KIND)).sort((a, b) => a.id.localeCompare(b.id))) {
      const t = titles.get(id);
      out.push(`         - ${t?.title ?? id}${q ? `  ← "${q}"` : ''}`);
      out.push(`           ${SITE}?id=${encodeURIComponent(id)}`);
    }
    if (!opts.all && list.length > SHOWN_PER_KIND) out.push(`         … en nog ${list.length - SHOWN_PER_KIND} (--alles toont ze allemaal)`);
  }
  if (!data.meta.qa) out.push('', 'Let op: deze data is van vóór de teksten-check; alleen de meldingen met een uitleg zijn geteld.');
  return out.join('\n');
}

/** @param {string} base @param {string} rel */
async function readJson(base, rel) {
  if (/^https?:\/\//.test(base)) {
    const res = await fetch(new URL(rel, base.endsWith('/') ? base : `${base}/`));
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(join(base, rel), 'utf8'));
}

/** @param {string} base */
export async function loadData(base) {
  const [meta, index, ...shards] = await Promise.all([
    readJson(base, 'meta.json'),
    readJson(base, 'index/all.json'),
    ...Array.from({ length: SHARDS }, (_, i) => readJson(base, `detail/${String(i).padStart(2, '0')}.json`)),
  ]);
  return { meta, rows: index.rows, details: Object.assign({}, ...shards) };
}
