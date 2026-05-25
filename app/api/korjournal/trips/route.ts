import { NextRequest, NextResponse } from 'next/server';
import {
  createTripSchema,
  getKorjournalRouteContext,
  normalizeOptionalKilometer,
  normalizeOptionalText,
  ok,
  routeError,
  tripsListQuerySchema,
} from './_lib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Table: korjournal_trips
// Columns: id (uuid) PK, created_at (timestamptz), user_id (text or uuid), date (date),
// start_address (text), end_address (text), start_km (int4), end_km (int4), note (text),
// sales_person (text, optional)

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parsedQuery = tripsListQuerySchema.safeParse({ ym: url.searchParams.get('ym') || undefined });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
    }

    const context = await getKorjournalRouteContext();
    if (context.response) return context.response;

    const ym = parsedQuery.data.ym;
    let q = context.supabase.from('korjournal_trips').select('*').eq('user_id', context.user.id).order('date', { ascending: false });
    if (ym) {
      // filter by month [ym-01, nextMonth-01)
      const [yStr, mStr] = ym.split('-');
      const y = Number(yStr);
      const m = Number(mStr); // 1-12
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const start = `${yStr}-${mStr.padStart(2,'0')}-01`;
      const end = `${String(nextY)}-${String(nextM).padStart(2,'0')}-01`;
      q = q.gte('date', start).lt('date', end);
    }
    const { data, error } = await q;
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

    const today = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const defaultDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const startKm = normalizeOptionalKilometer(parsedBody.data.startKm);
    const endKm = normalizeOptionalKilometer(parsedBody.data.endKm);

    if (Number.isNaN(startKm) || Number.isNaN(endKm)) {
      return routeError(400, 'validation_error', 'Invalid kilometer value');
    }

    const trip = {
      date: parsedBody.data.date?.trim() || defaultDate,
      start_address: parsedBody.data.startAddress === undefined || parsedBody.data.startAddress === null ? '' : String(parsedBody.data.startAddress),
      end_address: parsedBody.data.endAddress === undefined || parsedBody.data.endAddress === null ? '' : String(parsedBody.data.endAddress),
      start_km: startKm,
      end_km: endKm,
      note: normalizeOptionalText(parsedBody.data.note),
      user_id: context.user.id,
      sales_person: normalizeOptionalText(parsedBody.data.salesPerson),
    };
    const { data, error } = await context.supabase.from('korjournal_trips').insert(trip).select('*').single();
    if (error) return routeError(500, 'trip_create_failed', error.message);
    return ok({ trip: data }, { trip: data }, 201);
  } catch (e: any) {
    return routeError(500, 'trip_create_failed', e.message);
  }
}
