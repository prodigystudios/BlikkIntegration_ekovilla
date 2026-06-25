import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { redirect } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { listNewsItems } from '@/lib/domains/news/queries';

export const dynamic = 'force-dynamic';

export default async function NewsArchivePage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/auth/sign-in');

  const { data, error } = await listNewsItems(supabase);
  const items = Array.isArray(data) ? data : [];

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Nyheter</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">Arkiv över tidigare publicerade nyheter.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Kunde inte hämta nyheter: {error.message}
        </div>
      )}

      {!error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">Inga nyheter ännu.</div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {items.map((it: any) => {
          const created = it.created_at ? new Date(it.created_at).toLocaleString('sv-SE') : '';
          const img = (it.image_url || '').trim();
          return (
            <article key={it.id} className={cn(crm.card, 'overflow-hidden')}>
              {img && (
                <div className="max-h-[260px] w-full overflow-hidden bg-[#f6f9f3]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" className="block h-full max-h-[260px] w-full object-cover" />
                </div>
              )}
              <div className="grid gap-2.5 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="text-[17px] font-bold leading-tight text-slate-900">{it.headline}</div>
                  {created && <div className="text-[11px] text-slate-400">{created}</div>}
                </div>
                <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{it.body}</div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
