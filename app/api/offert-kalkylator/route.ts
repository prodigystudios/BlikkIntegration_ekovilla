import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';
import { computeOffertKalkylator, OFFERT_KALKYLATOR_DEFAULT_STATE } from '@/lib/offertKalkylator';
import { applyOffertOwnerScope, getOffertAccessContext } from '@/lib/offertAccess';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const listQuerySchema = z.object({
  scope: z.enum(['all']).optional(),
});

const createBodySchema = z.object({
  name: z.string().trim().min(1, 'Missing name'),
  address: z.string().trim().min(1, 'Missing address'),
  city: z.string().trim().min(1, 'Missing city'),
  phone: z.string().trim().optional().default(''),
  quoteDate: z.string().trim().min(1, 'Missing quoteDate'),
  salesperson: z.string().trim().min(1, 'Missing salesperson'),
  salespersonPhone: z.string().trim().optional().default(''),
  nextMeetingDate: z.string().trim().optional().default(''),
  status: z.string().trim().optional().default(''),
  internalNote: z.string().trim().optional().default(''),
  payload: z.record(z.any()),
});

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}

export async function GET(req: NextRequest) {
  try {
    const access = await getOffertAccessContext();
    if (!access.user) return routeError(401, 'unauthorized', 'Unauthorized');

    const parsedQuery = listQuerySchema.safeParse({
      scope: req.nextUrl.searchParams.get('scope') || undefined,
    });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
    }

    const requestedAll = parsedQuery.data.scope === 'all';
    const includeAll = requestedAll && access.canViewAll;
    const adminClient = getOptionalSupabaseAdmin();
    const db = includeAll && adminClient ? adminClient : access.supabase;

    const scopedQuery = applyOffertOwnerScope(
      db
      .from('offert_calculations')
      .select('id, user_id, offert_number_year, offert_number_seq, name, address, city, phone, quote_date, salesperson, salesperson_phone, status, next_meeting_date, internal_note, created_at, updated_at, subtotal, total_before_rot, rot_amount, total_after_rot')
      .order('created_at', { ascending: false }),
      access.userId,
      includeAll,
    );

    const { data, error } = await scopedQuery;

  if (error) return routeError(500, 'offert_list_query_failed', error.message);

    const items = (data ?? []) as any[];

    if (adminClient && items.length > 0) {
      const ownerIds = Array.from(new Set(items.map((item) => String(item.user_id || '').trim()).filter(Boolean)));
      if (ownerIds.length > 0) {
        const { data: profiles, error: profileErr } = await adminClient
          .from('profiles')
          .select('id, full_name')
          .in('id', ownerIds);

        if (profileErr) {
          if (process.env.NODE_ENV !== 'production') console.warn('[offert-kalkylator GET] owner lookup failed', profileErr.message);
        } else {
          const ownerNames = new Map<string, string>();
          for (const profile of (profiles || []) as any[]) {
            const ownerId = String(profile?.id || '').trim();
            const fullName = String(profile?.full_name || '').trim();
            if (ownerId) ownerNames.set(ownerId, fullName);
          }

          for (const item of items) {
            (item as any).owner_name = ownerNames.get(String(item.user_id || '').trim()) || null;
          }
        }
      }
    }

    // Optional: attach customer-response status per offer.
    if (adminClient && items.length > 0) {
      const ids = items.map((x) => String(x.id)).filter(Boolean);
      const { data: reqRows, error: reqErr } = await adminClient
        .from('offert_customer_requests')
        .select('offert_id, submitted_at')
        .eq('status', 'submitted')
        .in('offert_id', ids);

      if (reqErr) {
        // Non-fatal: just return list without labels.
        if (process.env.NODE_ENV !== 'production') console.warn('[offert-kalkylator GET] customer req lookup failed', reqErr.message);
      } else {
        const byOffertId = new Map<string, string>();
        for (const r of (reqRows || []) as any[]) {
          const offId = String(r?.offert_id || '').trim();
          const sub = r?.submitted_at ? String(r.submitted_at) : '';
          if (!offId || !sub) continue;
          const prev = byOffertId.get(offId);
          if (!prev || String(sub).localeCompare(prev) > 0) byOffertId.set(offId, sub);
        }

        for (const it of items) {
          const sub = byOffertId.get(String(it.id)) || null;
          (it as any).customer_submitted_at = sub;
        }
      }
    }

    const payload = {
      items,
      canViewAll: access.canViewAll,
      currentUserId: access.userId,
      currentUserName: access.profileName,
    };

    return ok(payload, payload);
  } catch (e: any) {
    return routeError(500, 'offert_list_failed', e?.message ?? 'Unknown error');
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return routeError(401, 'unauthorized', 'Unauthorized');

    const parsedBody = createBodySchema.safeParse(await req.json());
    if (!parsedBody.success) {
      const flattened = parsedBody.error.flatten();
      const message = flattened.formErrors[0] || 'Invalid request body';
      return routeError(400, 'validation_error', message, flattened);
    }

    const {
      name,
      address,
      city,
      phone,
      quoteDate,
      salesperson,
      salespersonPhone,
      nextMeetingDate,
      status,
      internalNote,
      payload,
    } = parsedBody.data;

    const computed = computeOffertKalkylator({
      ...OFFERT_KALKYLATOR_DEFAULT_STATE,
      ...payload,
    } as any);

    const insertRow = {
      user_id: user.id,
      name,
      address,
      city,
      phone,
      quote_date: quoteDate,
      salesperson,
      salesperson_phone: salespersonPhone,
      status: status || 'Återkoppling',
      next_meeting_date: nextMeetingDate || null,
      internal_note: internalNote,
      payload,
      subtotal: computed.subtotal,
      total_before_rot: computed.totalBeforeRot,
      rot_amount: computed.rotAmount,
      total_after_rot: computed.totalAfterRot,
    };

    const { data, error } = await supabase
      .from('offert_calculations')
      .insert(insertRow)
      .select('id, offert_number_year, offert_number_seq, name, address, city, phone, quote_date, salesperson, salesperson_phone, status, next_meeting_date, internal_note, created_at, updated_at, subtotal, total_before_rot, rot_amount, total_after_rot')
      .single();

    if (error) return routeError(500, 'offert_create_failed', error.message);
    return ok({ item: data }, { item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'offert_create_failed', e?.message ?? 'Unknown error');
  }
}
