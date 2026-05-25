import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const newsCreateSchema = z.object({
  headline: z.string().trim().min(1),
  body: z.string().trim().min(1),
  imageUrl: z.union([z.string().trim(), z.null()]).optional(),
});

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

// POST /api/admin/news
// Body: { headline: string, body: string, imageUrl?: string | null }
export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return routeError(401, 'unauthorized', 'unauthorized');

  // Verify admin (nice error); RLS also enforces this.
  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profErr) return routeError(500, 'admin_profile_lookup_failed', profErr.message);
  if ((prof as any)?.role !== 'admin') return routeError(403, 'forbidden', 'forbidden');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeError(400, 'invalid_json', 'invalid json');
  }

  const parsed = newsCreateSchema.safeParse(body);
  if (!parsed.success) {
    return routeError(400, 'validation_error', 'headline and body required', parsed.error.flatten());
  }

  const headline = parsed.data.headline;
  const newsBody = parsed.data.body;
  const imageUrl = parsed.data.imageUrl || null;

  const { data: row, error } = await supabase
    .from('news_items')
    .insert({ headline, body: newsBody, image_url: imageUrl, created_by: user.id })
    .select('id, headline, body, image_url, created_at')
    .maybeSingle();

  if (error) return routeError(500, 'admin_news_create_failed', error.message);
  return ok({ item: row }, { item: row });
}
