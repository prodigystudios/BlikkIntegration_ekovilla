import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') || '1');
    const pageSize = Number(searchParams.get('pageSize') || '25');
    const userId = searchParams.get('userId') ? Number(searchParams.get('userId')) : undefined;
    const projectId = searchParams.get('projectId') ? Number(searchParams.get('projectId')) : undefined;
    const dateFrom = searchParams.get('dateFrom') || undefined;
    const dateTo = searchParams.get('dateTo') || undefined;
    const blikk = getBlikk();
    const data = await (blikk as any).listTimeReports({ page, pageSize, userId, projectId, dateFrom, dateTo });
    const items = Array.isArray(data) ? data : (data.items || data.data || []);
    return NextResponse.json({ ok: true, items, raw: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to list time reports' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = Number(body.userId);
    const date = String(body.date || '').slice(0, 10);
    const minutes = body.minutes != null ? Number(body.minutes) : undefined;
    const hours = body.hours != null ? Number(body.hours) : undefined;
    const description = typeof body.description === 'string' ? body.description : '';
    const projectId = body.projectId != null ? Number(body.projectId) : undefined;
    const activityId = body.activityId != null ? Number(body.activityId) : undefined;
    const timeCodeId = body.timeCodeId != null ? Number(body.timeCodeId) : undefined;
    const timeArticleId = body.timeArticleId != null ? Number(body.timeArticleId) : undefined;

    if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 });
    // Optional stricter validation depending on tenant requirements
    const mustHaveTimeCode = process.env.BLIKK_REQUIRE_TIMECODE === '1';
    const mustHaveTimeArticle = process.env.BLIKK_REQUIRE_TIMEARTICLE === '1';
    if (mustHaveTimeCode && !Number.isFinite(timeCodeId as any)) {
      return NextResponse.json({ error: 'timeCodeId is required' }, { status: 400 });
    }
    if (mustHaveTimeArticle && !Number.isFinite(timeArticleId as any)) {
      return NextResponse.json({ error: 'timeArticleId is required' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Invalid request body' }, { status: 400 });
  }
}
