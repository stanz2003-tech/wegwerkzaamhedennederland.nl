/**
 * Writers for every file of the data contract (web/src/data/types.ts):
 * GeoJSON collections, index/all.json + index/prov/*.json, detail shards,
 * bruggen.json, meta.json and — last — manifest.json. Deterministic key
 * order, no pretty printing. Also the NDJSON cache of parsed situations.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

export const DETAIL_SHARDS = 32;
export const PROVINCE_CODES = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26', 'PV27', 'PV28', 'PV29', 'PV30', 'PV31', '_'];
export const DATA_VERSION = '1';

/** @typedef {import('./item.js').Item} Item */

/**
 * @typedef {object} BridgeEntry
 * @property {string} id
 * @property {string} slug
 * @property {string} name
 * @property {string=} road
 * @property {string=} water
 * @property {string=} gemeente
 * @property {string=} woonplaats
 * @property {string=} prov
 * @property {number} lon
 * @property {number} lat
 * @property {boolean} openNow
 * @property {[string, string][]} openings
 */

/** @param {string} id */
export function shardOf(id) {
  const hex = createHash('sha1').update(id).digest('hex');
  return Number.parseInt(hex.slice(0, 8), 16) % DETAIL_SHARDS;
}

/** @param {number} shard */
export function shardName(shard) {
  return `detail/${String(shard).padStart(2, '0')}.json`;
}

/** @param {string | Buffer} data */
export function sha1Hex(data) {
  return createHash('sha1').update(data).digest('hex');
}

/**
 * GeoJSON feature with compact properties and a top-level id.
 * @param {Item} item
 */
export function featureOf(item) {
  const p = item.props;
  return {
    type: 'Feature',
    id: p.id,
    geometry: item.geometry,
    properties: p,
  };
}

/**
 * @param {Item} item
 * @param {0|1} active
 * @returns {unknown[]}
 */
export function indexRowOf(item, active) {
  const p = item.props;
  return [
    p.id,
    p.cat,
    p.sub ?? null,
    p.sev,
    p.title,
    p.road ?? null,
    p.roadType ?? null,
    p.gemeente ?? null,
    p.woonplaats ?? null,
    p.prov ?? null,
    p.start,
    p.end ?? null,
    item.mid[0],
    item.mid[1],
    p.closed ? 1 : 0,
    p.hind ?? null,
    active,
  ];
}

/**
 * @param {object} input
 * @param {string} input.outDir
 * @param {string} input.generated        ISO time
 * @param {Item[]} input.actueel
 * @param {Item[]} input.gepland
 * @param {Item[]} input.live
 * @param {BridgeEntry[]} input.bridges
 * @param {object} input.meta             Meta without `generated`/`version` (added here)
 * @returns {Record<string, string>} manifest
 */
export function writeOutputs({ outDir, generated, actueel, gepland, live, bridges, meta }) {
  /** @type {Record<string, string>} */
  const manifest = {};
  const put = (/** @type {string} */ rel, /** @type {unknown} */ obj) => {
    const json = JSON.stringify(obj);
    writeFileAtomic(join(outDir, rel), json);
    manifest[rel] = sha1Hex(json);
  };

  put('werk-actueel.geojson', collection(actueel));
  put('werk-gepland.geojson', collection(gepland));
  put('live.geojson', collection(live));

  /** @type {unknown[][]} */
  const rows = [];
  /** @type {Record<string, unknown[][]>} */
  const byProv = Object.fromEntries(PROVINCE_CODES.map((c) => [c, []]));
  const push = (/** @type {Item} */ item, /** @type {0|1} */ active) => {
    const row = indexRowOf(item, active);
    rows.push(row);
    const code = item.provCode && byProv[item.provCode] ? item.provCode : '_';
    byProv[code].push(row);
  };
  for (const item of actueel) push(item, 1);
  for (const item of live) push(item, 1);
  for (const item of gepland) push(item, 0);
  put('index/all.json', { generated, rows });
  for (const code of PROVINCE_CODES) put(`index/prov/${code}.json`, { generated, rows: byProv[code] });

  /** @type {Record<string, Item>[]} */
  const shards = Array.from({ length: DETAIL_SHARDS }, () => ({}));
  for (const item of [...actueel, ...live, ...gepland]) shards[shardOf(item.props.id)][item.props.id] = item.detail;
  shards.forEach((shard, i) => put(shardName(i), sortKeys(shard)));

  put('bruggen.json', { generated, bridges });
  put('meta.json', { generated, version: DATA_VERSION, ...meta });

  const manifestJson = JSON.stringify(sortKeys(manifest));
  writeFileAtomic(join(outDir, 'manifest.json'), manifestJson);
  return manifest;
}

/** @param {Item[]} items */
function collection(items) {
  return { type: 'FeatureCollection', features: items.map(featureOf) };
}

/**
 * @template T
 * @param {Record<string, T>} obj
 */
function sortKeys(obj) {
  /** @type {Record<string, T>} */
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}

/**
 * Write via a temp file + rename so readers never see a partial file.
 * @param {string} path
 * @param {string} data
 */
export function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/**
 * NDJSON writer with backpressure, finalised by rename (`.tmp` → path).
 * @param {string} path
 */
export function createNdjsonWriter(path) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const stream = createWriteStream(tmp, { highWaterMark: 1 << 20 });
  /** @type {Error | undefined} */
  let failure;
  stream.on('error', (err) => {
    failure = err;
  });
  let count = 0;
  return {
    /** @param {unknown} obj */
    async write(obj) {
      if (failure) throw failure;
      count++;
      if (!stream.write(JSON.stringify(obj) + '\n')) {
        await new Promise((resolve) => stream.once('drain', resolve));
      }
    },
    /** Flush, close and move into place. */
    async close() {
      await new Promise((resolve, reject) => stream.end((/** @type {Error | undefined} */ err) => (err ? reject(err) : resolve(undefined))));
      if (failure) throw failure;
      renameSync(tmp, path);
      return count;
    },
    /** Discard the partial file. */
    async abort() {
      await new Promise((resolve) => stream.end(resolve));
    },
    count: () => count,
  };
}

/**
 * @param {string} path
 * @param {(obj: any) => void | Promise<void>} onObject
 */
export async function readNdjson(path, onObject) {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) {
    if (!line) continue;
    await onObject(JSON.parse(line));
    count++;
  }
  return count;
}
