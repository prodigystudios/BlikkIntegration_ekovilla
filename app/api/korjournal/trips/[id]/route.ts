import { NextRequest } from 'next/server';
import { getKorjournalRouteContext, ok, routeError, tripIdParamsSchema, updateTripSchema } from '../_lib';
import { buildUpdateTripRow, deleteKorjournalTrip, updateKorjournalTrip } from '@/lib/domains/korjournal/trips';

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

    const built = buildUpdateTripRow(parsedBody.data);
    if ('error' in built) return routeError(400, 'validation_error', 'Invalid kilometer value');

    // RLS ensures only the owner can update; still scope by id.
    const { data, error } = await updateKorjournalTrip(context.supabase, parsedParams.data.id, built.row);
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

    const { error } = await deleteKorjournalTrip(context.supabase, parsedParams.data.id);
    if (error) return routeError(500, 'trip_delete_failed', error.message);
    return ok({ deleted: true }, { deleted: true });
  } catch (e: any) {
    return routeError(500, 'trip_delete_failed', e.message);
  }
}
