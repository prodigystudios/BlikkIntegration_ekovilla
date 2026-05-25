import { NextResponse } from 'next/server';
import { z } from 'zod';
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

export async function GET(_req: Request, ctx: { params: { id: string } }) {
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
        .select('id')
        .eq('id', offertId),
      access.userId,
      access.canViewAll,
    );
    const { data: offer, error: offerErr } = await offerQuery.maybeSingle();
    if (offerErr) return routeError(500, 'offer_query_failed', offerErr.message);
    if (!offer) return routeError(404, 'offert_not_found', 'Not found');

    const { data: latestReq, error: reqErr } = await supabase
      .from('offert_customer_requests')
      .select('id, submitted_at, created_at')
      .eq('offert_id', offertId)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reqErr) return routeError(500, 'customer_request_query_failed', reqErr.message);
    if (!latestReq) return ok({ response: null }, { response: null });

    const { data: response, error: respErr } = await supabase
      .from('offert_customer_responses')
      .select('*')
      .eq('request_id', latestReq.id)
      .maybeSingle();

    if (respErr) return routeError(500, 'customer_response_query_failed', respErr.message);

    const payload = {
      response: response || null,
      submittedAt: latestReq.submitted_at,
    };

    return ok(payload, payload);
  } catch (e: any) {
    return routeError(500, 'customer_response_failed', e?.message ?? 'Unknown error');
  }
}
