import { NextResponse } from 'next/server';
import { getWebPushPublicKey, isWebPushConfigured } from '@/lib/webPush';

export async function GET() {
  if (!isWebPushConfigured()) {
    return NextResponse.json({ ok: false, error: 'Push is not configured.' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, publicKey: getWebPushPublicKey() });
}