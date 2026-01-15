import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

// GET /api/news/latest
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('news_items')
    .select('id, headline, body, image_url, created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const item = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return NextResponse.json({ ok: true, item });
}
