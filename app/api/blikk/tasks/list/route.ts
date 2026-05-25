export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { listTasksQuerySchema, routeError } from '../_lib';

// Debug endpoint to list tasks from Blikk with flexible filters
export async function GET(req: NextRequest) {
  try {
    const parsedQuery = listTasksQuerySchema.safeParse({
      q: req.nextUrl.searchParams.get('q') || undefined,
      query: req.nextUrl.searchParams.get('query') || undefined,
      assignedUserId: req.nextUrl.searchParams.get('assignedUserId') || undefined,
      assigneeId: req.nextUrl.searchParams.get('assigneeId') || undefined,
      page: req.nextUrl.searchParams.get('page') || undefined,
      pageSize: req.nextUrl.searchParams.get('pageSize') || undefined,
      createdFrom: req.nextUrl.searchParams.get('createdFrom') || undefined,
      preferBasePath: req.nextUrl.searchParams.get('preferBasePath') || undefined,
      basePath: req.nextUrl.searchParams.get('basePath') || undefined,
    });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
    }

    const query = parsedQuery.data.q || parsedQuery.data.query || undefined;
    const assignedUserId = parsedQuery.data.assignedUserId ?? parsedQuery.data.assigneeId;
    const page = parsedQuery.data.page;
    const pageSize = parsedQuery.data.pageSize;
    const createdFrom = parsedQuery.data.createdFrom;
    const preferBasePath = parsedQuery.data.preferBasePath === 'true';
    const basePath = parsedQuery.data.basePath;

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
    return routeError(500, 'tasks_list_failed', e?.message || 'Unknown error');
  }
}
