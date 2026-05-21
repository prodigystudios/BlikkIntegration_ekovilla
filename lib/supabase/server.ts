import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function createServerSupabaseClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'X-Client-Info': 'ekovilla-app/1.0' } },
  });
}

// Server-side Supabase client using Service Role for storage and DB operations
export function getOptionalSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServerSupabaseClient(url, key);
}

export function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, 'Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  assert(key, 'Missing SUPABASE_SERVICE_ROLE_KEY');
  return createServerSupabaseClient(url, key);
}

export function getSupabaseAnon() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_ANON_KEY;
  assert(url, 'Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  assert(key, 'Missing SUPABASE_ANON_KEY');
  return createClient(url!, key!, {
    auth: { autoRefreshToken: true, persistSession: true },
    global: { headers: { 'X-Client-Info': 'ekovilla-app/1.0' } },
  });
}
