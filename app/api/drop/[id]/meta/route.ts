import { NextResponse } from 'next/server';
import { getMeta } from '@/lib/store';
import { rateLimit, clientIp } from '@/lib/server';

export const runtime = 'nodejs';

// Flags only, never content. Lets the viewer warn before a read that
// would consume a limited view — and stops link-preview bots from
// silently burning a one-shot drop.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!rateLimit(`meta:${clientIp(req)}`, 240, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }
  const meta = await getMeta(params.id);
  if (!meta) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(meta, { headers: { 'Cache-Control': 'no-store' } });
}
