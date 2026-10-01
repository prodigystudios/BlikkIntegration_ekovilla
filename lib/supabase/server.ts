import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function createServerSupabaseClient(url: string, key: string, fetchImpl?: typeof fetch) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'X-Client-Info': 'ekovilla-app/1.0' }, ...(fetchImpl ? { fetch: fetchImpl } : {}) },
  });
}

// Två cachar som annars ger ett gammalt svar:
//   - Next 14 lägger fetch i sin datacache i en route som bara har GET (eller bara PUT) och inte läser kakan — också
//     supabase-js anrop, trots force-dynamic. `no-store` stänger av den.
//   - React och Next memoiserar GET under en rendering av en serverkomponent: samma adress och headrar ger första svaret
//     igen, oavsett `cache`. En egen signal är det enda som stänger av det (react.react-server: cachedFetch,
//     next/dist/server/lib/dedupe-fetch.js).
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store', signal: init?.signal ?? new AbortController().signal });

function getAdminCredentials() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, 'Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  assert(key, 'Missing SUPABASE_SERVICE_ROLE_KEY');
  return { url, key };
}

// Server-side Supabase client using Service Role for storage and DB operations
export function getOptionalSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServerSupabaseClient(url, key);
}

export function getSupabaseAdmin() {
  const { url, key } = getAdminCredentials();
  return createServerSupabaseClient(url, key);
}

// Service-rollen utan cachar: varje anrop går hela vägen till databasen. För rader som aldrig får läsas gamla —
// Fortnox-tokenen: en gammal rad skickar en redan förbrukad refresh-token till Fortnox.
export function getSupabaseAdminUncached() {
  const { url, key } = getAdminCredentials();
  return createServerSupabaseClient(url, key, noStoreFetch);
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
