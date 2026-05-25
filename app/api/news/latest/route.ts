import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}

// GET /api/news/latest
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return routeError(401, 'unauthorized', 'unauthorized');

  const { data, error } = await supabase
    .from('news_items')
    .select('id, headline, body, image_url, created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return routeError(500, 'news_latest_query_failed', error.message);
  const item = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return ok({ item }, { item });
}
