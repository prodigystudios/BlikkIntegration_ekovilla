import { createSessionClient } from '@/lib/supabase/session';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getUserProfile } from '@/lib/getUserProfile';
import { toEffectiveRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

// The shell (sidebar + content area) now comes from the app-wide AppShell in the
// root layout. This layout only keeps CRM's access gate: authenticated AND
// sales/admin (konsult == sales). Everyone else is bounced to the start page.
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const supabase = createSessionClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect('/auth/sign-in');

  const profile = await getUserProfile();
  const effectiveRole = toEffectiveRole(profile?.role);

  if (!(effectiveRole === 'sales' || effectiveRole === 'admin')) {
    redirect('/');
  }

  return <>{children}</>;
}
