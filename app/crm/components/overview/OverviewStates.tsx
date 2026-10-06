"use client";

import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { RECENT_ITEM_LIMIT } from './useCrmOverviewData';

// En tom lista och en lista som inte gick att läsa ser likadana ut i data men betyder motsatta
// saker. Utan den här skulle ett 500-svar renderas som "Inga offerter ännu."
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

// Skelettet har tabellens höjd: en rubrikrad och RECENT_ITEM_LIMIT rader med kund och projekt.
// Med listkortens 56 px höga rader hade kortet krympt när datan landade.
function TableSkeleton() {
  return (
    <div className="grid gap-1.5" aria-hidden="true">
      <div className="h-4 w-1/2 rounded bg-[#e6ece2]" />
      {Array.from({ length: RECENT_ITEM_LIMIT }).map((_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-md bg-[#dfe6da]" />
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
