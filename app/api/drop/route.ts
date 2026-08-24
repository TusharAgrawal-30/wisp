import { NextResponse } from 'next/server';
import { insertDrop } from '@/lib/store';
import { sha256, randomId, rateLimit, clientIp } from '@/lib/server';

export const runtime = 'nodejs';

const MAX_BLOB_BYTES = 12 * 1024 * 1024; // ~12 MB ciphertext (a few encrypted files)

const EXPIRY_CHOICES: Record<string, number | null> = {
  '10m': 10 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  never: null,
};

const VIEW_CHOICES = new Set([1, 3, 5, 0]); // 0 = unlimited

export async function POST(req: Request) {
  if (!rateLimit(`create:${clientIp(req)}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many drops, slow down.' }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { blob, maxViews, expiry, allowReply } = body || {};

  if (typeof blob !== 'string' || blob.length === 0) {
    return NextResponse.json({ error: 'Missing content.' }, { status: 400 });
  }
  if (blob.length > MAX_BLOB_BYTES) {
    return NextResponse.json({ error: 'Content too large.' }, { status: 413 });
  }
  if (!(expiry in EXPIRY_CHOICES)) {
    return NextResponse.json({ error: 'Invalid expiry.' }, { status: 400 });
  }
  if (!VIEW_CHOICES.has(maxViews)) {
    return NextResponse.json({ error: 'Invalid view limit.' }, { status: 400 });
  }

  // Nothing lives forever here — "never" really means "until the views
  // run out, capped at 30 days". Keeps the store from accumulating
  // drops nobody will ever open again.
  const ttl = EXPIRY_CHOICES[expiry] ?? EXPIRY_CHOICES['30d'];
  const effectiveTtl = ttl === null ? (EXPIRY_CHOICES['30d'] as number) : ttl;

  const id = randomId(8);
  const destroyToken = randomId(16);

  await insertDrop({
    id,
    blob,
    maxViews: maxViews === 0 ? null : maxViews,
    allowReply: !!allowReply,
    expiresAt: Date.now() + effectiveTtl,
    destroyHash: sha256(destroyToken),
  });

  return NextResponse.json({ id, destroyToken });
}
