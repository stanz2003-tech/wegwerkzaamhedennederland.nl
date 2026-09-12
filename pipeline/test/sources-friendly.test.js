import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { friendlySource, normalizeProvince, provinceName, PROVINCES } from '../src/sources-friendly.js';

test('RWS districts collapse onto "Rijkswaterstaat"', () => {
  for (const published of [
    'NN-W [RWS Noord-Nederland District West]',
    'MN-Z [RWS Midden-Nederland District Zuid]',
    'ZN-O [RWS Zuid-Nederland District Oost]',
    'RWS Verkeerscentrale Nederland',
    'Rijkswaterstaat West-Nederland Zuid',
  ]) {
    assert.deepEqual(friendlySource(published), { src: 'Rijkswaterstaat' }, published);
  }
});

test('NDW / RWS system publishers map to "Rijkswaterstaat / NDW"', () => {
  for (const published of ['NLRWS', 'NDW', 'NDW03', 'NDWNL', 'BMS01', 'MOS01', 'TSN01', 'RoadSafetyServices']) {
    assert.deepEqual(friendlySource(published), { src: 'Rijkswaterstaat / NDW' }, published);
  }
});

test('"Gemeente X" is kept verbatim and carries the gemeente hint', () => {
  assert.deepEqual(friendlySource('Gemeente Breda'), { src: 'Gemeente Breda', gemeente: 'Breda' });
  assert.deepEqual(friendlySource("Gemeente 's-Hertogenbosch"), { src: "Gemeente 's-Hertogenbosch", gemeente: "'s-Hertogenbosch" });
  assert.deepEqual(friendlySource('gemeente  Súdwest-Fryslân '), { src: 'Gemeente Súdwest-Fryslân', gemeente: 'Súdwest-Fryslân' });
});

test('"Provincie X" carries the normalised province name and code', () => {
  assert.deepEqual(friendlySource('Provincie Utrecht'), { src: 'Provincie Utrecht', prov: 'Utrecht', provCode: 'PV26' });
  assert.deepEqual(friendlySource('Provincie Fryslân'), { src: 'Provincie Friesland', prov: 'Friesland', provCode: 'PV21' });
  assert.deepEqual(friendlySource('Provincie Noord Brabant'), { src: 'Provincie Noord-Brabant', prov: 'Noord-Brabant', provCode: 'PV30' });
  // an unknown "province" keeps the published spelling but gets no code
  assert.deepEqual(friendlySource('Provincie Atlantis'), { src: 'Provincie Atlantis' });
});

test('unknown publishers are passed through, trimmed and capped at 60 characters', () => {
  assert.deepEqual(friendlySource('Waterschap Rivierenland'), { src: 'Waterschap Rivierenland' });
  assert.deepEqual(friendlySource(undefined), { src: 'Onbekend' });
  assert.deepEqual(friendlySource('   '), { src: 'Onbekend' });
  const long = friendlySource('Stichting Beheer en Onderhoud van Wegen en Vaarwegen in de Regio Zuidwest-Nederland');
  assert.ok(long.src.length <= 60 && long.src.length >= 55, `length ${long.src.length}`);
  assert.ok(long.src.endsWith('…'));
});

test('normalizeProvince accepts the published spellings', () => {
  assert.deepEqual(normalizeProvince('Fryslân'), { code: 'PV21', name: 'Friesland' });
  assert.deepEqual(normalizeProvince('fryslan'), { code: 'PV21', name: 'Friesland' });
  assert.deepEqual(normalizeProvince('Friesland'), { code: 'PV21', name: 'Friesland' });
  assert.deepEqual(normalizeProvince('noord-holland'), { code: 'PV27', name: 'Noord-Holland' });
  assert.deepEqual(normalizeProvince('Noord Holland'), { code: 'PV27', name: 'Noord-Holland' });
  assert.equal(normalizeProvince('Vlaanderen'), undefined);
  assert.equal(normalizeProvince(undefined), undefined);
  assert.equal(provinceName('PV31'), 'Limburg');
  assert.equal(provinceName(undefined), undefined);
  assert.equal(provinceName('PV99'), undefined);
});

test('the province table is identical to PROVINCES in web/src/data/types.ts', () => {
  const ts = readFileSync(fileURLToPath(new URL('../../web/src/data/types.ts', import.meta.url)), 'utf8');
  for (const [code, name] of Object.entries(PROVINCES)) {
    assert.ok(ts.includes(`${code}: '${name}'`), `${code}: '${name}' missing from types.ts`);
  }
  assert.equal(Object.keys(PROVINCES).length, 12);
});
