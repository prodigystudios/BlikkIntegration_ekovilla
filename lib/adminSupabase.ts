import { createClient } from '@supabase/supabase-js';

// Admin (service role) Supabase client. NEVER import this into a client component.
// Requires SUPABASE_SERVICE_ROLE_KEY to be set (not exposed to browser).
// Only use in server components / server actions.

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL missing (needed for admin client)');
}
if (!serviceRoleKey) {
  console.warn('[adminSupabase] SUPABASE_SERVICE_ROLE_KEY not set. Admin features will fail.');
}

export const adminSupabase = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
