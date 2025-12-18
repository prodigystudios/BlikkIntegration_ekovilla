import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBlikk } from '@/lib/blikk';

const BodySchema = z.object({ status: z.string().min(1).optional(), statusId: z.number().optional() }).refine(v => v.status || typeof v.statusId === 'number', { message: 'Provide status or statusId' });

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const idNum = Number(params.id);
    if (!Number.isFinite(idNum)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const debugFetchOnly = url.searchParams.get('debug') === 'true' || process.env.BLIKK_UPDATES_DISABLED === 'true';
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const blikk = getBlikk();
    // In debug/fetch-only mode: fetch and return the full current project, skip updates entirely
    if (debugFetchOnly) {
      const current: any = await blikk.getProjectById(idNum);
      // Log a trimmed server-side snapshot for verification without flooding logs
      console.log('[Blikk DEBUG] Fetched project', {
        id: current?.id,
        name: current?.name,
        statusId: current?.statusId ?? current?.status?.id,
        startDate: current?.startDate,
        endDate: current?.endDate,
        hasWorkSiteAddress: Boolean(current?.workSiteAddress),
        tagsCount: Array.isArray(current?.tags) ? current?.tags.length : 0,
      });
      return NextResponse.json({ ok: true, mode: 'debug-fetch-only', project: current });
    }
    // Inspect-only: return the canonical body we would send
    if (url.searchParams.get('inspect') === 'true') {
      const body = await blikk.buildCanonicalBodyForId(idNum);
      return NextResponse.json({ ok: true, mode: 'inspect', putBody: body });
    }
    // If statusId provided, prefer id-based update
    if (typeof parsed.data.statusId === 'number') {
      const res = await blikk.updateProjectStatusById(idNum, parsed.data.statusId);
      return NextResponse.json({ ok: true, result: res });
    }
    // Try env mapping first if only a label is provided
    const label = String(parsed.data.status || '').trim();
    let envMapId: number | null = null;
    try {
      const raw = process.env.BLIKK_STATUS_MAP || '';
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, number>;
        const direct = obj[label];
        if (typeof direct === 'number') envMapId = direct;
        if (envMapId == null) {
          // case-insensitive match
          const lower = label.toLowerCase();
          for (const [k, v] of Object.entries(obj)) {
            if (k.toLowerCase() === lower && typeof v === 'number') { envMapId = v; break; }
          }
        }
      }
    } catch {}
    if (envMapId != null) {
      const res = await blikk.updateProjectStatusById(idNum, envMapId);
      return NextResponse.json({ ok: true, result: res, via: 'envMap' });
    }
    // Fallback: attempt tolerant string-form update
    const res = await blikk.updateProjectStatus(idNum, label);
    return NextResponse.json({ ok: true, result: res });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const is404 = /\b404\b/.test(msg);
    return NextResponse.json({ error: msg }, { status: is404 ? 404 : 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } }
) {
  return PUT(req, ctx);
}

// GET: debug-only fetch of project via status route
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const idNum = Number(params.id);
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const url = new URL(req.url);
  const debugFetchOnly = url.searchParams.get('debug') === 'true' || process.env.BLIKK_UPDATES_DISABLED === 'true';
  try {
    const blikk = getBlikk();
    if (url.searchParams.get('inspect') === 'true') {
      const putBody = await (blikk as any).buildCanonicalBodyForId(idNum);
      return NextResponse.json({ ok: true, mode: 'inspect', putBody });
    }
    if (debugFetchOnly) {
      const current: any = await blikk.getProjectById(idNum);
      console.log('[Blikk DEBUG][GET] Fetched project', {
        id: current?.id,
        name: current?.name,
        statusId: current?.statusId ?? current?.status?.id,
        startDate: current?.startDate,
        endDate: current?.endDate,
        hasWorkSiteAddress: Boolean(current?.workSiteAddress),
        tagsCount: Array.isArray(current?.tags) ? current?.tags.length : 0,
      });
      return NextResponse.json({ ok: true, mode: 'debug-fetch-only', project: current });
    }
    return NextResponse.json({ error: 'Use PUT for updates. For fetch-only, pass ?debug=true. To inspect PUT body, pass ?inspect=true.' }, { status: 405 });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const is404 = /\b404\b/.test(msg);
    return NextResponse.json({ error: msg }, { status: is404 ? 404 : 500 });
  }
}
