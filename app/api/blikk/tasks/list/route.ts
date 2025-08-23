export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

// Debug endpoint to list tasks from Blikk with flexible filters
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || searchParams.get('query') || undefined;
    const assignedUserId = searchParams.get('assignedUserId') || searchParams.get('assigneeId') || undefined;
    const page = searchParams.get('page') || undefined;
    const pageSize = searchParams.get('pageSize') || undefined;
    const createdFrom = searchParams.get('createdFrom') || undefined;
    const preferBasePath = searchParams.get('preferBasePath') === 'true' ? true : false;
    const basePath = searchParams.get('basePath') || undefined;

    const blikk = getBlikk();
    const result = await blikk.listTasksWithMeta({
      basePath: basePath,
      query: query,
      assignedUserId: assignedUserId ? Number(assignedUserId) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      createdFrom,
      sortDesc: true,
      preferBasePath,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('List tasks failed', e);
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
