import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminSupabase } from '@/lib/adminSupabase';
import { generateCustomerToken, hashCustomerToken } from '@/lib/offertCustomerTokens';
import { getPublicOrigin } from '@/lib/publicOrigin';
import { applyOffertOwnerScope, getOffertAccessContext } from '@/lib/offertAccess';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    if (!adminSupabase) return NextResponse.json({ error: 'Admin supabase not configured' }, { status: 500 });

    const access = await getOffertAccessContext();
    if (!access.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const offertId = (ctx?.params?.id || '').trim();
    if (!offertId) return NextResponse.json({ error: 'Missing offert id' }, { status: 400 });

    const offerQuery = applyOffertOwnerScope(
      adminSupabase
        .from('offert_calculations')
        .select('id, user_id')
        .eq('id', offertId),
      access.userId,
      access.canViewAll,
    );

    const { data: offer, error: offerErr } = await offerQuery.maybeSingle();

    if (offerErr) throw offerErr;
    if (!offer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Revoke any previous pending requests for this offer.
    const nowIso = new Date().toISOString();
    await adminSupabase
      .from('offert_customer_requests')
      .update({ status: 'revoked', revoked_at: nowIso })
      .eq('offert_id', offertId)
      .eq('status', 'pending');

    const token = generateCustomerToken();
    const tokenHash = hashCustomerToken(token);

    const origin = getPublicOrigin(req);

    const sellerUserId = String((offer as any)?.user_id || access.userId);

    let sellerEmail = (access.user.email || '').trim();
    if (!sellerEmail) {
      try {
        const { data } = await adminSupabase.auth.admin.getUserById(sellerUserId);
        sellerEmail = (data?.user?.email || '').trim();
      } catch {
        // ignore
      }
    }

    if (sellerUserId !== access.userId) {
      try {
        const { data } = await adminSupabase.auth.admin.getUserById(sellerUserId);
        sellerEmail = (data?.user?.email || sellerEmail || '').trim();
      } catch {
        // ignore
      }
    }

    const { data: inserted, error: insErr } = await adminSupabase
      .from('offert_customer_requests')
      .insert({
        offert_id: offertId,
        seller_user_id: sellerUserId,
        seller_email: sellerEmail,
        token_hash: tokenHash,
        status: 'pending',
      })
      .select('id, status, created_at')
      .single();

    if (insErr) throw insErr;

    return NextResponse.json({
      requestId: inserted.id,
      status: inserted.status,
      createdAt: inserted.created_at,
      url: `${origin}/kund/offert/${token}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
