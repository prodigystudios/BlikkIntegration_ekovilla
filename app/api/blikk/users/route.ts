import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { parseAdminResourceQuery, routeError } from '../_admin-resource';

export async function GET(req: NextRequest) {
  const parsedQuery = parseAdminResourceQuery(req);
  if (!parsedQuery.success) {
    return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
  }

  try {
    const blikk = getBlikk();
    const users = await blikk.listUsers({
      query: parsedQuery.data.q || undefined,
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
    });
    return NextResponse.json(users);
  } catch (e: any) {
    return routeError(500, 'users_fetch_failed', e?.message || 'Failed to list users');
  }
}
