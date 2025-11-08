import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const idNum = Number(params.id);
    if (!Number.isFinite(idNum)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
    const debug = new URL(req.url).searchParams.get('debug') === '1';
    const blikk = getBlikk();
    const data = await (blikk as any).getTimeReportById(idNum, { debug });
    const report = (data as any)?.report ?? data;
    const payload: any = { ok: true, report };
    if (debug) {
      payload.used = (data as any).used;
      payload.attempts = (data as any).attempts;
    }
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to get time report' }, { status: 500 });
  }
}