import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBlikk } from '@/lib/blikk';
import { getUserProfile } from '@/lib/getUserProfile';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().default(25),
  userId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  debug: z.enum(['1']).optional(),
});

const createTimeReportSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  date: z.string().trim().min(1, 'date is required'),
  minutes: z.coerce.number().finite().optional(),
  hours: z.coerce.number().finite().optional(),
  description: z.string().optional().default(''),
  projectId: z.coerce.number().int().positive().optional(),
  internalProjectId: z.coerce.number().int().positive().optional(),
  absenceProjectId: z.coerce.number().int().positive().optional(),
  activityId: z.coerce.number().int().positive().optional(),
  timeCodeId: z.coerce.number().int().positive().optional(),
  timecodeId: z.coerce.number().int().positive().optional(),
  breakMinutes: z.coerce.number().finite().optional(),
  start: z.string().optional(),
  startTime: z.string().optional(),
  end: z.string().optional(),
  endTime: z.string().optional(),
  travelReport: z.any().optional().nullable(),
});

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
      ...(details !== undefined ? { details } : {}),
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function isDebugRequest(req: NextRequest) {
  return new URL(req.url).searchParams.get('debug') === '1';
}

async function resolveCurrentBlikkUserId() {
  const current = await getUserProfile();
  if (!current) {
    return { blikkUserId: null, response: routeError(401, 'unauthorized', 'unauthorized') };
  }

  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    return { blikkUserId: null, response: routeError(500, 'service_role_missing', 'service role not configured') };
  }

  const { data: prof, error } = await supabase.from('profiles').select('blikk_id').eq('id', current.id).maybeSingle();
  if (error) {
    return { blikkUserId: null, response: routeError(500, 'profile_lookup_failed', error.message) };
  }

  if (!prof || prof.blikk_id == null) {
    return {
      blikkUserId: null,
      response: routeError(400, 'blikk_mapping_missing', 'No Blikk user mapping (blikk_id) found for current user'),
    };
  }

  return { blikkUserId: Number(prof.blikk_id), response: null };
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const parsedQuery = listQuerySchema.safeParse({
      page: searchParams.get('page') || '1',
      pageSize: searchParams.get('pageSize') || '25',
      userId: searchParams.get('userId') || undefined,
      projectId: searchParams.get('projectId') || undefined,
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      debug: searchParams.get('debug') || undefined,
    });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
    }

    const { page, pageSize, projectId, dateFrom, dateTo } = parsedQuery.data;
    let userId = parsedQuery.data.userId;
    const debug = parsedQuery.data.debug === '1';
    // If userId not provided, resolve current user's mapped blikk_id
    if (!Number.isFinite(userId as any)) {
      const resolvedUser = await resolveCurrentBlikkUserId();
      if (resolvedUser.response) return resolvedUser.response;
      userId = resolvedUser.blikkUserId;
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
    return ok(
      {
        items,
        ...(debug
          ? {
              raw: payload.raw,
              attempts: payload.attempts,
              used: payload.used,
              method: payload.method,
              ...(payload.sentBody ? { sentBody: payload.sentBody } : {}),
            }
          : {}),
      },
      payload,
    );
  } catch (e: any) {
    return routeError(500, 'time_report_list_failed', e?.message || 'Failed to list time reports');
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsedBody = createTimeReportSchema.safeParse(await req.json());
    if (!parsedBody.success) {
      return routeError(400, 'validation_error', 'Invalid request body', parsedBody.error.flatten());
    }

    const debug = isDebugRequest(req);
    let userId = parsedBody.data.userId ?? NaN;
    const date = parsedBody.data.date.slice(0, 10);
    const minutes = parsedBody.data.minutes;
    const hours = parsedBody.data.hours;
    const description = parsedBody.data.description;
    const projectId = parsedBody.data.projectId;
    const internalProjectId = parsedBody.data.internalProjectId;
    const absenceProjectId = parsedBody.data.absenceProjectId;
    const activityId = parsedBody.data.activityId;
    const timeCodeId = parsedBody.data.timeCodeId ?? parsedBody.data.timecodeId;
    const breakMinutes = parsedBody.data.breakMinutes;
    const travelReport = parsedBody.data.travelReport || null;

    // Resolve current user's Blikk ID if userId not provided
    if (!Number.isFinite(userId)) {
      const resolvedUser = await resolveCurrentBlikkUserId();
      if (resolvedUser.response) return resolvedUser.response;
      userId = resolvedUser.blikkUserId;
    }

    if (!Number.isFinite(userId) || userId <= 0) return routeError(400, 'validation_error', 'userId is required');
    if (!date) return routeError(400, 'validation_error', 'date is required');

    // Require exactly one of projectId / internalProjectId / absenceProjectId
    const idCount = [projectId, internalProjectId, absenceProjectId].filter(v => Number.isFinite(v as any) && (v as number) > 0).length;
    if (idCount !== 1) {
      return routeError(400, 'validation_error', 'Exactly one of projectId, internalProjectId, absenceProjectId must be provided');
    }
    // Optional stricter validation depending on tenant requirements
    const mustHaveTimeCode = process.env.BLIKK_REQUIRE_TIMECODE === '1';
    if (mustHaveTimeCode && !Number.isFinite(timeCodeId as any)) {
      return routeError(400, 'validation_error', 'timeCodeId is required');
    }

    const blikk = getBlikk();
    // Force shared timeArticleId (default 3400, overridable via env)
    const forcedArticleId = process.env.BLIKK_TIME_ARTICLE_ID ? Number(process.env.BLIKK_TIME_ARTICLE_ID) : 3400;
    // Derive start/end timestamps (HH:mm) from body if provided separately; front-end currently passes them in payload
    const startTime = typeof parsedBody.data.start === 'string'
      ? parsedBody.data.start
      : (typeof parsedBody.data.startTime === 'string' ? parsedBody.data.startTime : undefined);
    const endTime = typeof parsedBody.data.end === 'string'
      ? parsedBody.data.end
      : (typeof parsedBody.data.endTime === 'string' ? parsedBody.data.endTime : undefined);
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
      travelReport: travelReport || undefined,
    });
    // Only include sentBody when debug=1 to avoid leaking payloads in production
    const payload: any = { ok: true, report: res.data, usedPath: res.usedPath };
    if (debug) payload.sentBody = res.sentBody;
    return ok(
      { report: res.data, usedPath: res.usedPath, ...(debug ? { sentBody: res.sentBody } : {}) },
      payload,
    );
  } catch (e: any) {
    return routeError(400, 'time_report_create_failed', e?.message || 'Invalid request body');
  }
}
