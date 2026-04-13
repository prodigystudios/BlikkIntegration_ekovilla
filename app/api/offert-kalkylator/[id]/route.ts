import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { computeOffertKalkylator, OFFERT_KALKYLATOR_DEFAULT_STATE } from '@/lib/offertKalkylator';

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

    const update: any = {};
    if ('name' in (body || {})) update.name = typeof body?.name === 'string' ? body.name.trim() : '';
    if ('address' in (body || {})) update.address = typeof body?.address === 'string' ? body.address.trim() : '';
    if ('city' in (body || {})) update.city = typeof body?.city === 'string' ? body.city.trim() : '';
    if ('phone' in (body || {})) update.phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    if ('quoteDate' in (body || {})) update.quote_date = typeof body?.quoteDate === 'string' ? body.quoteDate.trim() : '';
    if ('salesperson' in (body || {})) update.salesperson = typeof body?.salesperson === 'string' ? body.salesperson.trim() : '';
    if ('salespersonPhone' in (body || {})) update.salesperson_phone = typeof body?.salespersonPhone === 'string' ? body.salespersonPhone.trim() : '';
    if ('status' in (body || {})) update.status = typeof body?.status === 'string' ? body.status.trim() : '';
    if ('internalNote' in (body || {})) update.internal_note = typeof body?.internalNote === 'string' ? body.internalNote.trim() : '';
    if ('nextMeetingDate' in (body || {})) {
      const nextMeetingDate = typeof body?.nextMeetingDate === 'string' ? body.nextMeetingDate.trim() : '';
      update.next_meeting_date = nextMeetingDate || null;
    }

    if ('payload' in (body || {})) {
      const payload = body?.payload;
      if (!payload || typeof payload !== 'object') {
        return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
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

    if ('name' in update && !update.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    if ('address' in update && !update.address) return NextResponse.json({ error: 'Missing address' }, { status: 400 });
    if ('city' in update && !update.city) return NextResponse.json({ error: 'Missing city' }, { status: 400 });
    if ('quote_date' in update && !update.quote_date) return NextResponse.json({ error: 'Missing quoteDate' }, { status: 400 });
    if ('salesperson' in update && !update.salesperson) return NextResponse.json({ error: 'Missing salesperson' }, { status: 400 });
    if ('status' in update && !update.status) delete update.status;

    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    const { data, error } = await supabase
      .from('offert_calculations')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, offert_number_year, offert_number_seq, name, address, city, phone, quote_date, salesperson, salesperson_phone, status, next_meeting_date, internal_note, created_at, updated_at, subtotal, total_before_rot, rot_amount, total_after_rot')
      .single();

    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
