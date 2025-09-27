import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

export interface UserProfile {
  id: string;
  role: 'member' | 'sales' | 'admin';
  full_name: string | null;
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = createServerComponentClient({ cookies });
  try {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return null;
    // Single select of needed columns from self row
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return {
      id: data.id as string,
      role: data.role as UserProfile['role'],
      full_name: (data as any).full_name ?? null,
    };
  } catch {
    return null;
  }
}
