import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { ReactNode } from 'react';
import { getUserProfile } from '@/lib/getUserProfile';
import CrmSubnav from './components/CrmSubnav';

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

  return (
    <main className="mx-auto grid w-full max-w-[1400px] gap-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-4 md:px-6 md:pb-8 md:pt-6 xl:px-8">
      <section className="grid gap-4 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4 shadow-[0_18px_44px_rgba(15,23,42,0.06)] md:p-6">
        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Ekovilla CRM</span>
          <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-4">
            <div className="grid gap-1">
              <h1 className="m-0 text-2xl font-bold tracking-[-0.03em] text-slate-900 md:text-3xl">CRM-arbetsyta</h1>
              <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                Ett eget arbetsområde för prospects, samtal, uppföljning, offerter och senare Fortnox- och planeringskopplingar.
              </p>
            </div>
            <div className="justify-self-start rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 md:justify-self-end">
              Inloggad som {profile?.full_name || 'Användare'}
            </div>
          </div>
        </div>
        <CrmSubnav role={effectiveRole} />
      </section>
      {children}
    </main>
  );
}