"use client";

import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { RECENT_ITEM_LIMIT } from './useCrmOverviewData';

// En tom lista och en lista som inte gick att läsa ser likadana ut i data men betyder motsatta
// saker. Utan den här skulle ett 500-svar renderas som "Inga offertsteg registrerade ännu."
export function SectionError() {
  return (
    <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50/70 px-4 py-3 text-xs text-rose-800">
      Kunde inte läsas just nu. Prova Uppdatera.
    </div>
  );
}

// Syns bara när en fråga slog i radtaket. Poängen med att räkna på servern var att en kapad läsning
// slutar vara tyst — så den säger det, intill de siffror den gäller.
export function TruncatedNote({ queries, className }: { queries: string[]; className?: string }) {
  if (queries.length === 0) return null;
  return (
    <p className={cn('m-0 text-[11px] leading-4 text-amber-700', className)}>
      Räknat på ett kapat urval ({queries.join(', ')}) — siffrorna kan vara för låga.
    </p>
  );
}

// Skelettet har tabellens höjd: en rubrikrad och RECENT_ITEM_LIMIT täta rader. Med listkortens
// 56 px höga rader hade kortet krympt till hälften när datan landade.
function TableSkeleton() {
  return (
    <div className="grid gap-1.5" aria-hidden="true">
      <div className="h-4 w-1/2 rounded bg-[#e6ece2]" />
      {Array.from({ length: RECENT_ITEM_LIMIT }).map((_, i) => (
        <div key={i} className="h-7 animate-pulse rounded-md bg-[#dfe6da]" />
      ))}
    </div>
  );
}

export function RecentCard({ title, href, loading, failed, children }: { title: string; href: string; loading: boolean; failed?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(crm.cardInner, 'min-w-0')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* h2, inte strong: korten är syskon till Att agera på och tavlan, och en skärmläsares
            rubriklista tappade annars halva sidan. */}
        <h2 className={cn('m-0', crm.cardTitle)}>{title}</h2>
        <Link href={href} className={cn('text-xs', crm.link)}>Visa alla</Link>
      </div>
      {loading ? <TableSkeleton /> : failed ? <SectionError /> : children}
    </div>
  );
}

// Kolumnerna i översiktens två tabeller, samma i båda så att de står i linje bredvid varandra. Klassen
// sätts på både <th> och <td>: `table-fixed` tar bredden ur rubrikraden, och en dold kolumn måste
// döljas i varje rad. Numret göms under 640 px och datumet under 768 px — på telefon räcker namn,
// belopp och status.
export const recentColumn = {
  // 'OFF-' + åtta tecken är det längsta numret (quote_number); Fortnox-numren är korta.
  number: 'hidden w-[6.5rem] sm:table-cell',
  // Namnet bryts på telefon (där numret och datumet är dolda och det ändå får plats på två rader),
  // och kortas med ellips från 640 px.
  name: 'break-words sm:truncate',
  amount: 'w-[6.25rem] text-right',
  date: 'hidden w-[5.75rem] md:table-cell',
  status: 'w-[6.75rem] text-right',
} as const;

const cellClass = 'border-t border-[#eef2ec] py-2 pr-3 align-middle last:pr-0';

export function RecentTable({ label, headers, children }: {
  label: string;
  headers: Array<{ label: string; className: string }>;
  children: React.ReactNode;
}) {
  return (
    <table aria-label={label} className="w-full table-fixed border-collapse text-xs text-slate-700">
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header.label} scope="col" className={cn('pb-1.5 pr-3 text-left text-[11px] font-medium text-slate-500 last:pr-0', header.className)}>
              {header.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function RecentCell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn(cellClass, className)}>{children}</td>;
}

// Skeleton row count is per caller, so that the card keeps its height when the data lands.
export function OverviewLoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl border border-[#e0e8dc] bg-[#dfe6da]" />
      ))}
    </div>
  );
}
