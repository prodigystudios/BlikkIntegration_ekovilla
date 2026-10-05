"use client";

import Link from 'next/link';
import { useMemo } from 'react';
import EmptyState from '@/components/ui/EmptyState';
import { useCan } from '@/lib/UserProfileContext';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { daysSince, formatRelativeTime } from '@/lib/shared/relativeTime';
import { formatDateTime } from './overviewFormat';
import { RecentCard } from './OverviewStates';
import type { CallItem } from './overviewTypes';

const outcomeLabel: Record<CallItem['outcome'], string> = {
  no_answer: 'Ej svar',
  follow_up: 'Följ upp',
  positive: 'Positivt',
  negative: 'Negativt',
};

function getProspectFromCall(item: CallItem) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getCallCompanyName(item: CallItem) {
  return getProspectFromCall(item)?.company_name || item.company_name || 'Fristående samtal';
}

// Fönstret som avgör om kortet säger ifrån är summeringens egna sju dagar (window.since i
// getCrmOverviewWindow) — inte ett tal räknat ur listan. Se staleCalls.

export default function OverviewRecentCalls({ loading, failed, calls, callsLast7Days, userId }: {
  loading: boolean;
  failed: boolean;
  calls: CallItem[];
  callsLast7Days: number;
  userId: string | null;
}) {
  // Admin ser hela teamets samtal, säljaren sina egna — samma nyckel (crm.admin) som styr vad API:t
  // lämnar ut. Förr en jämförelse mot rollen.
  const seesWholeTeam = useCan('crm.admin');
  // Samtalsloggen SKA användas — att den ligger stilla är säljarnas slarv, inte en död funktion.
  // Kortet visade bara absoluta datum, så två rader från juni läste som färsk aktivitet: gröna
  // "Positivt"-märken och ingenting som sa hur gammalt det var. Åldern är hela poängen med kortet.
  const staleCalls = useMemo(() => {
    // 🧨 UTLÖSAREN får inte komma ur listan. Den är kapad till fem rader, och
    // crm_calls_select_visible släpper igenom mer än de egna samtalen — även kollegors samtal på
    // prospekt man är tilldelad. Fem sådana räckte för att den egna raden föll utanför urvalet,
    // och då tystnade påminnelsen precis när den skulle ha ljudit.
    //
    // callsLast7Days räknas av servern på HELA det synliga urvalet. Är den noll har ingen som
    // användaren ser loggat något på sju dagar — och för en säljare ingår hen själv i det, så
    // båda formuleringarna nedan är sanna oavsett vem som läser.
    if (callsLast7Days > 0 || calls.length === 0) return null;
    // Antalet dygn är däremot bara en detalj och får komma ur listan när det går. Ligger den egna
    // raden utanför de fem säger kortet "över en vecka" i stället för att gissa en siffra.
    const scoped = seesWholeTeam ? calls : calls.filter((call) => call.user_id === userId);
    return { days: daysSince(scoped[0]?.call_at) };
  }, [callsLast7Days, calls, seesWholeTeam, userId]);

  return (
    <RecentCard title="Senaste samtal" href="/crm/samtal" loading={loading} failed={failed}>
      {calls.length === 0 ? <EmptyState description="Inga samtal loggade ännu." /> : (
        <div className="grid gap-2">
          {staleCalls ? (
            <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {/* Urvalet är RLS-filtrerat: en admin ser allas samtal, alla andra sina egna
                  plus kollegors på prospekt de äger. Påståendet måste följa med — "ingen
                  har loggat" vore fel när det bara betyder att DU inte har det. */}
              {seesWholeTeam ? 'Ingen har loggat ett samtal på ' : 'Du har inte loggat ett samtal på '}
              {staleCalls.days != null ? `${staleCalls.days} dagar.` : 'över en vecka.'}
            </p>
          ) : null}
          {calls.map((call) => (
            <Link key={call.id} href={`/crm/samtal?call_id=${call.id}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
              <div className="min-w-0">
                <strong className={cn('block truncate', crm.bodyStrong)}>{getCallCompanyName(call)}</strong>
                {/* Relativ ålder i raden, exakt tidpunkt på hover. "8 juni 2026 14:27" krävde
                    att läsaren räknade dagar i huvudet, och ingen gör det. */}
                <p className={cn('m-0 truncate', crm.meta)} title={formatDateTime(call.call_at)}>{formatRelativeTime(call.call_at)}</p>
              </div>
              <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{outcomeLabel[call.outcome]}</span>
            </Link>
          ))}
        </div>
      )}
    </RecentCard>
  );
}
