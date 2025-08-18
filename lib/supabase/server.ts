import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client using Service Role for storage and DB operations
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, 'Missing SUPABASE_URL');
  assert(key, 'Missing SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'X-Client-Info': 'ekovilla-app/1.0' } },
  });
}

export function getSupabaseAnon() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  assert(url, 'Missing SUPABASE_URL');
  assert(key, 'Missing SUPABASE_ANON_KEY');
  return createClient(url!, key!, {
    auth: { autoRefreshToken: true, persistSession: true },
    global: { headers: { 'X-Client-Info': 'ekovilla-app/1.0' } },
  });
}
