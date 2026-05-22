import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { computeOffertKalkylator, OFFERT_KALKYLATOR_DEFAULT_STATE } from '@/lib/offertKalkylator';
import { applyOffertOwnerScope, getOffertAccessContext } from '@/lib/offertAccess';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const routeParamsSchema = z.object({
  id: z.string().trim().min(1, 'Missing id'),
});

const patchBodySchema = z.object({
  name: z.string().trim().min(1, 'Missing name').optional(),
  address: z.string().trim().min(1, 'Missing address').optional(),
  city: z.string().trim().min(1, 'Missing city').optional(),
  phone: z.string().trim().optional(),
  quoteDate: z.string().trim().min(1, 'Missing quoteDate').optional(),
  salesperson: z.string().trim().min(1, 'Missing salesperson').optional(),
  salespersonPhone: z.string().trim().optional(),
  status: z.string().trim().optional(),
  internalNote: z.string().trim().optional(),
  nextMeetingDate: z.string().trim().optional(),
  payload: z.record(z.any()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Nothing to update',
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

function parseRouteId(params: { id: string }) {
  const parsed = routeParamsSchema.safeParse({ id: params?.id });
  if (!parsed.success) {
    return {
      error: routeError(400, 'validation_error', 'Missing id', parsed.error.flatten()),
      id: null,
    };
  }

  return { error: null, id: parsed.data.id };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedRoute = parseRouteId(params);
    if (parsedRoute.error) return parsedRoute.error;
    const id = parsedRoute.id;

    const access = await getOffertAccessContext();
    if (!access.user) return routeError(401, 'unauthorized', 'Unauthorized');

    const includeAll = access.canViewAll;
    const adminClient = getOptionalSupabaseAdmin();
    const db = includeAll && adminClient ? adminClient : access.supabase;

    const scopedQuery = applyOffertOwnerScope(
      db.from('offert_calculations').select('*').eq('id', id),
      access.userId,
      includeAll,
    );

    const { data, error } = await scopedQuery.single();

    if (error) return routeError(500, 'offert_query_failed', error.message);
    return ok({ item: data }, { item: data });
  } catch (e: any) {
    return routeError(500, 'offert_lookup_failed', e?.message ?? 'Unknown error');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedRoute = parseRouteId(params);
    if (parsedRoute.error) return parsedRoute.error;
    const id = parsedRoute.id;

    const access = await getOffertAccessContext();
    if (!access.user) return routeError(401, 'unauthorized', 'Unauthorized');

    const includeAll = access.canViewAll;
    const adminClient = getOptionalSupabaseAdmin();
    const db = includeAll && adminClient ? adminClient : access.supabase;

    const scopedQuery = applyOffertOwnerScope(
      db.from('offert_calculations').delete().eq('id', id),
      access.userId,
      includeAll,
    );

    const { error } = await scopedQuery;

    if (error) return routeError(500, 'offert_delete_failed', error.message);
    return ok({ deleted: true }, { deleted: true });
  } catch (e: any) {
    return routeError(500, 'offert_delete_failed', e?.message ?? 'Unknown error');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedRoute = parseRouteId(params);
    if (parsedRoute.error) return parsedRoute.error;
    const id = parsedRoute.id;

    const access = await getOffertAccessContext();
    if (!access.user) return routeError(401, 'unauthorized', 'Unauthorized');

    const includeAll = access.canViewAll;
    const adminClient = getOptionalSupabaseAdmin();
    const db = includeAll && adminClient ? adminClient : access.supabase;

    const parsedBody = patchBodySchema.safeParse(await req.json());
    if (!parsedBody.success) {
      const flattened = parsedBody.error.flatten();
      const message = flattened.formErrors[0] || 'Invalid request body';
      return routeError(400, 'validation_error', message, flattened);
    }

    const body = parsedBody.data;

    const update: any = {};
    if ('name' in body) update.name = body.name;
    if ('address' in body) update.address = body.address;
    if ('city' in body) update.city = body.city;
    if ('phone' in body) update.phone = body.phone;
    if ('quoteDate' in body) update.quote_date = body.quoteDate;
    if ('salesperson' in body) update.salesperson = body.salesperson;
    if ('salespersonPhone' in body) update.salesperson_phone = body.salespersonPhone;
    if ('status' in body) update.status = body.status;
    if ('internalNote' in body) update.internal_note = body.internalNote;
    if ('nextMeetingDate' in body) {
      update.next_meeting_date = body.nextMeetingDate || null;
    }

    if ('payload' in body) {
      const payload = body.payload;
      if (!payload || typeof payload !== 'object') {
        return routeError(400, 'validation_error', 'Missing payload');
      }

      const computed = computeOffertKalkylator({
        ...OFFERT_KALKYLATOR_DEFAULT_STATE,
        ...payload,
      } as any);

      update.payload = payload;
      update.subtotal = computed.subtotal;
      update.total_before_rot = computed.totalBeforeRot;
      update.rot_amount = computed.rotAmount;
      update.total_after_rot = computed.totalAfterRot;
    }

    if ('status' in update && !update.status) delete update.status;

    if (Object.keys(update).length === 0) return routeError(400, 'validation_error', 'Nothing to update');

    const scopedQuery = applyOffertOwnerScope(
      db
        .from('offert_calculations')
        .update(update)
        .eq('id', id)
        .select('id, offert_number_year, offert_number_seq, name, address, city, phone, quote_date, salesperson, salesperson_phone, status, next_meeting_date, internal_note, created_at, updated_at, subtotal, total_before_rot, rot_amount, total_after_rot'),
      access.userId,
      includeAll,
    );

    const { data, error } = await scopedQuery.single();

    if (error) return routeError(500, 'offert_update_failed', error.message);
    return ok({ item: data }, { item: data });
  } catch (e: any) {
    return routeError(500, 'offert_update_failed', e?.message ?? 'Unknown error');
  }
}
