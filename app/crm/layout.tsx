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
    <main className="mx-auto grid w-full max-w-[1760px] gap-3 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-2.5 md:px-6 md:pb-8 md:pt-3.5 xl:px-8 2xl:px-10">
      <section className="grid gap-2 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-3 shadow-[0_18px_44px_rgba(15,23,42,0.06)] md:px-3.5 md:py-2.5 xl:px-4 xl:py-3">
        <div className="grid gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Ekovilla CRM</span>
          <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-4">
            <div className="grid gap-1">
              <h1 className="m-0 text-[clamp(1.55rem,2.35vw,2.2rem)] font-bold tracking-[-0.045em] text-slate-950">CRM-arbetsyta</h1>
            </div>
            <div className="justify-self-start rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_10px_22px_rgba(15,23,42,0.04)] md:justify-self-end">
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