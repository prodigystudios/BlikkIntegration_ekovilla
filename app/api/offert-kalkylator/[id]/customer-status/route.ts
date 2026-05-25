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

    const { data: latest, error } = await supabase
      .from('offert_customer_requests')
      .select('id, status, created_at, submitted_at, revoked_at')
      .eq('offert_id', offertId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return routeError(500, 'customer_status_query_failed', error.message);

    if (!latest) {
      return ok({ status: 'none' as const }, { status: 'none' as const });
    }

    const payload = {
      status: latest.status || 'none',
      createdAt: latest.created_at,
      submittedAt: latest.submitted_at,
      revokedAt: latest.revoked_at,
    };

    return ok(payload, payload);
  } catch (e: any) {
    return routeError(500, 'customer_status_failed', e?.message ?? 'Unknown error');
  }
}
