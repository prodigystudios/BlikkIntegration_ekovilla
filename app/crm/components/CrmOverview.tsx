"use client";

import Link from 'next/link';
import ChangelogCard from './ChangelogCard';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import OverviewFlowStrip from './overview/OverviewFlowStrip';
import OverviewNextActions from './overview/OverviewNextActions';
import OverviewOpenTasks from './overview/OverviewOpenTasks';
import OverviewRecentCalls from './overview/OverviewRecentCalls';
import OverviewRecentOrders from './overview/OverviewRecentOrders';
import OverviewRecentQuotes from './overview/OverviewRecentQuotes';
import OverviewWeeklyGoals from './overview/OverviewWeeklyGoals';
import { sectionLabel, useCrmOverviewData } from './overview/useCrmOverviewData';

export default function CrmOverview({ userId }: { userId: string | null }) {
  const { state, loading, refreshing, load, summary, blank, summaryFailed, scoreboardFailed } = useCrmOverviewData();

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={cn('m-0', crm.pageTitle)}>CRM-översikt</h1>
          <p className={cn('m-0 mt-1', crm.pageSubtitle)}>Välkommen tillbaka! Här är vad som händer i ditt CRM idag.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* ?log=1 öppnar formuläret direkt. Utan den landade man bara på samtalssidan och möttes
              av en knapp med exakt samma etikett — två klick där ett räcker, på den knapp som ska
              driva att loggen faktiskt används. */}
          <Link
            href="/crm/samtal?log=1"
            className={cn(crm.primaryButton, 'no-underline')}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            + Logga samtal
          </Link>
          <Link
            href="/crm/uppgifter"
            className={cn(crm.ghostButton, 'no-underline')}
          >
            Öppna uppgifter
          </Link>
          {/* Sidan hämtade en gång vid montering och låg sedan still. Den är en dagsöversikt som
              står uppe hela arbetsdagen, så den hann bli tyst gammal. */}
          {/* Ren text, inte en tredje knapp i samma vikt som de två bredvid. Att uppdatera är en
              verktygsåtgärd; att öppna uppgifter är navigering. De såg likadana ut. */}
          <button
            type="button"
            onClick={() => void load('refresh')}
            disabled={loading || refreshing}
            className="inline-flex h-8 items-center px-1 text-sm font-semibold text-slate-600 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? 'Uppdaterar…' : 'Uppdatera'}
          </button>
        </div>
      </div>

      {/* Var pengarna står — se OverviewFlowStrip för varför lagren delar nämnare och fakturerat inte gör det. */}
      <OverviewFlowStrip loading={loading} summaryFailed={summaryFailed} summary={summary} />

      {/* Rutan skiljer på grad: faller summeringen är sidans numeriska halva borta, faller en
          lista är det ett kort. Förut var allt samma röda ruta ovanför en tömd sida. */}
      {!loading && state.failed.length > 0 ? (
        <div className={cn(
          'rounded-2xl border px-4 py-3 text-sm',
          summaryFailed ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900',
        )}>
          <strong className="font-semibold">
            {summaryFailed ? 'Siffrorna kunde inte räknas' : 'Delar av översikten kunde inte läsas'}
          </strong>
          <p className="m-0 mt-1">
            Gick inte att läsa: {state.failed.map((key) => sectionLabel[key]).join(', ')}.{' '}
            {summaryFailed
              ? 'Nyckeltalen och statusbilden är dolda tills det går igen.'
              : 'Resten av sidan visas som vanligt.'}
          </p>
        </div>
      ) : null}

      {/* Main content grid */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.6fr)]">
        {/* ⚠️ `content-start` — utan den STRÄCKS korten här. Kolumnerna är grid-syskon och blir
            lika höga, och den här kolumnens auto-rader ärver `align-content: normal`, som för grid
            löser till stretch: raderna blåses upp och fyller vad statusbilden + topplistan bestämt.
            Effekten är att innehållshöjd inte styr något — en trimning av "Nästa fokus" åt kortet
            upp direkt, och korten under låg kvar. Mätt i Chrome 2026-08-17: fokuskortet 90 px
            naturligt, 317 px utsträckt. */}
        <div className="grid content-start gap-4">
          <OverviewNextActions loading={loading} summaryFailed={summaryFailed} summary={summary} />

          {/* Recent items grid. Order follows the flow the sellers work in: offert → order on the
              first row, then the two activity lists. Prospects had their own card here until
              2026-08-17 and were dropped — that stage isn't in use right now. */}
          <div className="grid gap-4 xl:grid-cols-2">
            {/* ⚠️ Raderna bär `min-w-0` på själva länken, inte bara på textkolumnen. Raden är ett
                GRID-item i listan nedan, och ett auto-spår får inte bli smalare än itemets
                min-content — som med `truncate` (white-space: nowrap) är hela projektnamnets bredd.
                Textkolumnens min-w-0 räcker alltså inte: raden växte förbi kortet och sköt ut
                statusbadgen utanför kanten så fort namnet var långt. Mätt i Chrome 2026-08-17. */}
            {/* Raderna djuplänkar till posten, inte till listan. Förut gick varje rad till samma
                mål som kortets "Visa alla", så ett klick på "Nyprod Villa HJO" landade i en lista
                där man fick leta upp raden igen — sämst på telefon, där sidan finns för att man
                snabbt ska nå en offert eller order. Parametrarna finns redan i respektive vy:
                ?quote_id= (QuotesClient), ?task_id= (TasksClient), ?call_id= (CallsClient). */}
            <OverviewRecentQuotes loading={loading} failed={blank('quotes', state.quotes.length)} quotes={state.quotes} />
            <OverviewRecentOrders loading={loading} failed={blank('workOrders', state.workOrders.length)} workOrders={state.workOrders} />
            <OverviewOpenTasks loading={loading} failed={blank('tasks', state.tasks.length)} tasks={state.tasks} />
            <OverviewRecentCalls
              loading={loading}
              failed={blank('calls', state.calls.length)}
              calls={state.calls}
              callsLast7Days={summary.callsLast7Days}
              userId={userId}
            />
          </div>
        </div>

        <div className="grid content-start gap-4">
          <OverviewWeeklyGoals
            loading={loading}
            summaryFailed={summaryFailed}
            scoreboardFailed={scoreboardFailed}
            summary={summary}
            scoreboard={state.scoreboard}
          />
        </div>
      </div>

      {/* Nytt i appen. Ligger efter innehållet men före snabbnavigeringen: ändringarna ska synas
          utan att man letar, men de är inte det man kom hit för. Kortet döljer sig självt när det
          inte finns något att visa. */}
      <ChangelogCard />

      {/* Här låg ett rutnät med ett kort per CRM-sektion — fjorton stycken, 693 px av sidans
          2177, som pekade exakt på raderna i sidoskenan. På desktop syns skenan alltid, så det var
          ren dubblering; på mobil ligger den bakom hamburgaren, men två tryck där uppe slår ett
          rutnät man måste scrolla förbi hela sidan för att nå. Borta på båda. */}
    </div>
  );
}
