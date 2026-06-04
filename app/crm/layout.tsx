import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { ReactNode } from 'react';
import { getUserProfile } from '@/lib/getUserProfile';
import CrmSidebar from './components/CrmSidebar';

export const dynamic = 'force-dynamic';

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect('/auth/sign-in');

  const profile = await getUserProfile();
  const role = profile?.role || null;
  const effectiveRole = role === 'konsult' ? 'sales' : role;

  if (!(effectiveRole === 'sales' || effectiveRole === 'admin')) {
    redirect('/');
  }

  const fullName = profile?.full_name || null;
  const initial = fullName ? fullName.charAt(0).toUpperCase() : 'U';

  return (
    <div
      className="crm-shell flex"
      style={{ height: 'calc(100dvh - var(--header-base, 56px) - var(--safe-top, 0px))' }}
    >
      <CrmSidebar role={effectiveRole} userName={fullName} userInitial={initial} />
      <main
        className="min-w-0 flex-1 overflow-auto px-6 py-6"
        style={{ backgroundColor: 'var(--crm-content-bg)' }}
      >
        {children}
      </main>
    </div>
  );
}
