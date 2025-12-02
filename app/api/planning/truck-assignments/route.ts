import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

// GET /api/planning/truck-assignments?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

  const supabase = getSupabaseAdmin();

    let query = supabase.from('planning_truck_assignments').select('*');
    if (from) query = query.gte('end_day', from); // any assignment that still overlaps window
    if (to) query = query.lte('start_day', to);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ assignments: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
