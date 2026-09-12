/**
 * On-demand item details from detail/<shard>.json with an in-memory cache per shard.
 * Shard = parseInt(sha1(id).slice(0, 8), 16) % 32 — see types.ts.
 */
import { fetchJson, isRecord } from './load';
import type { DetailShard, ItemDetail } from './types';
import { DATA_FILES, shardFromHashPrefix } from './types';

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hex SHA-1 of a string via WebCrypto. */
export async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', encoder.encode(input));
  return toHex(digest);
}

export async function shardForId(id: string): Promise<number> {
  return shardFromHashPrefix(await sha1Hex(id));
}

function isDetailShard(v: unknown): v is DetailShard {
  return isRecord(v);
}

function isItemDetail(v: unknown): v is ItemDetail {
  return isRecord(v) && typeof v.id === 'string' && typeof v.src === 'string' && typeof v.upd === 'string';
}

const shardCache = new Map<number, Promise<DetailShard>>();

function loadShard(shard: number): Promise<DetailShard> {
  const cached = shardCache.get(shard);
  if (cached) return cached;
  const p = fetchJson(DATA_FILES.detail(shard), isDetailShard).catch((err: unknown) => {
    // Do not cache failures: a retry should hit the network again.
    shardCache.delete(shard);
    throw err;
  });
  shardCache.set(shard, p);
  return p;
}

/** Returns the detail record, or null when the shard loads but has no entry for the id. */
export async function loadDetail(id: string): Promise<ItemDetail | null> {
  const shard = await shardForId(id);
  const data = await loadShard(shard);
  const entry = data[id];
  return isItemDetail(entry) ? entry : null;
}

/** Drops cached shards (called after a data refresh so details are re-fetched). */
export function clearDetailCache(): void {
  shardCache.clear();
}
