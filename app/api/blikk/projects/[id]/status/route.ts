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
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const blikk = getBlikk();
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
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } }
) {
  return PUT(req, ctx);
}
