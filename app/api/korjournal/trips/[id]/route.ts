import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = params;
    const cookieStore = cookies();
    const supa = createRouteHandlerClient({ cookies: () => cookieStore });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const updates: any = {};
    if (body.date !== undefined) updates.date = body.date;
    if (body.startAddress !== undefined) updates.start_address = String(body.startAddress);
    if (body.endAddress !== undefined) updates.end_address = String(body.endAddress);
    if (body.startKm !== undefined) {
      updates.start_km = (body.startKm === '' || body.startKm === null) ? null : Number(body.startKm);
    }
    if (body.endKm !== undefined) {
      updates.end_km = (body.endKm === '' || body.endKm === null) ? null : Number(body.endKm);
    }
    if (body.note !== undefined) updates.note = body.note ? String(body.note) : null;

    // RLS ensures only owner can update; still scope by id
    const { data, error } = await supa
      .from('korjournal_trips')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ trip: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = params;
    const cookieStore = cookies();
    const supa = createRouteHandlerClient({ cookies: () => cookieStore });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { error } = await supa
      .from('korjournal_trips')
      .delete()
      .eq('id', id)
      .limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
