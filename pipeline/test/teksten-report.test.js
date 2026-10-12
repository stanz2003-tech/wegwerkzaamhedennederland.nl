import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { formatReport, KINDS, loadData } from '../src/teksten-report.js';

const MERWEDE = 'Langdurige afsluiting fietspad Merwedebrug westzijde';

test('the report counts every check and lists the shown ones with title, quote and link', () => {
  const report = formatReport({
    meta: { generated: '2026-10-12T17:30:00Z', qa: { 'tekst-fietspad': 1, hinderklasse: 3796 } },
    rows: [['AND01_C10', 'afsluiting', 'roadClosed', 1, `${MERWEDE}, Gorinchem`, null, 'lokaal', 'Gorinchem', 'Gorinchem', 'Zuid-Holland', '', null, 4.9, 51.8, 1, 'E', 1, 'dicht']],
    details: { AND01_C10: { chk: [{ c: 'tekst-fietspad', q: MERWEDE }] } },
  });
  assert.match(report, /^Teksten-check · data van 2026-10-12T17:30:00Z · 1 meldingen/);
  assert.match(report, /\n {4}1 {2}Dicht voor auto's, maar de tekst noemt alleen een fiets- of voetpad\n/);
  assert.match(report, new RegExp(`- ${MERWEDE}, Gorinchem {2}← "${MERWEDE}"`));
  assert.match(report, /\?id=AND01_C10/);
  assert.match(report, / 3796 {2}Dicht, met hinderklasse/);
  assert.equal(report.split('\n').filter((l) => /^ +\d+ {2}/.test(l)).length, Object.keys(KINDS).length, 'one line per kind');
});

test('only ten per kind unless --alles, and data from before the check says so', () => {
  const details = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`X${String(i).padStart(2, '0')}`, { chk: [{ c: 'gevolg-dicht', q: 'Weg dicht in beide richtingen' }] }]));
  const short = formatReport({ meta: {}, rows: [], details });
  assert.match(short, /… en nog 2 \(--alles toont ze allemaal\)/);
  assert.match(short, /van vóór de teksten-check/);
  assert.doesNotMatch(formatReport({ meta: {}, rows: [], details }, { all: true }), /en nog 2/);
});

test('loadData reads a local pipeline output directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'teksten-'));
  mkdirSync(join(dir, 'index'));
  mkdirSync(join(dir, 'detail'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ generated: 'g', qa: {} }));
  writeFileSync(join(dir, 'index', 'all.json'), JSON.stringify({ rows: [['a']] }));
  for (let i = 0; i < 32; i++) writeFileSync(join(dir, 'detail', `${String(i).padStart(2, '0')}.json`), JSON.stringify(i === 5 ? { a: { id: 'a' } } : {}));
  const data = await loadData(dir);
  assert.equal(data.meta.generated, 'g');
  assert.deepEqual(data.rows, [['a']]);
  assert.deepEqual(data.details, { a: { id: 'a' } });
});
