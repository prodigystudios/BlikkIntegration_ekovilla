import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/adminSupabase';
import { hashCustomerToken } from '@/lib/offertCustomerTokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatOffertNumber(year: any, seq: any) {
  const y = Number(year);
  const s = Number(seq);
  if (!Number.isFinite(y) || !Number.isFinite(s) || y <= 0 || s <= 0) return '';
  return `${y}-${String(Math.trunc(s)).padStart(5, '0')}`;
}

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

    // Return only non-PII offer identifiers + totals so customer feels safe they are on the right offer.
    const { data: offer, error: offerErr } = await adminSupabase
      .from('offert_calculations')
      .select('offert_number_year, offert_number_seq, total_before_rot, rot_amount, total_after_rot')
      .eq('id', requestRow.offert_id)
      .maybeSingle();

    if (offerErr) throw offerErr;
    if (!offer) return NextResponse.json({ error: 'Offert not found' }, { status: 404 });

    const offertNumber = formatOffertNumber((offer as any).offert_number_year, (offer as any).offert_number_seq);

    return NextResponse.json({
      ok: true,
      offertNumber,
      totalBeforeRot: Number((offer as any).total_before_rot) || 0,
      rotAmount: Number((offer as any).rot_amount) || 0,
      totalAfterRot: Number((offer as any).total_after_rot) || 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
