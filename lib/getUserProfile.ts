import { requestCache } from '@/lib/requestCache';
import type { UserRole } from '@/lib/roles';
import { createSessionClient } from '@/lib/supabase/session';

export interface UserProfile {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone?: string | null;
}

// Request-cachad: layouten, sidan och deras hjälpare läser profilen var för sig (upp till tre gånger
// i samma request på /crm/installningar). En läsning per request räcker.
export const getUserProfile = requestCache(async (): Promise<UserProfile | null> => {
  const supabase = createSessionClient();
  try {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return null;
    // Single select of needed columns from self row
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, full_name, phone')
      .eq('id', user.id)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return {
      id: data.id as string,
      role: data.role as UserProfile['role'],
      full_name: (data as any).full_name ?? null,
      phone: (data as any).phone ?? null,
    };
  } catch {
    return null;
  }
});
