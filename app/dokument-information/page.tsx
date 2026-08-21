export const dynamic = "force-dynamic";

import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { loadInfoPage, type InfoGroup, type InfoImage } from '@/lib/domains/info-page/queries';
import BlockContent from './BlockContent';

// Innehållet stod tidigare hårdkodat i den här filen och varje ändring krävde en utvecklare.
// Nu kommer grupper, sektioner och bilder ur databasen och redigeras i /admin. Utseendet är
// medvetet oförändrat: samma två nivåer, samma dragspel, samma nedladdningslänk.

function AccordionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={cn(crm.card, 'group')}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3">
        <span className="text-sm font-bold tracking-tight text-slate-900">{title}</span>
        <svg className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="grid gap-4 border-t border-[#e0e8dc] px-3.5 py-3.5">{children}</div>
    </details>
  );
}

function DocImage({ image }: { image: InfoImage }) {
  const label = image.caption?.trim() || image.fileName;

  // En bild vars objekt inte gick att signera ska säga det, inte visa en trasig ruta — den
  // som förvaltar sidan behöver se att något är fel för att kunna ladda upp den igen.
  if (!image.url) {
    return (
      <div className="grid gap-2">
        <div className="text-[13px] font-semibold text-slate-900">{label}</div>
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-4 text-[13px] text-amber-800">
          Bilden kunde inte hämtas just nu.
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="text-[13px] font-semibold text-slate-900">{label}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={label} className="max-w-full rounded-lg border border-[#e3e9df]" />
      <a href={image.url} download={image.fileName} className="w-fit text-[13px] font-semibold text-emerald-700 underline hover:text-emerald-800">Ladda ner</a>
    </div>
  );
}

export default async function DokumentInformationPage() {
  const supabase = createServerComponentClient({ cookies });

  let groups: InfoGroup[] = [];
  let loadFailed = false;
  try {
    groups = await loadInfoPage(supabase);
  } catch {
    // Migreringen ska köras FÖRE den här koden (se supabase/sql/20260821_info_sections.sql):
    // det hårdkodade innehållet är borta, så utan tabellerna finns inget att falla tillbaka på.
    // Den här grenen är skyddsnätet för den ordningen och för ett tillfälligt databasfel — en
    // sida som ligger i menyn för varenda roll ska säga det lugnt, inte kasta ett femhundrafel.
    loadFailed = true;
  }

  const withContent = groups.filter((group) => group.sections.length > 0);

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Dokument &amp; information</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">Viktiga dokument och instruktioner för personalen.</p>
      </div>

      {loadFailed && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Innehållet kunde inte hämtas just nu. Försök igen om en stund.
        </div>
      )}

      {!loadFailed && withContent.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#d5e0cf] bg-[#f4f8f1] px-4 py-10 text-center text-sm text-slate-500">
          Här finns inget innehåll ännu. En administratör lägger upp avsnitt under Admin → Dokument &amp; information.
        </div>
      )}

      {withContent.map((group) => (
        <div key={group.id} className="grid grid-cols-1 gap-3">
          <p className={crm.sectionTitle}>{group.title}</p>
          {group.sections.map((section) => (
            <AccordionCard key={section.id} title={section.title}>
              <BlockContent blocks={section.body} />
              {section.images.map((image) => (
                <DocImage key={image.id} image={image} />
              ))}
            </AccordionCard>
          ))}
        </div>
      ))}
    </div>
  );
}
