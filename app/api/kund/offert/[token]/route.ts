import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/adminSupabase';
import { hashCustomerToken } from '@/lib/offertCustomerTokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: { token: string } }) {
  try {
    if (!adminSupabase) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });

    const token = (ctx?.params?.token || '').trim();
    if (!token) return NextResponse.json({ error: 'Invalid link' }, { status: 404 });

    const tokenHash = hashCustomerToken(token);

    const { data: requestRow, error } = await adminSupabase
      .from('offert_customer_requests')
      .select('id, status, expires_at, revoked_at, offert_id')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) throw error;
    if (!requestRow) return NextResponse.json({ error: 'Invalid link' }, { status: 404 });

    if (requestRow.revoked_at) return NextResponse.json({ error: 'Invalid link' }, { status: 410 });
    if (requestRow.expires_at && new Date(requestRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Link expired' }, { status: 410 });
    }
    if (requestRow.status !== 'pending') return NextResponse.json({ error: 'Already submitted' }, { status: 410 });

    // We intentionally do NOT return any PII or offer details here.
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
