import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

async function forbidIfReadonly() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = (prof as any)?.role as string | null | undefined;
  if (role === 'konsult' || role === 'readonly') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

export async function POST(req: Request) {
  try {
    const forbidden = await forbidIfReadonly();
    if (forbidden) return forbidden;
    const body = await req.json();
    const { truck_id, start_day, end_day, team_member1_name, team_member2_name, team1_id, team2_id, replace } = body || {};
    if (!truck_id || !start_day || !end_day) {
      return NextResponse.json({ error: 'truck_id, start_day and end_day are required' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    // Check for overlapping assignments for this truck within the requested range
    const { data: overlaps, error: overlapErr } = await supabase
      .from('planning_truck_assignments')
      .select('*')
      .eq('truck_id', truck_id)
      .lte('start_day', end_day)
      .gte('end_day', start_day);
    if (overlapErr) return NextResponse.json({ error: overlapErr.message }, { status: 500 });
    if (Array.isArray(overlaps) && overlaps.length > 0 && !replace) {
      return NextResponse.json({ error: 'OVERLAP', overlaps }, { status: 409 });
    }
    // If replace=true, delete overlapping and proceed
    if (Array.isArray(overlaps) && overlaps.length > 0 && replace) {
      const ids = overlaps.map(o => o.id);
      const { error: delErr } = await supabase.from('planning_truck_assignments').delete().in('id', ids);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    const { data, error } = await supabase.from('planning_truck_assignments').insert({
      truck_id,
      start_day,
      end_day,
      team_member1_name: team_member1_name ?? null,
      team_member2_name: team_member2_name ?? null,
      team1_id: team1_id ?? null,
      team2_id: team2_id ?? null,
    }).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ assignment: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
