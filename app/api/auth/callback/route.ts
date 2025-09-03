import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// This endpoint is called by the Supabase client on auth state changes to sync server cookies.
export async function POST(request: Request) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  // Trigger cookie set/refresh. We don't need the value here.
  await supabase.auth.getSession();
  return NextResponse.json({ ok: true });
}
