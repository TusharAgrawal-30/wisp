// Upstash Redis backend — used automatically when UPSTASH_REDIS_REST_URL
// and UPSTASH_REDIS_REST_TOKEN are set. Talks to the Upstash REST API with
// plain fetch, so there's no extra dependency.
//
// Data model (all values are opaque ciphertext or metadata, same
// zero-knowledge properties as the SQLite backend):
//   drop:{id}    JSON {blob, maxViews, allowReply, expiresAt, destroyHash, createdAt}
//                with a real Redis TTL, so expiry is enforced by the store itself
//   views:{id}   counter — INCR is atomic, which is what makes the last
//                read single-winner across serverless instances
//   events:{id}  list of JSON {type, at}
//   replies:{id} list of JSON {blob, created_at}
//   tomb:{id}    JSON {destroyHash, allowReply, createdAt, expiresAt} — outlives
//                the drop so the owner keeps their timeline

const URL_ = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

const TOMB_TTL_MS = 35 * 24 * 60 * 60 * 1000;
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REPLIES_PER_DROP = 50;

async function r(cmd: (string | number)[]): Promise<any> {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`redis ${cmd[0]} failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`redis ${cmd[0]}: ${data.error}`);
  return data.result;
}

interface DropDoc {
  blob: string;
  maxViews: number | null;
  allowReply: boolean;
  expiresAt: number | null;
  destroyHash: string;
  createdAt: number;
}

interface TombDoc {
  destroyHash: string;
  allowReply: boolean;
  createdAt: number;
  expiresAt: number | null;
}

async function logEvent(id: string, type: string) {
  await r(['RPUSH', `events:${id}`, JSON.stringify({ type, at: Date.now() })]);
  await r(['PEXPIRE', `events:${id}`, TOMB_TTL_MS]);
}

export async function insertDrop(rec: {
  id: string;
  blob: string;
  maxViews: number | null;
  allowReply: boolean;
  expiresAt: number | null;
  destroyHash: string;
}) {
  const now = Date.now();
  const doc: DropDoc = {
    blob: rec.blob,
    maxViews: rec.maxViews,
    allowReply: rec.allowReply,
    expiresAt: rec.expiresAt,
    destroyHash: rec.destroyHash,
    createdAt: now,
  };
  const ttl = rec.expiresAt === null ? TOMB_TTL_MS : Math.max(1000, rec.expiresAt - now);
  await r(['SET', `drop:${rec.id}`, JSON.stringify(doc), 'PX', ttl]);
  const tomb: TombDoc = {
    destroyHash: rec.destroyHash,
    allowReply: rec.allowReply,
    createdAt: now,
    expiresAt: rec.expiresAt,
  };
  await r(['SET', `tomb:${rec.id}`, JSON.stringify(tomb), 'PX', TOMB_TTL_MS]);
  await logEvent(rec.id, 'created');
}

async function getDrop(id: string): Promise<DropDoc | null> {
  const raw = await r(['GET', `drop:${id}`]);
  if (!raw) return null;
  const doc: DropDoc = JSON.parse(raw);
  if (doc.expiresAt !== null && doc.expiresAt < Date.now()) {
    await r(['DEL', `drop:${id}`]);
    return null;
  }
  return doc;
}

async function getViews(id: string): Promise<number> {
  const raw = await r(['GET', `views:${id}`]);
  return raw ? parseInt(raw, 10) : 0;
}

export async function getMeta(id: string) {
  const doc = await getDrop(id);
  if (!doc) return null;
  const views = await getViews(id);
  return {
    maxViews: doc.maxViews,
    views,
    viewsLeft: doc.maxViews === null ? null : doc.maxViews - views,
    allowReply: doc.allowReply,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
  };
}

// The atomic INCR makes the last view single-winner: exactly one caller
// lands on views === maxViews; anyone past that gets null.
export async function consumeDrop(id: string) {
  const doc = await getDrop(id);
  if (!doc) return null;

  const views: number = await r(['INCR', `views:${id}`]);
  await r(['PEXPIRE', `views:${id}`, TOMB_TTL_MS]);

  if (doc.maxViews !== null && views > doc.maxViews) return null; // lost the race

  const burned = doc.maxViews !== null && views === doc.maxViews;
  if (burned) await r(['DEL', `drop:${id}`]);

  await logEvent(id, 'read');
  if (burned) await logEvent(id, 'burned');

  return {
    blob: doc.blob,
    burned,
    views,
    maxViews: doc.maxViews,
    allowReply: doc.allowReply,
    expiresAt: doc.expiresAt,
  };
}

export async function destroyDrop(id: string, destroyHash: string): Promise<boolean> {
  const rawTomb = await r(['GET', `tomb:${id}`]);
  if (!rawTomb) return false;
  const tomb: TombDoc = JSON.parse(rawTomb);
  if (tomb.destroyHash !== destroyHash) return false;
  const deleted: number = await r(['DEL', `drop:${id}`]);
  if (deleted > 0) {
    await logEvent(id, 'destroyed');
    return true;
  }
  return false;
}

export async function addReply(id: string, blob: string): Promise<'ok' | 'not_found' | 'closed' | 'full'> {
  const rawTomb = await r(['GET', `tomb:${id}`]);
  if (!rawTomb) return 'not_found';
  const tomb: TombDoc = JSON.parse(rawTomb);
  if (!tomb.allowReply) return 'closed';
  if (Date.now() - tomb.createdAt > REPLY_WINDOW_MS) return 'closed';
  const count: number = await r(['LLEN', `replies:${id}`]);
  if (count >= MAX_REPLIES_PER_DROP) return 'full';
  await r(['RPUSH', `replies:${id}`, JSON.stringify({ blob, created_at: Date.now() })]);
  await r(['PEXPIRE', `replies:${id}`, TOMB_TTL_MS]);
  await logEvent(id, 'reply');
  return 'ok';
}

export async function getOwnerView(id: string, destroyHash: string) {
  const rawTomb = await r(['GET', `tomb:${id}`]);
  if (!rawTomb) return null;
  const tomb: TombDoc = JSON.parse(rawTomb);
  if (tomb.destroyHash !== destroyHash) return null;

  const doc = await getDrop(id);
  const views = await getViews(id);

  const rawEvents: string[] = (await r(['LRANGE', `events:${id}`, 0, -1])) || [];
  const events = rawEvents.map((e) => JSON.parse(e) as { type: string; at: number });

  // the store expires drops via TTL, so there's no moment to log an
  // 'expired' event — synthesize one for the timeline when applicable
  const terminal = events.some((e) => e.type === 'burned' || e.type === 'destroyed' || e.type === 'expired');
  if (!doc && !terminal && tomb.expiresAt !== null && tomb.expiresAt < Date.now()) {
    events.push({ type: 'expired', at: tomb.expiresAt });
  }

  const rawReplies: string[] = (await r(['LRANGE', `replies:${id}`, 0, -1])) || [];
  const replies = rawReplies.map((x) => JSON.parse(x) as { blob: string; created_at: number });

  return {
    alive: !!doc,
    views: doc ? views : null,
    maxViews: doc ? doc.maxViews : null,
    expiresAt: doc ? doc.expiresAt : null,
    events,
    replies,
  };
}
