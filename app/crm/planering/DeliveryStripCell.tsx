'use client';

import { cn } from '@/lib/shared/cn';
import { WEEKDAYS_SHORT, parseISO } from './planningDates';
import type { DeliveryChip } from '@/lib/domains/planning/deliveryStrip';

// En dags kolumn i veckotavlans leveransremsa: material IN till en depå.
//
// ⚠️ HÄRLEDD, INTE EN ANTECKNING. Till skillnad från DayNotesCell — som remsan annars speglar —
// finns här ingen "+"-affordans och inget kryss. Ett chip är en rad i databasen; kunde den redigeras
// härifrån skulle tavlan och lagersaldot kunna gå isär. Leveranser hanteras under
// Administrera → Lager. Enda handlingen här är att kvittera en ankomst, som är ett tillståndsbyte
// och inte en redigering.
//
// 🧨 ANKOMMEN OCH ANKOMMER ÄR INTE SAMMA SAK. Ankommen räknas i lagersaldot, ankommer gör det inte —
// den är beställd, inte levererad. Ser de likadana ut kommer någon planera mot material som inte
// finns. Därför skilda på FORM (fylld ram kontra streckad), IKON (bock kontra klocka) och ORD, inte
// bara på nyans.
//
// ⚠️ ORDET "LEVERANS" ÄR UPPTAGET: DEFAULT_JOB_TYPES har redan en jobbtyp `leverans` i teal
// (lib/domains/planning/jobTypes.ts) som betyder material UT till kund. Samma vecka, motsatt
// riktning. Därför varken det ordet eller teal — och inte heller bärnsten (dagsanteckning och pausat
// jobb), rosa (helgdag och lagerbrist) eller grönt (idag och placeringsmål).

function shortDate(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export default function DeliveryStripCell({
  chips,
  isWeekend,
  isToday,
  canReceive,
  onReceive,
}: {
  chips: DeliveryChip[];
  isWeekend: boolean;
  isToday: boolean;
  canReceive: boolean;
  onReceive: (chip: DeliveryChip) => void;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[26px] flex-col gap-1 px-1 py-1',
        isToday ? 'bg-emerald-50/50' : isWeekend ? 'bg-slate-400/[0.04]' : '',
      )}
    >
      {chips.map((c) => {
        const arrived = c.kind === 'arrived';
        return (
          <div
            key={c.id}
            className={cn(
              'group/lev overflow-hidden rounded-md px-1.5 py-0.5',
              arrived
                ? 'border border-sky-200/80 bg-sky-50'
                : 'border border-dashed border-slate-300 bg-white',
            )}
            title={
              arrived
                ? `${c.sacks} säck ${c.material} till ${c.depot_name} — ankom ${shortDate(c.delivered_on)}`
                : `${c.sacks} säck ${c.material} till ${c.depot_name} — väntas ${shortDate(c.delivered_on)}. Räknas inte i lagersaldot förrän ankomsten är bekräftad.`
            }
          >
            <div className="flex items-center gap-1">
              {arrived ? (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sky-500" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              )}
              <span className={cn('truncate text-[10px] font-semibold leading-snug', arrived ? 'text-sky-800' : 'text-slate-500')}>
                {arrived ? 'Ankommen' : 'Ankommer'} · {c.depot_name}
              </span>
            </div>

            <div className={cn('truncate text-[9px] leading-snug', arrived ? 'text-sky-600' : 'text-slate-400')}>
              {/* Ett infällt chip ritas på en annan dag än sitt datum (helgen är dold), så datumet
                  MÅSTE stå ut — annars påstår remsan fel dag. */}
              {c.sacks} säck {c.material}
              {c.folded && <span className="font-semibold"> · {shortDate(c.delivered_on)}</span>}
            </div>

            {!arrived && canReceive && (
              <button
                type="button"
                onClick={() => onReceive(c)}
                className="mt-0.5 hidden w-full rounded border border-sky-200 bg-sky-50 py-px text-[9px] font-bold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 group-hover/lev:block"
              >
                Bekräfta ankomst
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
