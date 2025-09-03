import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Table: korjournal_trips
// Columns: id (uuid) PK, created_at (timestamptz), user_id (text or uuid), date (date),
// start_address (text), end_address (text), start_km (int4), end_km (int4), note (text),
// sales_person (text, optional)

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
  const ym = url.searchParams.get('ym'); // optional YYYY-MM filter
  const cookieStore = cookies();
  const supa = createRouteHandlerClient({ cookies: () => cookieStore });
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let q = supa.from('korjournal_trips').select('*').eq('user_id', user.id).order('date', { ascending: false });
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
    if (error) throw error;
    return NextResponse.json({ trips: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const supa = createRouteHandlerClient({ cookies: () => cookieStore });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const today = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const defaultDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const trip = {
      date: body.date || defaultDate,
      start_address: body.startAddress === undefined || body.startAddress === null ? '' : String(body.startAddress),
      end_address: body.endAddress === undefined || body.endAddress === null ? '' : String(body.endAddress),
      start_km: body.startKm === '' || body.startKm === null || body.startKm === undefined ? null : Number(body.startKm),
      end_km: body.endKm === '' || body.endKm === null || body.endKm === undefined ? null : Number(body.endKm),
      note: body.note ? String(body.note) : null,
      user_id: user.id,
      sales_person: body.salesPerson ? String(body.salesPerson) : null,
    };
    const { data, error } = await supa.from('korjournal_trips').insert(trip).select('*').single();
    if (error) throw error;
    return NextResponse.json({ trip: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
