import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import {
  asRecord,
  buildSensitiveProfileUpdates,
  mergeSensitiveStatus,
  SENSITIVE_PROFILE_SELECT,
} from '../../../../lib/profileDetails';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const admin = getOptionalSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!admin) {
    return NextResponse.json({ error: 'service role not configured' }, { status: 500 });
  }

  const { data, error } = await admin
    .from('employee_sensitive_details')
    .select(SENSITIVE_PROFILE_SELECT)
    .eq('user_id', authData.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'failed loading sensitive profile status', details: error.message }, { status: 500 });
  }

  return NextResponse.json({ sensitiveStatus: mergeSensitiveStatus(asRecord(data)) });
}

export async function PUT(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const admin = getOptionalSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!admin) {
    return NextResponse.json({ error: 'service role not configured' }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const updates = buildSensitiveProfileUpdates(body);
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'no supported fields provided' }, { status: 400 });
  }

  const { error } = await admin
    .from('employee_sensitive_details')
    .upsert({ user_id: authData.user.id, ...updates }, { onConflict: 'user_id' });

  if (error) {
    return NextResponse.json({ error: 'failed updating sensitive profile', details: error.message }, { status: 500 });
  }

  const { data: freshRow, error: freshError } = await admin
    .from('employee_sensitive_details')
    .select(SENSITIVE_PROFILE_SELECT)
    .eq('user_id', authData.user.id)
    .maybeSingle();

  if (freshError) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, sensitiveStatus: mergeSensitiveStatus(asRecord(freshRow)) });
}

export const PATCH = PUT;