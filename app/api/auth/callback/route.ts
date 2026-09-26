import { NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// This endpoint is called by the Supabase client on auth state changes to sync server cookies.
export async function POST() {
  const supabase = createSessionClient();
  // Trigger cookie set/refresh. We don't need the value here.
  await supabase.auth.getSession();
  return NextResponse.json({ ok: true });
}
