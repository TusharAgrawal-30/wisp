// Storage facade. Two interchangeable backends:
//   - SQLite (default): zero-config, perfect for local dev and any host
//     with a persistent disk
//   - Upstash Redis: used automatically when UPSTASH_REDIS_REST_URL and
//     UPSTASH_REDIS_REST_TOKEN are set — the right choice on serverless
//     hosts, where instances don't share a filesystem
//
// Both enforce the same guarantees: ciphertext-only storage, TTL expiry,
// and single-winner semantics for the last read of a view-limited drop.

import * as sqlite from './store-sqlite';

const useRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// lazy-load the redis backend so local dev never touches it
async function redis() {
  return import('./store-redis');
}

export interface InsertDropInput {
  id: string;
  blob: string;
  maxViews: number | null;
  allowReply: boolean;
  expiresAt: number | null;
  destroyHash: string;
}

export async function insertDrop(rec: InsertDropInput) {
  if (useRedis) return (await redis()).insertDrop(rec);
  return sqlite.insertDrop(rec);
}

export async function getMeta(id: string) {
  if (useRedis) return (await redis()).getMeta(id);
  return sqlite.getMeta(id);
}

export async function consumeDrop(id: string) {
  if (useRedis) return (await redis()).consumeDrop(id);
  return sqlite.consumeDrop(id);
}

export async function destroyDrop(id: string, destroyHash: string): Promise<boolean> {
  if (useRedis) return (await redis()).destroyDrop(id, destroyHash);
  return sqlite.destroyDrop(id, destroyHash);
}

export async function addReply(id: string, blob: string): Promise<'ok' | 'not_found' | 'closed' | 'full'> {
  if (useRedis) return (await redis()).addReply(id, blob);
  return sqlite.addReply(id, blob);
}

export async function getOwnerView(id: string, destroyHash: string) {
  if (useRedis) return (await redis()).getOwnerView(id, destroyHash);
  return sqlite.getOwnerView(id, destroyHash);
}
