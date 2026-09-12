/** Unit tests for web/src/data/types.ts (slugify, shard maths, file layout, constants). */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { types } from './helpers/src.mjs';

const { CATEGORIES, DATA_FILES, DETAIL_SHARDS, PROVINCES, shardFromHashPrefix, slugify } = types;

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

describe('slugify', () => {
  it('produces the slugs documented in the contract', () => {
    assert.equal(slugify("'s-Hertogenbosch"), 's-hertogenbosch');
    assert.equal(slugify('Bergen (NH)'), 'bergen-nh');
    assert.equal(slugify('A12 hrb'), 'a12-hrb');
  });

  it('strips diacritics', () => {
    assert.equal(slugify('Súdwest-Fryslân'), 'sudwest-fryslan');
    assert.equal(slugify('Ápeldoorn'), 'apeldoorn');
    assert.equal(slugify('Nuenen, Gerwen en Nederwetten'), 'nuenen-gerwen-en-nederwetten');
  });

  it('collapses separators and trims them from both ends', () => {
    assert.equal(slugify('  A2   ·  Vinkeveen  '), 'a2-vinkeveen');
    assert.equal(slugify('--Utrecht--'), 'utrecht');
    assert.equal(slugify('Brug in de N231 bij Aalsmeer'), 'brug-in-de-n231-bij-aalsmeer');
  });

  it('returns an empty string when nothing usable is left', () => {
    assert.equal(slugify(''), '');
    assert.equal(slugify('···'), '');
  });

  it('is idempotent', () => {
    for (const input of ["'s-Hertogenbosch", 'Bergen (NH)', 'Súdwest-Fryslân', 'A12 hrb']) {
      assert.equal(slugify(slugify(input)), slugify(input));
    }
  });
});

describe('shardFromHashPrefix', () => {
  it('uses the first eight hex characters modulo 32', () => {
    assert.equal(shardFromHashPrefix('00000000'), 0);
    assert.equal(shardFromHashPrefix('0000001f'), 31);
    assert.equal(shardFromHashPrefix('00000020'), 0);
    assert.equal(shardFromHashPrefix('ffffffff'), 31);
  });

  it('ignores everything after the first eight characters', () => {
    assert.equal(shardFromHashPrefix('0000001fdeadbeef'), shardFromHashPrefix('0000001f'));
  });

  it('agrees with the pipeline formula parseInt(sha1(id)[0..8], 16) % 32', () => {
    for (const id of ['NDW03_2100001', 'AND01_2100100', 'NLRWS_0005415104', 'BMS01_x_1']) {
      const hex = sha1(id);
      const expected = Number.parseInt(hex.slice(0, 8), 16) % DETAIL_SHARDS;
      assert.equal(shardFromHashPrefix(hex), expected, `shard for ${id}`);
    }
  });

  it('stays inside the shard range for many ids', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const shard = shardFromHashPrefix(sha1(`NDW03_${i}`));
      assert.ok(Number.isInteger(shard) && shard >= 0 && shard < DETAIL_SHARDS);
      seen.add(shard);
    }
    assert.ok(seen.size > 25, `expected a good spread over ${DETAIL_SHARDS} shards, got ${seen.size}`);
  });
});

describe('DATA_FILES', () => {
  it('names the fixed files as agreed', () => {
    assert.equal(DATA_FILES.meta, 'meta.json');
    assert.equal(DATA_FILES.werkActueel, 'werk-actueel.geojson');
    assert.equal(DATA_FILES.werkGepland, 'werk-gepland.geojson');
    assert.equal(DATA_FILES.live, 'live.geojson');
    assert.equal(DATA_FILES.indexAll, 'index/all.json');
    assert.equal(DATA_FILES.bruggen, 'bruggen.json');
    assert.equal(DATA_FILES.manifest, 'manifest.json');
  });

  it('pads shard numbers to two digits', () => {
    assert.equal(DATA_FILES.detail(0), 'detail/00.json');
    assert.equal(DATA_FILES.detail(3), 'detail/03.json');
    assert.equal(DATA_FILES.detail(31), 'detail/31.json');
  });

  it('builds province index paths', () => {
    assert.equal(DATA_FILES.indexProv('PV26'), 'index/prov/PV26.json');
    assert.equal(DATA_FILES.indexProv('_'), 'index/prov/_.json');
  });
});

describe('constants', () => {
  it('has the seven categories in impact order', () => {
    assert.deepEqual([...CATEGORIES], ['werk', 'afsluiting', 'file', 'incident', 'brug', 'evenement', 'overig']);
  });

  it('has all twelve provinces with their CBS codes', () => {
    assert.equal(Object.keys(PROVINCES).length, 12);
    assert.equal(PROVINCES.PV26, 'Utrecht');
    assert.equal(PROVINCES.PV31, 'Limburg');
    for (const code of Object.keys(PROVINCES)) assert.match(code, /^PV\d{2}$/);
  });

  it('uses 32 detail shards', () => {
    assert.equal(DETAIL_SHARDS, 32);
  });
});
