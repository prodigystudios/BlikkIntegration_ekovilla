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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const idNum = Number(params.id);
    if (!Number.isFinite(idNum)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const debug = new URL(req.url).searchParams.get('debug') === '1';

    // Resolve current user's Blikk id and verify ownership
    const { getUserProfile } = await import('@/lib/getUserProfile');
    const { adminSupabase } = await import('@/lib/adminSupabase');
    const current = await getUserProfile();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });
    const { data: prof, error } = await adminSupabase.from('profiles').select('blikk_id').eq('id', current.id).maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!prof || prof.blikk_id == null) return NextResponse.json({ ok: false, error: 'No Blikk user mapping (blikk_id) found for current user' }, { status: 400 });
    const blikkUserId = Number(prof.blikk_id);

    const blikk = getBlikk();
    // Fetch existing report to verify ownership
    const fetched = await (blikk as any).getTimeReportById(idNum, { debug: false }).catch(() => null);
    const existing: any = fetched?.report ?? fetched ?? null;
    const owner = existing?.userId ?? existing?.user_id ?? existing?.user?.id ?? null;
    if (owner != null && Number(owner) !== blikkUserId) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    // Derive robust defaults from existing report if client/env omitted some required fields
    const existingTimeArticleId = (
      existing?.timeArticleId ?? existing?.time_article_id ?? existing?.timeArticle?.id ?? existing?.time_article?.id ?? existing?.articleId ?? null
    );
    const finalTimeArticleId = (
      body.timeArticleId != null ? Number(body.timeArticleId)
      : (process.env.BLIKK_TIME_ARTICLE_ID ? Number(process.env.BLIKK_TIME_ARTICLE_ID) : (existingTimeArticleId != null ? Number(existingTimeArticleId) : undefined))
    );

    // Preserve target context if none provided in the PATCH payload
    const finalProjectId = body.projectId != null ? Number(body.projectId) : (existing?.projectId ?? existing?.project_id ?? existing?.project?.id ?? undefined);
    const finalInternalProjectId = body.internalProjectId != null ? Number(body.internalProjectId) : (existing?.internalProjectId ?? existing?.internal_project_id ?? existing?.internalProject?.id ?? undefined);
    const finalAbsenceProjectId = body.absenceProjectId != null ? Number(body.absenceProjectId) : (existing?.absenceProjectId ?? existing?.absence_project_id ?? existing?.absenceProject?.id ?? undefined);

    // Derive minutes/hours from request or existing report
    const existingMinutesRaw = existing?.minutes ?? existing?.durationMinutes ?? null;
    const existingHoursRaw = existing?.hours ?? (existingMinutesRaw != null ? Number(existingMinutesRaw)/60 : null);
    const finalMinutes = body.minutes != null ? Number(body.minutes) : (
      body.hours != null ? Math.round(Number(body.hours) * 60) : (
        existingMinutesRaw != null ? Number(existingMinutesRaw) : (existingHoursRaw != null ? Math.round(Number(existingHoursRaw) * 60) : undefined)
      )
    );
    const finalHours = body.hours != null ? Number(body.hours) : (finalMinutes != null ? Number(finalMinutes)/60 : (existingHoursRaw != null ? Number(existingHoursRaw) : undefined));

    // Derive time-of-day from request or existing report to satisfy tenants requiring explicit times
    const existingStart = existing?.clockStart || existing?.start || existing?.startTime || existing?.timeFrom || null;
    const existingEnd = existing?.clockEnd || existing?.end || existing?.endTime || existing?.timeTo || null;
    const finalStart = typeof body.start === 'string' ? body.start : (typeof body.startTime === 'string' ? body.startTime : existingStart);
    const finalEnd = typeof body.end === 'string' ? body.end : (typeof body.endTime === 'string' ? body.endTime : existingEnd);

    const updatePayload = {
      date: typeof body.date === 'string' ? body.date : (existing?.date || existing?.reportDate || existing?.day || undefined),
      minutes: finalMinutes,
      hours: finalHours,
      description: typeof body.description === 'string' ? body.description : (existing?.description || existing?.comment || existing?.internalComment || undefined),
      startTime: finalStart ? String(finalStart).slice(0,5) : undefined,
      endTime: finalEnd ? String(finalEnd).slice(0,5) : undefined,
      activityId: body.activityId != null ? Number(body.activityId) : (existing?.activityId ?? existing?.activity_id ?? existing?.activity?.id ?? undefined),
      timeCodeId: body.timeCodeId != null ? Number(body.timeCodeId) : (body.timecodeId != null ? Number(body.timecodeId) : (existing?.timeCodeId ?? existing?.time_code_id ?? existing?.timeCode?.id ?? undefined)),
      projectId: finalProjectId != null ? Number(finalProjectId) : undefined,
      internalProjectId: finalInternalProjectId != null ? Number(finalInternalProjectId) : undefined,
      absenceProjectId: finalAbsenceProjectId != null ? Number(finalAbsenceProjectId) : undefined,
      breakMinutes: body.breakMinutes != null ? Number(body.breakMinutes) : (existing?.breakMinutes ?? existing?.break ?? undefined),
      timeArticleId: finalTimeArticleId,
      userId: blikkUserId,
    } as const;

    // Ensure mutual exclusivity of target context
    const ctxCount = [updatePayload.projectId, updatePayload.internalProjectId, updatePayload.absenceProjectId]
      .filter(v => v != null && Number(v) > 0).length;
    if (ctxCount !== 1) {
      return NextResponse.json({ ok: false, error: 'Exactly one of projectId, internalProjectId, absenceProjectId must be set' }, { status: 400 });
    }

    // If after deriving we still don't have a valid timeArticleId, fail early with a clearer error
    if (!(updatePayload.timeArticleId != null && Number(updatePayload.timeArticleId) > 0)) {
      return NextResponse.json({ ok: false, error: 'Missing timeArticleId: set BLIKK_TIME_ARTICLE_ID or include timeArticleId in payload' }, { status: 400 });
    }

  const res = await (blikk as any).updateTimeReport(idNum, updatePayload as any);

    const payload: any = { ok: true, updated: res.data, usedPath: res.usedPath };
    if (debug) {
      payload.sentBody = res.sentBody;
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[PATCH time-report] usedPath:', res.usedPath);
      }
    }
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update time report' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const idNum = Number(params.id);
    if (!Number.isFinite(idNum)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
    const debug = new URL(req.url).searchParams.get('debug') === '1';

    // Resolve current user's Blikk id and verify ownership
    const { getUserProfile } = await import('@/lib/getUserProfile');
    const { adminSupabase } = await import('@/lib/adminSupabase');
    const current = await getUserProfile();
    if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });
    const { data: prof, error } = await adminSupabase.from('profiles').select('blikk_id').eq('id', current.id).maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!prof || prof.blikk_id == null) return NextResponse.json({ ok: false, error: 'No Blikk user mapping (blikk_id) found for current user' }, { status: 400 });
    const blikkUserId = Number(prof.blikk_id);

    const blikk = getBlikk();
    // Fetch existing report to verify ownership
    const fetched = await (blikk as any).getTimeReportById(idNum, { debug: false }).catch(() => null);
    const existing: any = fetched?.report ?? fetched ?? null;
    const owner = existing?.userId ?? existing?.user_id ?? existing?.user?.id ?? null;
    if (owner != null && Number(owner) !== blikkUserId) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const res = await (blikk as any).deleteTimeReport(idNum);
    if (debug && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('[DELETE time-report] usedPath:', res.usedPath);
    }
    // Consider 404 on canonical path as idempotent success; the client should not error.
    return NextResponse.json({ ok: true, deleted: res.data, usedPath: res.usedPath });
  } catch (e: any) {
    // If the external API already deleted the record (404), treat as success.
    const msg = String(e?.message || '')
    if (/DELETE \/v1\/Core\/TimeReports\//.test(msg) && /-> 404/.test(msg)) {
      return NextResponse.json({ ok: true, deleted: null, usedPath: '/v1/Core/TimeReports' });
    }
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to delete time report' }, { status: 400 });
  }
}