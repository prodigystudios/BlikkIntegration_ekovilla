import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { computeOffertKalkylator, OFFERT_KALKYLATOR_DEFAULT_STATE } from '@/lib/offertKalkylator';
import { adminSupabase } from '@/lib/adminSupabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('offert_calculations')
      .select('id, offert_number_year, offert_number_seq, name, address, city, phone, quote_date, salesperson, salesperson_phone, status, next_meeting_date, internal_note, created_at, updated_at, subtotal, total_before_rot, rot_amount, total_after_rot')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const items = (data ?? []) as any[];

    // Optional: attach customer-response status per offer.
    if (adminSupabase && items.length > 0) {
      const ids = items.map((x) => String(x.id)).filter(Boolean);
      const { data: reqRows, error: reqErr } = await adminSupabase
        .from('offert_customer_requests')
        .select('offert_id, submitted_at')
        .eq('seller_user_id', user.id)
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

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const address = typeof body?.address === 'string' ? body.address.trim() : '';
    const city = typeof body?.city === 'string' ? body.city.trim() : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const quoteDate = typeof body?.quoteDate === 'string' ? body.quoteDate.trim() : '';
    const salesperson = typeof body?.salesperson === 'string' ? body.salesperson.trim() : '';
    const salespersonPhone = typeof body?.salespersonPhone === 'string' ? body.salespersonPhone.trim() : '';
    const nextMeetingDate = typeof body?.nextMeetingDate === 'string' ? body.nextMeetingDate.trim() : '';
    const status = typeof body?.status === 'string' ? body.status.trim() : '';
    const internalNote = typeof body?.internalNote === 'string' ? body.internalNote.trim() : '';
    const payload = body?.payload ?? null;

    if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    if (!address) return NextResponse.json({ error: 'Missing address' }, { status: 400 });
    if (!city) return NextResponse.json({ error: 'Missing city' }, { status: 400 });
    if (!quoteDate) return NextResponse.json({ error: 'Missing quoteDate' }, { status: 400 });
    if (!salesperson) return NextResponse.json({ error: 'Missing salesperson' }, { status: 400 });
    if (!payload) return NextResponse.json({ error: 'Missing payload' }, { status: 400 });

    const computed = computeOffertKalkylator({
      ...OFFERT_KALKYLATOR_DEFAULT_STATE,
      ...(typeof payload === 'object' ? payload : {}),
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

    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
