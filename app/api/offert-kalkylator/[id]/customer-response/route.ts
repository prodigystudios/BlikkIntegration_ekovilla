import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminSupabase } from '@/lib/adminSupabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    if (!adminSupabase) return NextResponse.json({ error: 'Admin supabase not configured' }, { status: 500 });

    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const offertId = (ctx?.params?.id || '').trim();
    if (!offertId) return NextResponse.json({ error: 'Missing offert id' }, { status: 400 });

    const { data: offer, error: offerErr } = await adminSupabase
      .from('offert_calculations')
      .select('id')
      .eq('id', offertId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (offerErr) throw offerErr;
    if (!offer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: latestReq, error: reqErr } = await adminSupabase
      .from('offert_customer_requests')
      .select('id, submitted_at, created_at')
      .eq('offert_id', offertId)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reqErr) throw reqErr;
    if (!latestReq) return NextResponse.json({ response: null });

    const { data: response, error: respErr } = await adminSupabase
      .from('offert_customer_responses')
      .select('*')
      .eq('request_id', latestReq.id)
      .maybeSingle();

    if (respErr) throw respErr;

    return NextResponse.json({
      response: response || null,
      submittedAt: latestReq.submitted_at,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
