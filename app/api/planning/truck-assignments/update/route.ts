import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, truck_id, start_day, end_day, team_member1_name, team_member2_name } = body || {};
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const patch: any = {};
    if (typeof truck_id !== 'undefined') patch.truck_id = truck_id;
    if (typeof start_day !== 'undefined') patch.start_day = start_day;
    if (typeof end_day !== 'undefined') patch.end_day = end_day;
    if (typeof team_member1_name !== 'undefined') patch.team_member1_name = team_member1_name ?? null;
    if (typeof team_member2_name !== 'undefined') patch.team_member2_name = team_member2_name ?? null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    const { data, error } = await supabase.from('planning_truck_assignments').update(patch).eq('id', id).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ assignment: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
