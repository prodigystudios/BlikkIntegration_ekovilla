import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

// POST /api/admin/news
// Body: { headline: string, body: string, imageUrl?: string | null }
export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  // Verify admin (nice error); RLS also enforces this.
  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profErr) return NextResponse.json({ ok: false, error: profErr.message }, { status: 500 });
  if ((prof as any)?.role !== 'admin') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const headline = String(payload?.headline || '').trim();
  const body = String(payload?.body || '').trim();
  const imageUrlRaw = payload?.imageUrl;
  const imageUrl = (imageUrlRaw === null || imageUrlRaw === undefined) ? null : String(imageUrlRaw).trim();

  if (!headline || !body) return NextResponse.json({ ok: false, error: 'headline and body required' }, { status: 400 });

  const { data: row, error } = await supabase
    .from('news_items')
    .insert({ headline, body, image_url: imageUrl || null, created_by: user.id })
    .select('id, headline, body, image_url, created_at')
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: row });
}
