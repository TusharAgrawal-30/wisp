import { NextResponse } from 'next/server';
import { consumeDrop, destroyDrop } from '@/lib/store';
import { sha256, rateLimit, clientIp } from '@/lib/server';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!rateLimit(`read:${clientIp(req)}`, 120, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }
  const drop = await consumeDrop(params.id);
  if (!drop) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(drop, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const token = req.headers.get('x-destroy-token');
  if (!token) {
    return NextResponse.json({ error: 'Missing destroy token.' }, { status: 401 });
  }
  const ok = await destroyDrop(params.id, sha256(token));
  if (!ok) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
