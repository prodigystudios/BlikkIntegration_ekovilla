import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { getUserProfile } from '@/lib/getUserProfile';
import { adminSupabase } from '@/lib/adminSupabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') || '1');
    const pageSize = Number(searchParams.get('pageSize') || '25');
    let userId = searchParams.get('userId') ? Number(searchParams.get('userId')) : undefined;
    const projectId = searchParams.get('projectId') ? Number(searchParams.get('projectId')) : undefined;
    const dateFrom = searchParams.get('dateFrom') || undefined;
    const dateTo = searchParams.get('dateTo') || undefined;
    const debug = searchParams.get('debug') === '1';
    // If userId not provided, resolve current user's mapped blikk_id
    if (!Number.isFinite(userId as any)) {
      const current = await getUserProfile();
      if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
      if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });
      const { data: prof, error } = await adminSupabase.from('profiles').select('blikk_id').eq('id', current.id).maybeSingle();
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      if (!prof || prof.blikk_id == null) {
        return NextResponse.json({ ok: false, error: 'No Blikk user mapping (blikk_id) found for current user' }, { status: 400 });
      }
      userId = Number(prof.blikk_id);
    }
    const blikk = getBlikk();
    const data = await (blikk as any).listTimeReports({ page, pageSize, userId, projectId, dateFrom, dateTo, debug });
    // If debug mode, data may be our wrapper object containing items + attempts
    const anyData: any = data as any;
    const items = Array.isArray(anyData) ? anyData : (anyData.items || anyData.data || []);
    const payload: any = { ok: true, items };
    if (debug) {
      payload.raw = anyData.raw ?? data;
      payload.attempts = anyData.attempts || [];
      payload.used = anyData.used || null;
      payload.method = anyData.method || 'GET';
      if (anyData.sentBody) payload.sentBody = anyData.sentBody;
      // Server-side echo for terminal visibility when debugging
      try {
        // eslint-disable-next-line no-console
        console.log('[time-reports][debug]', {
          attemptsCount: Array.isArray(payload.attempts) ? payload.attempts.length : 0,
          used: payload.used,
          method: payload.method,
          items: Array.isArray(payload.items) ? payload.items.length : 0,
        });
      } catch {}
    }
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to list time reports' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const debug = new URL(req.url).searchParams.get('debug') === '1';
    let userId = body.userId != null ? Number(body.userId) : NaN;
    const date = String(body.date || '').slice(0, 10);
    const minutes = body.minutes != null ? Number(body.minutes) : undefined;
    const hours = body.hours != null ? Number(body.hours) : undefined;
    const description = typeof body.description === 'string' ? body.description : '';
    const projectId = body.projectId != null ? Number(body.projectId) : undefined;
    const internalProjectId = body.internalProjectId != null ? Number(body.internalProjectId) : undefined;
    const absenceProjectId = body.absenceProjectId != null ? Number(body.absenceProjectId) : undefined;
    const activityId = body.activityId != null ? Number(body.activityId) : undefined;
    const timeCodeId = body.timeCodeId != null ? Number(body.timeCodeId) : (body.timecodeId != null ? Number(body.timecodeId) : undefined);
    const breakMinutes = body.breakMinutes != null ? Number(body.breakMinutes) : undefined;

    // Resolve current user's Blikk ID if userId not provided
    if (!Number.isFinite(userId)) {
      const current = await getUserProfile();
      if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
      if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });
      const { data: prof, error } = await adminSupabase.from('profiles').select('blikk_id').eq('id', current.id).maybeSingle();
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      if (!prof || prof.blikk_id == null) {
        return NextResponse.json({ ok: false, error: 'No Blikk user mapping (blikk_id) found for current user' }, { status: 400 });
      }
      userId = Number(prof.blikk_id);
    }

    if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ ok: false, error: 'userId is required' }, { status: 400 });
    if (!date) return NextResponse.json({ ok: false, error: 'date is required' }, { status: 400 });

    // Require exactly one of projectId / internalProjectId / absenceProjectId
    const idCount = [projectId, internalProjectId, absenceProjectId].filter(v => Number.isFinite(v as any) && (v as number) > 0).length;
    if (idCount !== 1) {
      return NextResponse.json({ ok: false, error: 'Exactly one of projectId, internalProjectId, absenceProjectId must be provided' }, { status: 400 });
    }
    // Optional stricter validation depending on tenant requirements
    const mustHaveTimeCode = process.env.BLIKK_REQUIRE_TIMECODE === '1';
    if (mustHaveTimeCode && !Number.isFinite(timeCodeId as any)) {
      return NextResponse.json({ ok: false, error: 'timeCodeId is required' }, { status: 400 });
    }

    const blikk = getBlikk();
    // Force shared timeArticleId (default 3400, overridable via env)
    const forcedArticleId = process.env.BLIKK_TIME_ARTICLE_ID ? Number(process.env.BLIKK_TIME_ARTICLE_ID) : 3400;
    // Derive start/end timestamps (HH:mm) from body if provided separately; front-end currently passes them in payload
    const startTime = typeof body.start === 'string' ? body.start : (typeof body.startTime === 'string' ? body.startTime : undefined);
    const endTime = typeof body.end === 'string' ? body.end : (typeof body.endTime === 'string' ? body.endTime : undefined);
    const res = await blikk.createTimeReport({
      userId,
      date,
      minutes,
      hours,
      description,
      projectId: projectId,
      internalProjectId: internalProjectId,
      absenceProjectId: absenceProjectId,
      activityId,
      timeCodeId,
      timeArticleId: forcedArticleId,
      breakMinutes,
      startTime: startTime || null,
      endTime: endTime || null,
    });
    // Only include sentBody when debug=1 to avoid leaking payloads in production
    const payload: any = { ok: true, report: res.data, usedPath: res.usedPath };
    if (debug) payload.sentBody = res.sentBody;
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Invalid request body' }, { status: 400 });
  }
}
