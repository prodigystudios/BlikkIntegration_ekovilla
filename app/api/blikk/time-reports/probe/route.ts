import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export async function GET(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') || '1');
    const pageSize = Number(searchParams.get('pageSize') || '50');
    const userId = searchParams.get('userId') ? Number(searchParams.get('userId')) : undefined;
    const projectId = searchParams.get('projectId') ? Number(searchParams.get('projectId')) : undefined;
    const dateFrom = searchParams.get('dateFrom') || undefined;
    const dateTo = searchParams.get('dateTo') || undefined;
    const blikk = getBlikk();
    const data = await (blikk as any).probeListTimeReports({ page, pageSize, userId, projectId, dateFrom, dateTo });
    return NextResponse.json({ ok: true, ...data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'probe failed' }, { status: 500 });
  }
}