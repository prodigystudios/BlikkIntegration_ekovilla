import type { ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

/**
 * Rubrikraden i startsidans kort.
 *
 * En rubrik, en valfri räknare, en valfri åtgärd — och ingen förklarande brödtext. Varje widget bar
 * tidigare sin egen instruerande mening ("Visa det som fortfarande kräver åtgärd först, och dölj
 * resten tills det behövs", "Dokument som kräver läsning eller godkännande ska fångas direkt"). De
 * beskrev komponentens beteende snarare än användarens jobb, och ingen läser dem efter första
 * besöket. Samma disciplin som /tid: informationen bär sin egen etikett.
 *
 * ⚠️ STORLEKEN ÄR text-base MED FLIT. Widgetrubrikerna var text-xl (20 px) medan sidans egen h1 är
 * 18 px (`crm.pageTitle`) — korten skrek alltså högre än sidan de ligger på, och fyra likadana
 * 20-pixelsrubriker under varandra gjorde det omöjligt att se vilket kort som var viktigast.
 *
 * `meta` är för ett tillstånd som ändras (ett antal, en status). Sätt det INTE när samma siffra
 * redan står i kortets innehåll — det var precis den dubbleringen som gjorde dokumentkortet tungt.
 */
export default function DashboardCardHeader({
  title,
  meta,
  action,
  className,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="m-0 text-base font-bold tracking-tight text-slate-900">{title}</h2>
        {meta}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
