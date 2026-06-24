import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { ReactNode } from 'react';
import { getUserProfile } from '@/lib/getUserProfile';

export const dynamic = 'force-dynamic';

// The shell (sidebar + content area) now comes from the app-wide AppShell in the
// root layout. This layout only keeps CRM's access gate: authenticated AND
// sales/admin (konsult == sales). Everyone else is bounced to the start page.
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect('/auth/sign-in');

  const profile = await getUserProfile();
  const effectiveRole = profile?.role === 'konsult' ? 'sales' : profile?.role || null;

  if (!(effectiveRole === 'sales' || effectiveRole === 'admin')) {
    redirect('/');
  }

  return <>{children}</>;
}
