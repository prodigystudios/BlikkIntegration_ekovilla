import type { ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

// En lastbils dag i startsidans arbetsschema: rubriken och bilens stopp under den.
//
// Bilen stod förut som ett chip på VARJE kort ("Upplandsväsby 1" om och om igen). Den är rubriken nu,
// en gång, och korten under den är bilens rutt i ordning. Jobben utan lastbil får en egen grupp sist
// ("Utan lastbil"), utan stoppsiffror — se groupScheduleStops.

type Props = {
  /** null = "Utan lastbil". */
  truck: string | null;
  subtitle: string;
  compact: boolean;
  /** h3 i dagsvyn, h4 under hela veckans dagrubriker. */
  headingLevel: 3 | 4;
  /** ScheduleStopCard-elementen, ett <li> vardera. */
  children: ReactNode;
};

export default function ScheduleTruckGroup({ truck, subtitle, compact, headingLevel, children }: Props) {
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  const name = truck ?? 'Utan lastbil';
  return (
    <div className={cn('grid', compact ? 'gap-2.5' : 'gap-3')}>
      {compact ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 px-0.5">
          <span className="text-[#1a3f26]"><GroupIcon truck={truck} size={20} /></span>
          <Heading className="m-0 text-sm font-semibold text-slate-900">{name}</Heading>
          <span className="text-[13px] text-slate-600">· {subtitle}</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-[14px] bg-[#f4f7f2] px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#e0e8dc] bg-white text-[#1a3f26]">
            <GroupIcon truck={truck} size={20} />
          </span>
          <div className="min-w-0">
            <Heading className="m-0 text-[15px] font-semibold text-slate-900">{name}</Heading>
            <p className="m-0 text-[13px] text-slate-600">{subtitle}</p>
          </div>
        </div>
      )}
      <ol className={cn('m-0 list-none p-0', compact ? 'grid gap-3' : 'flex flex-col')}>{children}</ol>
    </div>
  );
}

// Lastbilen för en bil, en kartnål för gruppen utan — en lastbil hade sagt motsatsen till rubriken.
function GroupIcon({ truck, size }: { truck: string | null; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {truck != null ? (
        <>
          <path d="M3 7h11v9H3z" />
          <path d="M14 10h4l3 3v3h-7" />
          <circle cx="7" cy="17.5" r="1.8" />
          <circle cx="17" cy="17.5" r="1.8" />
        </>
      ) : (
        <>
          <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" />
          <circle cx="12" cy="10" r="2.2" />
        </>
      )}
    </svg>
  );
}
