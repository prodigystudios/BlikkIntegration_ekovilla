import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }
  const env = process.env;
  // Return only presence flags, never the values
  const flags = {
    SUPABASE_URL: Boolean(env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_ANON_KEY: Boolean(env.SUPABASE_ANON_KEY),
    NEXT_PUBLIC_SUPABASE_URL: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
  return NextResponse.json({ ok: true, flags });
}
