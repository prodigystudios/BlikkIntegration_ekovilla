import { NextRequest, NextResponse } from 'next/server';
import {
  getKorjournalRouteContext,
  normalizeOptionalKilometer,
  normalizeOptionalText,
  ok,
  routeError,
  tripIdParamsSchema,
  updateTripSchema,
} from '../_lib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const parsedParams = tripIdParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return routeError(400, 'validation_error', 'Missing id', parsedParams.error.flatten());
    }

    const context = await getKorjournalRouteContext();
    if (context.response) return context.response;

    const parsedBody = updateTripSchema.safeParse(await req.json());
    if (!parsedBody.success) {
      const flattened = parsedBody.error.flatten();
      const message = flattened.formErrors[0] || 'Invalid request body';
      return routeError(400, 'validation_error', message, flattened);
    }

    const { id } = parsedParams.data;
    const body = parsedBody.data;
    const updates: any = {};
    if (body.date !== undefined) updates.date = body.date;
    if (body.startAddress !== undefined) updates.start_address = body.startAddress == null ? '' : String(body.startAddress);
    if (body.endAddress !== undefined) updates.end_address = body.endAddress == null ? '' : String(body.endAddress);
    if (body.startKm !== undefined) {
      const startKm = normalizeOptionalKilometer(body.startKm);
      if (Number.isNaN(startKm)) return routeError(400, 'validation_error', 'Invalid kilometer value');
      updates.start_km = startKm;
    }
    if (body.endKm !== undefined) {
      const endKm = normalizeOptionalKilometer(body.endKm);
      if (Number.isNaN(endKm)) return routeError(400, 'validation_error', 'Invalid kilometer value');
      updates.end_km = endKm;
    }
    if (body.note !== undefined) updates.note = normalizeOptionalText(body.note);

    // RLS ensures only owner can update; still scope by id
    const { data, error } = await context.supabase
      .from('korjournal_trips')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return routeError(500, 'trip_update_failed', error.message);
    if (!data) return routeError(404, 'trip_not_found', 'Not found');
    return ok({ trip: data }, { trip: data });
  } catch (e: any) {
    return routeError(500, 'trip_update_failed', e.message);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const parsedParams = tripIdParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return routeError(400, 'validation_error', 'Missing id', parsedParams.error.flatten());
    }

    const context = await getKorjournalRouteContext();
    if (context.response) return context.response;

    const { id } = parsedParams.data;

    const { error } = await context.supabase
      .from('korjournal_trips')
      .delete()
      .eq('id', id)
      .limit(1);
    if (error) return routeError(500, 'trip_delete_failed', error.message);
    return ok({ deleted: true }, { deleted: true });
  } catch (e: any) {
    return routeError(500, 'trip_delete_failed', e.message);
  }
}
