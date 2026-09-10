'use client';

import { cn } from '@/lib/shared/cn';
import { WEEKDAYS_SHORT, parseISO } from './planningDates';
import type { DeliveryChip } from '@/lib/domains/planning/deliveryStrip';

// En dags kolumn i veckotavlans leveransremsa: registrerade leveranser in till en depå.
//
// ⚠️ HÄRLEDD, INTE REDIGERBAR. Till skillnad från DayNotesCell — som remsan annars speglar — finns
// här varken "+"-affordans eller kryss. Ett chip är en rad i ops_depot_deliveries; kunde den raderas
// härifrån skulle tavlan och lagersaldot kunna gå isär. En leverans ändras där den registreras
// (Administrera → Lager).
//
// ⚠️ ORDET "LEVERANS" ÄR UPPTAGET. `DEFAULT_JOB_TYPES` har redan en jobbtyp `leverans` i teal
// (lib/domains/planning/jobTypes.ts) och den betyder material UT till kund. Chippen här betyder
// material IN till depån — samma vecka, motsatt riktning. Därför "Ankommen", och därför varken teal
// (jobbtypen), bärnsten (dagsanteckning och pausat jobb), rosa (helgdag och lagerbrist) eller grönt
// (idag och placeringsmål).

function shortDate(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export default function DeliveryStripCell({
  chips,
  isWeekend,
  isToday,
}: {
  chips: DeliveryChip[];
  isWeekend: boolean;
  isToday: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[26px] flex-col gap-1 px-1 py-1',
        isToday ? 'bg-emerald-50/50' : isWeekend ? 'bg-slate-400/[0.04]' : '',
      )}
    >
      {chips.map((c) => (
        <div
          key={c.id}
          className="overflow-hidden rounded-md border border-sky-200/80 bg-sky-50 px-1.5 py-0.5"
          title={`${c.sacks} säck ${c.material} till ${c.depot_name} — registrerad ${shortDate(c.delivered_on)}`}
        >
          <div className="flex items-center gap-1">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sky-500" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="truncate text-[10px] font-semibold leading-snug text-sky-800">
              Ankommen · {c.depot_name}
            </span>
          </div>
          <div className="truncate text-[9px] leading-snug text-sky-600">
            {/* Ett infällt chip ritas på en annan dag än sitt datum (helgen är dold), så datumet
                MÅSTE stå ut — annars påstår remsan att materialet kom en dag det inte kom. */}
            {c.sacks} säck {c.material}
            {c.folded && <span className="font-semibold"> · {shortDate(c.delivered_on)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
