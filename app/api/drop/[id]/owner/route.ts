import { NextResponse } from 'next/server';
import { getOwnerView } from '@/lib/store';
import { sha256, rateLimit, clientIp } from '@/lib/server';

export const runtime = 'nodejs';

// The vault's data source. Ownership is proven by the destroy token —
// no accounts, no cookies. Returns status, the event timeline, and any
// sealed reply envelopes (which only the owner's browser can decrypt,
// because it kept the key).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!rateLimit(`owner:${clientIp(req)}`, 240, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }
  const token = req.headers.get('x-destroy-token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token.' }, { status: 401 });
  }
  const view = await getOwnerView(params.id, sha256(token));
  if (!view) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
}
