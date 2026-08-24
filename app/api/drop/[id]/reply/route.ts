import { NextResponse } from 'next/server';
import { addReply } from '@/lib/store';
import { rateLimit, clientIp } from '@/lib/server';

export const runtime = 'nodejs';

const MAX_REPLY_BYTES = 256 * 1024;

// The reply blob was encrypted in the recipient's browser with the same
// key from the URL fragment — we store a sealed envelope we can't open.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!rateLimit(`reply:${clientIp(req)}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many replies.' }, { status: 429 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const { blob } = body || {};
  if (typeof blob !== 'string' || blob.length === 0) {
    return NextResponse.json({ error: 'Missing content.' }, { status: 400 });
  }
  if (blob.length > MAX_REPLY_BYTES) {
    return NextResponse.json({ error: 'Reply too large.' }, { status: 413 });
  }
  const result = await addReply(params.id, blob);
  if (result === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (result === 'closed') return NextResponse.json({ error: 'Replies are closed for this drop.' }, { status: 403 });
  if (result === 'full') return NextResponse.json({ error: 'Reply limit reached.' }, { status: 429 });
  return NextResponse.json({ ok: true });
}
