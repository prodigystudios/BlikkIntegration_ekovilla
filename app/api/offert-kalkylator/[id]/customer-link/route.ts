import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateCustomerToken, hashCustomerToken } from '@/lib/offertCustomerTokens';
import { getPublicOrigin } from '@/lib/publicOrigin';
import { applyOffertOwnerScope, getOffertAccessContext } from '@/lib/offertAccess';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const routeParamsSchema = z.object({
  id: z.string().trim().min(1, 'Missing offert id'),
});

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
    },
    { status },
  );
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const supabase = getOptionalSupabaseAdmin();
    if (!supabase) return routeError(500, 'service_role_missing', 'Admin supabase not configured');

    const access = await getOffertAccessContext();
    if (!access.user) return routeError(401, 'unauthorized', 'Unauthorized');

    const parsedParams = routeParamsSchema.safeParse({ id: ctx?.params?.id });
    if (!parsedParams.success) {
      return routeError(400, 'validation_error', 'Missing offert id', parsedParams.error.flatten());
    }

    const { id: offertId } = parsedParams.data;

    const offerQuery = applyOffertOwnerScope(
      supabase
        .from('offert_calculations')
        .select('id, user_id')
        .eq('id', offertId),
      access.userId,
      access.canViewAll,
    );

    const { data: offer, error: offerErr } = await offerQuery.maybeSingle();

    if (offerErr) return routeError(500, 'offer_query_failed', offerErr.message);
    if (!offer) return routeError(404, 'offert_not_found', 'Not found');

    // Revoke any previous pending requests for this offer.
    const nowIso = new Date().toISOString();
    const { error: revokeError } = await supabase
      .from('offert_customer_requests')
      .update({ status: 'revoked', revoked_at: nowIso })
      .eq('offert_id', offertId)
      .eq('status', 'pending');
    if (revokeError) return routeError(500, 'revoke_previous_requests_failed', revokeError.message);

    const token = generateCustomerToken();
    const tokenHash = hashCustomerToken(token);

    const origin = getPublicOrigin(req);

    const sellerUserId = String((offer as any)?.user_id || access.userId);

    let sellerEmail = (access.user.email || '').trim();
    if (!sellerEmail) {
      try {
        const { data } = await supabase.auth.admin.getUserById(sellerUserId);
        sellerEmail = (data?.user?.email || '').trim();
      } catch {
        // ignore
      }
    }

    if (sellerUserId !== access.userId) {
      try {
        const { data } = await supabase.auth.admin.getUserById(sellerUserId);
        sellerEmail = (data?.user?.email || sellerEmail || '').trim();
      } catch {
        // ignore
      }
    }

    const { data: inserted, error: insErr } = await supabase
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

    if (insErr) return routeError(500, 'customer_request_insert_failed', insErr.message);

    const payload = {
      requestId: inserted.id,
      status: inserted.status,
      createdAt: inserted.created_at,
      url: `${origin}/kund/offert/${token}`,
    };

    return ok(payload, payload);
  } catch (e: any) {
    return routeError(500, 'customer_link_failed', e?.message ?? 'Unknown error');
  }
}
