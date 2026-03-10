import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = String(params?.id || '');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('offert_calculations')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = String(params?.id || '');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { error } = await supabase
      .from('offert_calculations')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = String(params?.id || '');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const status = typeof body?.status === 'string' ? body.status.trim() : '';
    const nextMeetingDate = typeof body?.nextMeetingDate === 'string' ? body.nextMeetingDate.trim() : '';

    const update: any = {};
    if (name) update.name = name;
    if (status) update.status = status;
    if ('nextMeetingDate' in (body || {})) update.next_meeting_date = nextMeetingDate || null;
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    const { data, error } = await supabase
      .from('offert_calculations')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, address, city, phone, quote_date, salesperson, status, next_meeting_date, created_at, subtotal, total_before_rot, rot_amount, total_after_rot')
      .single();

    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
