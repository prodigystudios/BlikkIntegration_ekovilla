import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query') || searchParams.get('q') || '';
    const includeRaw = searchParams.get('raw') === '1' || searchParams.get('includeraw') === '1';
    const page = Number(searchParams.get('page') || '1') || 1;
    const pageSize = Number(searchParams.get('pageSize') || '50') || 50;

    const blikk = getBlikk();
    const meta = await blikk.listProjectStatusesWithMeta({ page, pageSize, query });
    const raw = meta.data;
    const items: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = items.map((s: any) => ({
      id: Number(s.id ?? s.statusId ?? s.Id ?? s.StatusId ?? 0) || 0,
      name: s.name || s.title || s.statusName || s.StatusName || 'Unknown',
      code: s.code || s.key || s.Code || null,
      color: s.color || s.Color || null,
      isActive: typeof s.isActive === 'boolean' ? s.isActive : (typeof s.active === 'boolean' ? s.active : null),
      order: typeof s.order === 'number' ? s.order : (typeof s.sortOrder === 'number' ? s.sortOrder : null),
      ...(includeRaw ? { _raw: s } : {}),
    }));
    return NextResponse.json({ statuses: mapped, usedUrl: meta.usedUrl, attempts: meta.attempts });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
