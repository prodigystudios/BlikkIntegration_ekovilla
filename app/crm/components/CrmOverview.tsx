"use client";

import Link from 'next/link';
import ChangelogCard from './ChangelogCard';
import { useCan } from '@/lib/UserProfileContext';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import OverviewAchievementBanner from './overview/OverviewAchievementBanner';
import OverviewKpiCards from './overview/OverviewKpiCards';
import OverviewLeaderboard from './overview/OverviewLeaderboard';
import OverviewNextActions from './overview/OverviewNextActions';
import OverviewRecentOrders from './overview/OverviewRecentOrders';
import OverviewRecentQuotes from './overview/OverviewRecentQuotes';
import OverviewSalesCoach from './overview/OverviewSalesCoach';
import OverviewSellerProgress from './overview/OverviewSellerProgress';
import OverviewTeamBoard from './overview/OverviewTeamBoard';
import { TruncatedNote } from './overview/OverviewStates';
import { sectionLabel, useCrmOverviewData } from './overview/useCrmOverviewData';

export default function CrmOverview({ userId }: { userId: string | null }) {
  const { state, loading, refreshing, load, summary, blank, summaryFailed, scoreboardFailed } = useCrmOverviewData();
  // Säljcoachen är för den som säljer: coachens API kräver crm.write, och en konsult (läsbehörig)
  // hade fått en knapp till en sida där varje fråga nekas.
  const canSell = useCan('crm.write');

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

      {/* Veckans nådda mål. Syns bara när någon har en stjärna och läsaren inte redan stängt den. */}
      <OverviewAchievementBanner scoreboard={state.scoreboard} userId={userId} />

      {/* Var pengarna står — se OverviewKpiCards för varför lagren delar nämnare och fakturerat inte gör det. */}
      <OverviewKpiCards loading={loading} summaryFailed={summaryFailed} summary={summary} />

      {/* Summeringens kapning, på sidnivå och i alla bredder. Den gäller inte bara nyckeltalen
          (dolda på telefon) utan också Att agera på — sena uppgifter och samtal räknas i samma
          summering. Låg förut i målkortet, som syntes överallt. */}
      <TruncatedNote queries={summary.truncated} />

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

      {/* Lagets vecka och säljarna i den, ur samma tavla. Dolda under 640 px som nyckeltalen: på
          telefon går man in för att se en offert eller ringa, inte för att läsa statistik. */}
      <div className="hidden gap-4 sm:grid xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
        <OverviewTeamBoard loading={loading} scoreboardFailed={scoreboardFailed} scoreboard={state.scoreboard} />
        <OverviewLeaderboard loading={loading} scoreboardFailed={scoreboardFailed} scoreboard={state.scoreboard} userId={userId} />
      </div>

      {/* Varje säljare mot sina egna veckomål, över hela bredden: sex mått per rad behöver
          plats. Ersätter högerkolumnens "Veckans mål", vars lagrader nu är tavlan ovanför och vars
          säljarlista nu är det här. Sena uppgifter, kortets sista rad, står först i Att agera på
          när det finns några. */}
      <OverviewSellerProgress loading={loading} scoreboardFailed={scoreboardFailed} scoreboard={state.scoreboard} userId={userId} />

      {/* Att agera på och Säljcoachen bredvid varandra, som i mockupen, sedan de senaste offerterna
          och ordrarna. På telefon, där statistiken ovanför är dold, är det här sidans början: man
          går in för att göra något. Att agera på får den bredare kolumnen — den bär flera rader,
          coachen ett tips. `items-start`: korten ska inte sträckas till varandras höjd. */}
      {/* `grid-cols-1` och inte ett implicit auto-spår: ett auto-spår växer till innehållets
          min-content, och ett långt obrutet kundnamn hade sprängt kortet på telefon (CRM grid blowout). */}
      <div className={cn('grid grid-cols-1 items-start gap-4', canSell && 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]')}>
        <OverviewNextActions
          loading={loading}
          summaryFailed={summaryFailed}
          summary={summary}
          scoreboard={state.scoreboard}
          userId={userId}
        />
        {canSell ? (
          <OverviewSalesCoach
            loading={loading}
            failed={summaryFailed || summary.oldestWaitingQuoteFailed}
            quote={summary.oldestWaitingQuote}
          />
        ) : null}
      </div>

      {/* Offert → order, i den ordning säljarna arbetar. Korten Öppna uppgifter och Senaste samtal
          låg här till 2026-10-05: de fanns inte i VD:ns mockup, och deras varningar — sena uppgifter
          och en samtalslogg som legat stilla — står nu i Att agera på. */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* ⚠️ Raderna bär `min-w-0` på själva länken, inte bara på textkolumnen. Raden är ett
            GRID-item i listan nedan, och ett auto-spår får inte bli smalare än itemets
            min-content — som med `truncate` (white-space: nowrap) är hela projektnamnets bredd.
            Textkolumnens min-w-0 räcker alltså inte: raden växte förbi kortet och sköt ut
            statusbadgen utanför kanten så fort namnet var långt. Mätt i Chrome 2026-08-17. */}
        {/* Raderna djuplänkar till posten, inte till listan. Förut gick varje rad till samma
            mål som kortets "Visa alla", så ett klick på "Nyprod Villa HJO" landade i en lista
            där man fick leta upp raden igen — sämst på telefon, där sidan finns för att man
            snabbt ska nå en offert eller order. */}
        <OverviewRecentQuotes loading={loading} failed={blank('quotes', state.quotes.length)} quotes={state.quotes} />
        <OverviewRecentOrders loading={loading} failed={blank('workOrders', state.workOrders.length)} workOrders={state.workOrders} />
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
