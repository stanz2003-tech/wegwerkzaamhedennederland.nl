import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { slugify } from '../src/slug.js';

const TYPES_TS = fileURLToPath(new URL('../../web/src/data/types.ts', import.meta.url));

test('the documented examples', () => {
  assert.equal(slugify("'s-Hertogenbosch"), 's-hertogenbosch');
  assert.equal(slugify('Bergen (NH)'), 'bergen-nh');
  assert.equal(slugify('A12 hrb'), 'a12-hrb');
});

test('diacritics, punctuation and edge cases', () => {
  assert.equal(slugify('Súdwest-Fryslân'), 'sudwest-fryslan');
  assert.equal(slugify('Nieuw-Amsterdam/Veenoord'), 'nieuw-amsterdam-veenoord');
  assert.equal(slugify('  De Wijk  '), 'de-wijk');
  assert.equal(slugify('---'), '');
  assert.equal(slugify(''), '');
  assert.equal(slugify('N57'), 'n57');
  assert.equal(slugify('Brug in de N231 bij Aalsmeer'), 'brug-in-de-n231-bij-aalsmeer');
  assert.equal(slugify('Ir. D.F. Woudagemaal'), 'ir-d-f-woudagemaal');
});

test('idempotent: slugifying a slug changes nothing', () => {
  for (const input of ["'s-Gravenhage", 'Bergen (NH)', 'Súdwest-Fryslân', 'A12 hrb']) {
    const once = slugify(input);
    assert.equal(slugify(once), once);
  }
});

test('identical to slugify() in web/src/data/types.ts', () => {
  const ts = readFileSync(TYPES_TS, 'utf8');
  const body = ts.slice(ts.indexOf('export function slugify'));
  const end = body.indexOf('\n}');
  assert.ok(end > 0, 'slugify() not found in types.ts');
  // The frontend implementation, compiled by dropping the TypeScript annotations.
  const source = body.slice(0, end + 2).replace('export function slugify(input: string): string', 'function frontendSlugify(input)');
  const frontendSlugify = new Function(`${source}; return frontendSlugify;`)();
  for (const input of ["'s-Hertogenbosch", 'Bergen (NH)', 'A12 hrb', 'Súdwest-Fryslân', 'Ir. D.F. Woudagemaal', '', '---']) {
    assert.equal(slugify(input), frontendSlugify(input), `mismatch for ${JSON.stringify(input)}`);
  }
});
