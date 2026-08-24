import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

// SQLite backend — the default for local dev and single-server deploys.
// Zero native deps (built-in node:sqlite); atomic burn semantics come from
// a single transaction.

// Ciphertext-only storage. The server never sees plaintext or keys —
// every blob in here was encrypted in the browser before upload.
// Uses Node's built-in SQLite (zero native deps); the whole layer is
// intentionally small so it can be swapped for Redis/Postgres.
//
// Tables:
//   drops      — live ciphertext + counters. Deleted when burned/expired.
//   events     — timeline (created/read/burned/expired/destroyed/reply).
//                Survives the drop so the owner's vault keeps its history.
//   replies    — sealed reply envelopes, encrypted client-side.
//   tombstones — id -> destroy_hash, so the owner can still authenticate
//                to their timeline after the ciphertext is gone.

const DATA_DIR =
  process.env.WISP_DATA_DIR ||
  (process.env.VERCEL ? '/tmp' : path.join(process.cwd(), '.data'));

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, 'wisp.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS drops (
      id TEXT PRIMARY KEY,
      blob TEXT NOT NULL,
      max_views INTEGER,            -- NULL = unlimited
      views INTEGER NOT NULL DEFAULT 0,
      allow_reply INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,           -- unix ms, NULL = no time limit
      destroy_hash TEXT NOT NULL,   -- sha256 of the owner token
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drops_expires ON drops(expires_at);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drop_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_drop ON events(drop_id);

    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drop_id TEXT NOT NULL,
      blob TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_replies_drop ON replies(drop_id);

    CREATE TABLE IF NOT EXISTS tombstones (
      id TEXT PRIMARY KEY,
      destroy_hash TEXT NOT NULL,
      allow_reply INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

interface DropRow {
  id: string;
  blob: string;
  max_views: number | null;
  views: number;
  allow_reply: number;
  expires_at: number | null;
  destroy_hash: string;
  created_at: number;
}

function logEvent(dropId: string, type: string) {
  getDb().prepare('INSERT INTO events (drop_id, type, at) VALUES (?, ?, ?)').run(dropId, type, Date.now());
}

function purgeExpired() {
  const d = getDb();
  const rows = d
    .prepare('SELECT id FROM drops WHERE expires_at IS NOT NULL AND expires_at < ?')
    .all(Date.now()) as { id: string }[];
  for (const r of rows) {
    d.prepare('DELETE FROM drops WHERE id = ?').run(r.id);
    logEvent(r.id, 'expired');
  }
}

function alive(row: DropRow | undefined): DropRow | null {
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at < Date.now()) {
    getDb().prepare('DELETE FROM drops WHERE id = ?').run(row.id);
    logEvent(row.id, 'expired');
    return null;
  }
  return row;
}

export function insertDrop(rec: {
  id: string;
  blob: string;
  maxViews: number | null;
  allowReply: boolean;
  expiresAt: number | null;
  destroyHash: string;
}) {
  purgeExpired();
  const d = getDb();
  const now = Date.now();
  d.prepare(
    'INSERT INTO drops (id, blob, max_views, views, allow_reply, expires_at, destroy_hash, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)'
  ).run(rec.id, rec.blob, rec.maxViews, rec.allowReply ? 1 : 0, rec.expiresAt, rec.destroyHash, now);
  d.prepare('INSERT OR REPLACE INTO tombstones (id, destroy_hash, allow_reply, created_at) VALUES (?, ?, ?, ?)').run(
    rec.id,
    rec.destroyHash,
    rec.allowReply ? 1 : 0,
    now
  );
  logEvent(rec.id, 'created');
}

export function getMeta(id: string) {
  const row = alive(getDb().prepare('SELECT * FROM drops WHERE id = ?').get(id) as DropRow | undefined);
  if (!row) return null;
  return {
    maxViews: row.max_views,
    views: row.views,
    viewsLeft: row.max_views === null ? null : row.max_views - row.views,
    allowReply: row.allow_reply === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// Fetch the ciphertext, counting the view. When this read exhausts a
// view-limited drop, the ciphertext is deleted inside the same
// transaction — two concurrent readers can't both take the last view.
export function consumeDrop(id: string) {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  let result: {
    blob: string;
    burned: boolean;
    views: number;
    maxViews: number | null;
    allowReply: boolean;
    expiresAt: number | null;
  } | null = null;
  try {
    const row = alive(d.prepare('SELECT * FROM drops WHERE id = ?').get(id) as DropRow | undefined);
    if (row && (row.max_views === null || row.views < row.max_views)) {
      const views = row.views + 1;
      const burned = row.max_views !== null && views >= row.max_views;
      const res = burned
        ? d.prepare('DELETE FROM drops WHERE id = ? AND views = ?').run(id, row.views)
        : d.prepare('UPDATE drops SET views = views + 1 WHERE id = ? AND views = ?').run(id, row.views);
      if (res.changes > 0) {
        result = {
          blob: row.blob,
          burned,
          views,
          maxViews: row.max_views,
          allowReply: row.allow_reply === 1,
          expiresAt: row.expires_at,
        };
      }
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  if (result) {
    logEvent(id, 'read');
    if (result.burned) logEvent(id, 'burned');
  }
  return result;
}

export function destroyDrop(id: string, destroyHash: string): boolean {
  const res = getDb().prepare('DELETE FROM drops WHERE id = ? AND destroy_hash = ?').run(id, destroyHash);
  if (res.changes > 0) {
    logEvent(id, 'destroyed');
    return true;
  }
  return false;
}

// Replies are encrypted in the recipient's browser with the same URL key,
// so the server relays sealed envelopes it cannot open. To let a burned
// one-shot drop still be answered, replies stay open for 24h after the
// drop was created (if the owner enabled them).
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REPLIES_PER_DROP = 50;

export function addReply(id: string, blob: string): 'ok' | 'not_found' | 'closed' | 'full' {
  const d = getDb();
  const tomb = d.prepare('SELECT * FROM tombstones WHERE id = ?').get(id) as
    | { id: string; destroy_hash: string; allow_reply: number; created_at: number }
    | undefined;
  if (!tomb) return 'not_found';
  if (tomb.allow_reply !== 1) return 'closed';
  if (Date.now() - tomb.created_at > REPLY_WINDOW_MS) return 'closed';
  const count = d.prepare('SELECT COUNT(*) AS c FROM replies WHERE drop_id = ?').get(id) as { c: number };
  if (count.c >= MAX_REPLIES_PER_DROP) return 'full';
  d.prepare('INSERT INTO replies (drop_id, blob, created_at) VALUES (?, ?, ?)').run(id, blob, Date.now());
  logEvent(id, 'reply');
  return 'ok';
}

// Owner view, authenticated by the destroy token. Works for live drops
// and for burned/expired ones (via the tombstone), so the vault keeps
// showing the timeline after the ciphertext is gone.
export function getOwnerView(id: string, destroyHash: string) {
  const d = getDb();
  purgeExpired();
  const tomb = d.prepare('SELECT destroy_hash FROM tombstones WHERE id = ?').get(id) as
    | { destroy_hash: string }
    | undefined;
  if (!tomb || tomb.destroy_hash !== destroyHash) return null;

  const row = alive(d.prepare('SELECT * FROM drops WHERE id = ?').get(id) as DropRow | undefined);
  const events = d
    .prepare('SELECT type, at FROM events WHERE drop_id = ? ORDER BY at, id')
    .all(id) as { type: string; at: number }[];
  const replies = d
    .prepare('SELECT blob, created_at FROM replies WHERE drop_id = ? ORDER BY created_at')
    .all(id) as { blob: string; created_at: number }[];

  return {
    alive: !!row,
    views: row ? row.views : null,
    maxViews: row ? row.max_views : null,
    expiresAt: row ? row.expires_at : null,
    events,
    replies,
  };
}
