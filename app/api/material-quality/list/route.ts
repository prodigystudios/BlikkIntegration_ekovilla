import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();
    const { data, error } = await supa
      .from('material_quality_samples')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return NextResponse.json({ rows: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to list samples' }, { status: 500 });
  }
}
