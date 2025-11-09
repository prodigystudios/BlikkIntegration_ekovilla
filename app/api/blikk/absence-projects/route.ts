import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

// GET /api/blikk/absence-projects
// Simple proxy to list Absence Projects from Blikk so you can inspect the raw payload.
// Uses single canonical path, with env override:
//   BLIKK_ABSENCE_PROJECTS_PATH (default: /v1/Admin/AbsenceProjects)
// Query params:
//   page (default 1)
//   limit (default 50)
//   query (optional search text)
//   mock=1 (optional test data)

export async function GET(req: NextRequest) {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || '1') || 1);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || '50') || 50));
  const q = req.nextUrl.searchParams.get('q') || req.nextUrl.searchParams.get('query') || '';
  const mock = req.nextUrl.searchParams.get('mock') === '1';

  if (mock) {
    const items = Array.from({ length: Math.min(limit, 5) }).map((_, i) => ({
      id: `mock-abs-${(page - 1) * limit + i + 1}`,
      name: `Absence Project ${(page - 1) * limit + i + 1}`,
      code: `ABS${100 + i}`,
      active: true,
    }));
    return NextResponse.json({ usedUrl: 'mock', data: { items, page, limit, query: q || undefined } });
  }

  try {
    const blikk = getBlikk();
    const base = process.env.BLIKK_ABSENCE_PROJECTS_PATH || '/v1/Admin/AbsenceProjects';
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) qs.set('query', q);
    const usedUrl = `${base}?${qs.toString()}`;
    const raw: any = await (blikk as any).request(usedUrl.replace(/^https?:\/\/[^/]+/, ''));
    // Return raw upstream shape so you can inspect exactly what Blikk responds with.
    return NextResponse.json({ usedUrl, data: raw });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
