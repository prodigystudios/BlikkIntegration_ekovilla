import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id } = body || {};
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('planning_truck_assignments').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
