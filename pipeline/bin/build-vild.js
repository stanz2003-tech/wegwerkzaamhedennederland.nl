#!/usr/bin/env node
/**
 * Rebuild `static/vild.json` from the NDW VILD zip (TMC location table).
 * Dependency-free readers for the zip container, the dBASE table
 * (`VILD6.13.A.dbf`, code page 1252) and the point shapefile
 * (`WGS84/vild_point.shp` + `.dbf` with LOC_NR per shape).
 *
 *   node bin/build-vild.js [--zip path/to/VILD6.13.A.zip] [--url <zip url>] [--out static/vild.json]
 *
 * Output format (unchanged):
 * `{version, date, source, fields, loc: {"<LOC_NR>": [type, road, roadName, name1, name2, [lon,lat]|null, linRef, areaRef, hectoPos]}}`
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { round5 } from '../src/geometry.js';
import { VILD_ZIP_URL } from '../src/sources.js';

const MAIN_DBF = /(^|\/)VILD[\d.A-Z]+\.dbf$/i;
const POINT_SHP = 'WGS84/vild_point.shp';
const POINT_DBF = 'WGS84/vild_point.dbf';

// ---------------------------------------------------------------------------
// Zip

/**
 * Read all entries of a (non-zip64) zip archive.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  /** @type {Map<string, Buffer>} */
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Bad central directory entry at ${offset}`);
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Bad local header for ${name}`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) {
      const out = inflateRawSync(data);
      if (out.length !== uncompressedSize) throw new Error(`Size mismatch for ${name}`);
      entries.set(name, out);
    } else throw new Error(`Unsupported compression method ${method} for ${name}`);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// dBASE

/**
 * @param {Buffer} buf
 * @param {string} [encoding]  TextDecoder label, default windows-1252
 * @returns {{ fields: { name: string, type: string, length: number }[], rows: Record<string, string>[] }}
 */
export function readDbf(buf, encoding = 'windows-1252') {
  const decoder = new TextDecoder(encoding);
  const recordCount = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  /** @type {{ name: string, type: string, length: number }[]} */
  const fields = [];
  for (let o = 32; o + 32 <= headerLength && buf[o] !== 0x0d; o += 32) {
    const nameBytes = buf.subarray(o, o + 11);
    const end = nameBytes.indexOf(0);
    fields.push({
      name: nameBytes.toString('latin1', 0, end < 0 ? 11 : end),
      type: String.fromCharCode(buf[o + 11]),
      length: buf[o + 16],
    });
  }
  /** @type {Record<string, string>[]} */
  const rows = [];
  for (let r = 0; r < recordCount; r++) {
    const start = headerLength + r * recordLength;
    if (start + recordLength > buf.length) break;
    if (buf[start] === 0x2a) continue; // deleted record
    let off = start + 1;
    /** @type {Record<string, string>} */
    const row = {};
    for (const f of fields) {
      row[f.name] = decoder.decode(buf.subarray(off, off + f.length)).trim();
      off += f.length;
    }
    rows.push(row);
  }
  return { fields, rows };
}

// ---------------------------------------------------------------------------
// Shapefile (point type only)

/**
 * @param {Buffer} buf
 * @returns {([number, number] | null)[]}  x/y per record, null for null shapes
 */
export function readShpPoints(buf) {
  if (buf.readInt32BE(0) !== 9994) throw new Error('Not a shapefile');
  const shapeType = buf.readInt32LE(32);
  if (shapeType !== 1 && shapeType !== 11 && shapeType !== 21) throw new Error(`Expected a point shapefile, got shape type ${shapeType}`);
  /** @type {([number, number] | null)[]} */
  const points = [];
  let off = 100;
  while (off + 8 <= buf.length) {
    const contentLength = buf.readInt32BE(off + 4) * 2;
    const type = buf.readInt32LE(off + 8);
    if (type === 0) points.push(null);
    else points.push([buf.readDoubleLE(off + 12), buf.readDoubleLE(off + 20)]);
    off += 8 + contentLength;
  }
  return points;
}

// ---------------------------------------------------------------------------
// VILD table

/**
 * @param {Map<string, Buffer>} entries
 * @param {string} source
 */
export function buildVildTable(entries, source) {
  const mainName = [...entries.keys()].find((n) => MAIN_DBF.test(n));
  if (!mainName) throw new Error('Main VILD .dbf not found in zip');
  const shp = entries.get(POINT_SHP);
  const shpDbf = entries.get(POINT_DBF);
  if (!shp || !shpDbf) throw new Error(`${POINT_SHP} / ${POINT_DBF} not found in zip`);

  const points = readShpPoints(shp);
  const pointRows = readDbf(shpDbf).rows;
  if (points.length !== pointRows.length) throw new Error(`Point count mismatch: ${points.length} shapes vs ${pointRows.length} dbf rows`);
  /** @type {Map<string, [number, number]>} */
  const coords = new Map();
  pointRows.forEach((row, i) => {
    const p = points[i];
    if (p) coords.set(row.LOC_NR, [round5(p[0]), round5(p[1])]);
  });

  const { rows } = readDbf(entries.get(mainName));
  let version = '';
  let date = '';
  /** @type {Record<string, unknown[]>} */
  const loc = {};
  for (const row of rows) {
    if (row.LOC_NR === '0' && row.LOC_TYPE === 'V1.0') {
      version = row.FIRST_NAME;
      const m = row.SECND_NAME.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      date = m ? `${m[3]}-${m[2]}-${m[1]}` : row.SECND_NAME;
      continue;
    }
    loc[row.LOC_NR] = [
      row.LOC_TYPE,
      row.ROADNUMBER,
      row.ROADNAME,
      row.FIRST_NAME,
      row.SECND_NAME,
      coords.get(row.LOC_NR) ?? null,
      Number(row.LIN_REF) || 0,
      Number(row.AREA_REF) || 0,
      row.HSTART_POS === '' ? -1 : Number(row.HSTART_POS),
    ];
  }
  return {
    version,
    date,
    source,
    fields: 'nr:[type,road,roadName,name1,name2,lonlat|null,linRef,areaRef,hectoPos]',
    loc,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      zip: { type: 'string' },
      url: { type: 'string', default: VILD_ZIP_URL },
      out: { type: 'string', default: fileURLToPath(new URL('../static/vild.json', import.meta.url)) },
    },
  });
  /** @type {Buffer} */
  let zip;
  if (values.zip) zip = readFileSync(values.zip);
  else {
    process.stderr.write(`downloading ${values.url}\n`);
    const res = await fetch(values.url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${values.url}`);
    zip = Buffer.from(await res.arrayBuffer());
  }
  const table = buildVildTable(readZip(zip), values.url);
  const count = Object.keys(table.loc).length;
  const withCoords = Object.values(table.loc).filter((r) => r[5] !== null).length;
  if (count < 10_000) throw new Error(`Suspiciously few locations (${count}); not writing`);
  writeFileSync(values.out, JSON.stringify(table));
  process.stdout.write(`vild.json: version ${table.version} (${table.date}), ${count} locations, ${withCoords} with coordinates → ${values.out}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`build-vild failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
}
