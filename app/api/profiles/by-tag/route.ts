import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

const byTagQuerySchema = z.object({
  tag: z.string().trim().min(1, 'Tag is required'),
});

function ok<T>(data: T, legacy?: Record<string, unknown>) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

export async function GET(req: NextRequest) {
  if (!(await requireAdminUser())) {
    return routeError(403, 'forbidden', 'Forbidden');
  }

  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    return routeError(500, 'service_role_missing', 'Service role not configured');
  }

  const { searchParams } = new URL(req.url);
  const parsedQuery = byTagQuerySchema.safeParse({
    tag: searchParams.get('tag') ?? '',
  });
  if (!parsedQuery.success) {
    return routeError(400, 'validation_error', 'Invalid request', parsedQuery.error.flatten());
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, tags')
    .contains('tags', [parsedQuery.data.tag])
    .order('full_name', { ascending: true });

  if (error) {
    return routeError(500, 'query_failed', error.message);
  }

  const items = data ?? [];
  return ok({ items }, { items });
}
