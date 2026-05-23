import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { extractProjectDetails, projectIdParamsSchema, routeError, updateProjectBodySchema } from '../_lib';

// Fetch detailed project (single) to recover missing customerId or other fields.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const parsedParams = projectIdParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return routeError(400, 'validation_error', 'Invalid id', parsedParams.error.flatten());
  }
  const idNum = parsedParams.data.id;
  const debug = req.nextUrl.searchParams.get('debug') === '1';
  try {
    const blikk = getBlikk();
    const data: any = await blikk.getProjectById(idNum);
    const response = extractProjectDetails(data, idNum, debug);
    return NextResponse.json(response);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = / 404: /.test(msg) ? 404 : 500;
    return routeError(status, status === 404 ? 'project_not_found' : 'project_fetch_failed', msg);
  }
}

// Update project description in Blikk
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = projectIdParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return routeError(400, 'validation_error', 'Invalid id', parsedParams.error.flatten());
    }
    const idNum = parsedParams.data.id;
    const parsedBody = updateProjectBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return routeError(400, 'validation_error', 'description required', parsedBody.error.flatten());
    }
    const debugFetchOnly = req.nextUrl.searchParams.get('debug') === 'true' || process.env.BLIKK_UPDATES_DISABLED === 'true';
    const description = parsedBody.data.description;
    const blikk = getBlikk();
    if (debugFetchOnly) {
      const current = await (blikk as any).getProjectById(idNum);
      console.log('[Blikk DEBUG] Fetched project (desc route)', {
        id: current?.id,
        name: current?.name || current?.title,
        startDate: (current as any)?.startDate,
        endDate: (current as any)?.endDate,
        statusId: (current as any)?.statusId ?? (current as any)?.status?.id,
      });
      return NextResponse.json({ ok: true, mode: 'debug-fetch-only', project: current });
    }
    const result = await (blikk as any).updateProjectDescription(idNum, description);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[api/blikk/projects/:id PUT] error', e);
    return routeError(500, 'project_update_failed', String(e?.message || e));
  }
}
