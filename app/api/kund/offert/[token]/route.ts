import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashCustomerToken } from '@/lib/offertCustomerTokens';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const routeParamsSchema = z.object({
  token: z.string().trim().min(1, 'Invalid link'),
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

function formatOffertNumber(year: any, seq: any) {
  const y = Number(year);
  const s = Number(seq);
  if (!Number.isFinite(y) || !Number.isFinite(s) || y <= 0 || s <= 0) return '';
  return `${y}-${String(Math.trunc(s)).padStart(5, '0')}`;
}

export async function GET(req: NextRequest, ctx: { params: { token: string } }) {
  try {
    const supabase = getOptionalSupabaseAdmin();
    if (!supabase) return routeError(500, 'service_role_missing', 'Server not configured');

    const parsedParams = routeParamsSchema.safeParse({ token: ctx?.params?.token });
    if (!parsedParams.success) {
      return routeError(404, 'invalid_link', 'Invalid link', parsedParams.error.flatten());
    }

    const { token } = parsedParams.data;

    const tokenHash = hashCustomerToken(token);

    const { data: requestRow, error } = await supabase
      .from('offert_customer_requests')
      .select('id, status, expires_at, revoked_at, offert_id')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) return routeError(500, 'customer_request_query_failed', error.message);
    if (!requestRow) return routeError(404, 'invalid_link', 'Invalid link');

    if (requestRow.revoked_at) return routeError(410, 'request_revoked', 'Invalid link');
    if (requestRow.expires_at && new Date(requestRow.expires_at).getTime() < Date.now()) {
      return routeError(410, 'link_expired', 'Link expired');
    }
    if (requestRow.status !== 'pending') return routeError(410, 'already_submitted', 'Already submitted');

    // Return only non-PII offer identifiers + totals so customer feels safe they are on the right offer.
    const { data: offer, error: offerErr } = await supabase
      .from('offert_calculations')
      .select('offert_number_year, offert_number_seq, total_before_rot, rot_amount, total_after_rot')
      .eq('id', requestRow.offert_id)
      .maybeSingle();

    if (offerErr) return routeError(500, 'offert_query_failed', offerErr.message);
    if (!offer) return routeError(404, 'offert_not_found', 'Offert not found');

    const offertNumber = formatOffertNumber((offer as any).offert_number_year, (offer as any).offert_number_seq);

    const payload = {
      offertNumber,
      totalBeforeRot: Number((offer as any).total_before_rot) || 0,
      rotAmount: Number((offer as any).rot_amount) || 0,
      totalAfterRot: Number((offer as any).total_after_rot) || 0,
    };

    return ok(payload, payload);
  } catch (e: any) {
    return routeError(500, 'customer_offert_lookup_failed', e?.message ?? 'Unknown error');
  }
}
