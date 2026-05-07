import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminSupabase } from '@/lib/adminSupabase';

export type OffertAccessContext = {
  supabase: any;
  user: any;
  userId: string;
  profileName: string;
  isAdmin: boolean;
  canViewAll: boolean;
};

export async function getOffertAccessContext(): Promise<OffertAccessContext> {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      supabase,
      user: null,
      userId: '',
      profileName: '',
      isAdmin: false,
      canViewAll: false,
    };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  const isAdmin = profile?.role === 'admin';

  return {
    supabase,
    user,
    userId: user.id,
    profileName: String(profile?.full_name || '').trim(),
    isAdmin,
    canViewAll: isAdmin && Boolean(adminSupabase),
  };
}

export function applyOffertOwnerScope<T>(query: T, userId: string, includeAll: boolean): T {
  if (includeAll) return query;
  return (query as any).eq('user_id', userId);
}
