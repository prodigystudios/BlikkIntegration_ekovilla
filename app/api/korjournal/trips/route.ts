import { NextRequest } from 'next/server';
import { createTripSchema, getKorjournalRouteContext, ok, routeError, tripsListQuerySchema } from './_lib';
import { buildCreateTripRow, createKorjournalTrip, listKorjournalTrips } from '@/lib/domains/korjournal/trips';
import { todayISO } from '@/lib/domains/korjournal/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Table: korjournal_trips (RLS scopes rows to the authenticated user).
// Query building + payload mapping live in lib/domains/korjournal/trips.

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parsedQuery = tripsListQuerySchema.safeParse({ ym: url.searchParams.get('ym') || undefined });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
    }

    const context = await getKorjournalRouteContext();
    if (context.response) return context.response;

    const { data, error } = await listKorjournalTrips(context.supabase, {
      userId: context.user.id,
      ym: parsedQuery.data.ym,
    });
    if (error) return routeError(500, 'trips_query_failed', error.message);
    return ok({ trips: data ?? [] }, { trips: data ?? [] });
  } catch (e: any) {
    return routeError(500, 'trips_fetch_failed', e.message);
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await getKorjournalRouteContext();
    if (context.response) return context.response;

    const parsedBody = createTripSchema.safeParse(await req.json());
    if (!parsedBody.success) {
      return routeError(400, 'validation_error', 'Invalid request body', parsedBody.error.flatten());
    }

    const built = buildCreateTripRow(parsedBody.data, { userId: context.user.id, defaultDate: todayISO() });
    if ('error' in built) return routeError(400, 'validation_error', 'Invalid kilometer value');

    const { data, error } = await createKorjournalTrip(context.supabase, built.row);
    if (error) return routeError(500, 'trip_create_failed', error.message);
    return ok({ trip: data }, { trip: data }, 201);
  } catch (e: any) {
    return routeError(500, 'trip_create_failed', e.message);
  }
}
