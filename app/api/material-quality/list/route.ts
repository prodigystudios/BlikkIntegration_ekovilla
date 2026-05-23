import { NextRequest, NextResponse } from 'next/server';
import { getMaterialQualityAdminOrThrow, ok, routeError } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const supa = getMaterialQualityAdminOrThrow();
    const { data, error } = await supa
      .from('material_quality_samples')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return ok({ rows: data }, { rows: data });
  } catch (e: any) {
    return routeError(500, 'material_quality_list_failed', e?.message || 'Failed to list samples');
  }
}
