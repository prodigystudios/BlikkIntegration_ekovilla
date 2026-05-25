import { NextResponse } from 'next/server';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { loadPhoneListDocument } from '@/lib/phoneListStorage';

export async function GET() {
  const json = await loadPhoneListDocument(getOptionalSupabaseAdmin());
  return NextResponse.json(json, { headers: { 'Cache-Control': 'no-store' } });
}
