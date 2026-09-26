import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/guards';
import { getMaterialQualityAdminOrThrow, ok, routeError } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    // Läsningen går med service-role, förbi RLS — grinden här är den enda. app.access = alla anställda,
    // samma som sidan /material-kvalitet som anropar den.
    const access = await requirePermission('app.access');
    if (access.response) return access.response;
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
