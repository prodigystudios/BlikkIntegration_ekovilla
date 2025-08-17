import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBlikk } from '@/lib/blikk';

const QuerySchema = z.object({
  id: z.string().optional(),
  orderId: z.string().optional(), // order number
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.parse({
      id: searchParams.get('id') || undefined,
      orderId: searchParams.get('orderId') || undefined,
    });

    const blikk = getBlikk();

    if (parsed.id) {
      const idNum = Number(parsed.id);
      if (!Number.isFinite(idNum)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      const data = await blikk.getProjectById(idNum);
      return NextResponse.json(data);
    }

    if (parsed.orderId) {
      const proj = await blikk.getProjectByOrderNumber(parsed.orderId);
      if (!proj) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      // If list item, it’s a summary; fetch full details
      const id = proj.id ?? null;
      if (!id) return NextResponse.json(proj);
      const full = await blikk.getProjectById(id);
      return NextResponse.json(full);
    }

    return NextResponse.json({ error: 'Provide id or orderId' }, { status: 400 });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
