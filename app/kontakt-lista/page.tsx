export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { normalizeContacts, type PublicContact } from './contacts';

async function getContacts(): Promise<unknown> {
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const url = `${proto}://${host}/api/contacts`;
  // Forward cookies so the authenticated Supabase session works on the internal fetch.
  const cookie = h.get('cookie') || '';
  const res = await fetch(url, { cache: 'no-store', headers: cookie ? { cookie } : undefined });
  if (!res.ok) throw new Error('Failed to load contacts');
  return res.json();
}

function ContactRow({ person }: { person: { name: string; phone?: string | null; location?: string | null; role?: string | null } }) {
  const area = person.location || person.role || null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#eef2ec] px-3 py-2.5 first:border-t-0">
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-[13px] font-semibold text-slate-900">{person.name}</span>
        {area ? <span className="truncate text-[11px] text-slate-500">{area}</span> : null}
      </div>
      {person.phone ? (
        <a
          href={`tel:${person.phone.replace(/\s+/g, '')}`}
          className="shrink-0 text-[13px] font-semibold text-emerald-700 no-underline hover:text-emerald-800"
        >
          {person.phone}
        </a>
      ) : (
        <span className="shrink-0 text-[13px] text-slate-400">–</span>
      )}
    </div>
  );
}

function CategoryCard({ name, people, defaultOpen }: { name: string; people: PublicContact[]; defaultOpen?: boolean }) {
  return (
    <details className={cn(crm.card, 'group')} {...(defaultOpen ? { open: true } : {})}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3">
        <span className="text-sm font-bold tracking-tight text-slate-900">{name}</span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{people.length}</span>
          <svg className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </summary>
      <div className="border-t border-[#e0e8dc] px-1 pb-1">
        {people.map((p, i) => (
          <ContactRow key={p.id + i} person={p} />
        ))}
      </div>
    </details>
  );
}

export default async function ContactsPage() {
  let normalized;
  try {
    normalized = normalizeContacts(await getContacts());
  } catch {
    return (
      <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
        <h1 className={cn('m-0', crm.pageTitle)}>Kontakt & adresser</h1>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Kunde inte ladda kontaktlistan.</div>
      </div>
    );
  }

  const { categories, addresses } = normalized;

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Kontakt & adresser</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">Snabbsök kontakt och ring direkt.</p>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">Inga kontakter hittades.</div>
      ) : null}

      <div className="grid grid-cols-1 gap-3">
        {categories.map((cat, idx) => (
          <CategoryCard key={cat.name} name={cat.name} people={cat.people} defaultOpen={idx === 0} />
        ))}
      </div>

      {addresses.length > 0 ? (
        <details className={crm.card}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3">
            <span className="text-sm font-bold tracking-tight text-slate-900">Depåer</span>
            <span className="text-[11px] text-slate-400">{addresses.length}</span>
          </summary>
          <div className="grid gap-2 border-t border-[#e0e8dc] p-3.5">
            {addresses.map((addr) => {
              const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr.address)}`;
              return (
                <div key={addr.id} className="grid gap-0.5 rounded-xl border border-[#e3e9df] bg-[#f9fbf7] px-3.5 py-3">
                  <span className="text-[13px] font-bold text-slate-900">{addr.name}</span>
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="break-words text-[13px] font-semibold text-emerald-700 no-underline hover:text-emerald-800">
                    {addr.address}
                  </a>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
