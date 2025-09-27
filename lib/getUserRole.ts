import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

export type UserRole = 'member' | 'sales' | 'admin';

// Secure role fetch: uses auth.getUser() (contacts auth server) then tries view, then direct table.
export async function getUserRole(): Promise<UserRole | null> {
  const supabase = createServerComponentClient({ cookies });
  try {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      if (process.env.NODE_ENV !== 'production') console.error('[getUserRole] getUser error', userErr.message);
      return null;
    }
    if (!user) return null;

    // 1. Try convenience view
    const { data: viewData, error: viewErr } = await supabase
      .from('current_user_role')
      .select('role')
      .maybeSingle();
    if (viewData?.role) {
      if (process.env.NODE_ENV !== 'production') console.log('[getUserRole] via view', viewData.role);
      return viewData.role as UserRole;
    }
    if (viewErr && process.env.NODE_ENV !== 'production') console.warn('[getUserRole] view error', viewErr.message);

    // 2. Fallback: direct self-row select
    const { data: profileRow, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileErr && process.env.NODE_ENV !== 'production') console.error('[getUserRole] profiles fallback error', profileErr.message);
    const role = (profileRow?.role as UserRole | undefined) || null;
    if (process.env.NODE_ENV !== 'production') console.log('[getUserRole] resolved role', role);
    return role;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[getUserRole] unexpected', err);
    return null;
  }
}
