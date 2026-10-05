"use client";

import Link from 'next/link';
import { useState } from 'react';
import { useCan } from '@/lib/UserProfileContext';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { ScoreboardSeller, WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import { MONEY_NOTE, formatCurrency } from './overviewFormat';
import { OverviewLoadingRows, SectionError } from './OverviewStates';
import type { OverviewFigures } from './useCrmOverviewData';

export default function OverviewWeeklyGoals({ loading, summaryFailed, scoreboardFailed, summary, scoreboard }: {
  loading: boolean;
  summaryFailed: boolean;
  /** Veckotavlan kunde inte läsas och det finns inget tidigare innehåll att visa. */
  scoreboardFailed: boolean;
  summary: OverviewFigures;
  scoreboard: WeeklyScoreboard | null;
}) {
  // Länken till målen öppnar /crm/installningar — samma nyckel som den sidan kräver.
  const canAdjustGoals = useCan('crm.settings.manage');
  const team = scoreboard?.team ?? null;
  const sellers = scoreboard?.sellers ?? [];
  // Båda läsningarna kan slå i radtaket, och de delar frågenamn — nämn varje fråga en gång.
  const truncated = Array.from(new Set([...summary.truncated, ...(scoreboard?.truncated ?? [])]));

  /* Höger kolumn: ETT kort. Måluppföljningen och topplistan visade samma data på två
      aggregeringsnivåer — de tre målraderna ÄR team-summan av de rader topplistan redan
      listade per säljare, i kortet direkt under. Nu är teamets rader kortets huvuddel och
      säljarna en lista under dem. */
  return (
    <div className={crm.cardInner}>
      {/* Kortet var "Fördelning och mål" och bar båda: fyra lagerrader ovanför en avdelare,
          fyra målrader under. Lagerraderna sitter numera i nyckeltalsbandet högst upp, så det
          som är kvar här är enbart måluppföljning.

          Fördelningsläsningen som försvann i den flytten — de tre lagren mot en delad
          nämnare — finns tillbaka högst upp på sidan, i fördelningsremsan. */}
      {/* Målraderna och listan kommer från veckotavlan (/api/crm/overview/scoreboard), som räknar
          HELA laget för alla läsare. Förut kom utfallet från summeringen, som går på sessionen:
          crm_calls_select_visible gav en säljare bara de egna samtalen, så kollegornas Samtal
          stod som 0 i listan — samtidigt som målen (admin-klienten) visade alla säljare.
          Sena uppgifter kommer fortfarande från summeringen och är läsarens egna. */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('mb-1', crm.sectionTitle)}>Måluppföljning</p>
          {/* Samma grad som de fyra syskonkorten. Var text-lg medan de gick till crm.cardTitle. */}
          <h2 className={cn('m-0', crm.cardTitle)}>Veckans mål</h2>
          {/* Remsan högst upp bär samma mening men är dold under 640 px — här syns den bara när
              remsan inte gör det, i stället för två gånger på samma skärm. */}
          <p className={cn('m-0 mt-0.5 sm:hidden', crm.meta)}>{MONEY_NOTE}</p>
        </div>
        {/* Samma nyckel som /crm/installningar kräver (crm.settings.manage) — länken skickade
            förr en säljare till en sida hen inte kommer in på. */}
        {canAdjustGoals ? (
          <Link href="/crm/installningar" className={cn('shrink-0 text-xs', crm.link)}>Justera mål</Link>
        ) : null}
      </div>
      {loading ? <OverviewLoadingRows /> : (
        <div className="grid gap-3">
          {/* Everything below is measured against a WEEKLY target, so the actuals are the
              week's — the same window the list under this card uses per säljare. With a
              rolling 7 days the team row could never equal the sum of the seller rows beside
              it, and one of the two would have to be read as broken. */}
          {/* Fallerar tavlan finns varken mål eller utfall — då en felruta, inte rader utan
              "/ mål" som ser ut som "ingen budget satt". */}
          {scoreboardFailed || !team ? <SectionError /> : (
            <>
              <StatusStrip label="Offerter mot mål" value={team.quotes.done} goal={team.quotes.target ?? 0} tone="progress" />
              <StatusStrip label="Ordervärde mot mål" value={team.orderValue.done} goal={team.orderValue.target ?? 0} tone="progress" currency />
              <StatusStrip label="Samtal mot mål" value={team.calls.done} goal={team.calls.target ?? 0} tone="progress" />
            </>
          )}
          {/* Sena uppgifter är inget mål — det är ett larm utan target. Avdelaren som förut
              skilde lager från mål skiljer nu mål från larm. */}
          <div className="my-1 h-px bg-slate-100" />
          {summaryFailed ? <SectionError /> : (
            <StatusStrip label="Sena uppgifter" value={summary.overdueTasks} tone="attention" />
          )}
          {/* Only ever shows if a query hit its row cap. The point of counting server-side
              was that a truncated read stops being silent — so it says so. */}
          {truncated.length > 0 ? (
            <p className="m-0 text-[11px] leading-4 text-amber-700">
              Räknat på ett kapat urval ({truncated.join(', ')}) — siffrorna kan vara för låga.
            </p>
          ) : null}

          {/* Mål saknas och mål som inte gick att läsa ger båda en tom lista — utan
              scoreboardFailed hade ett 500-svar renderats som "inga mål satta". */}
          {!scoreboardFailed && team && sellers.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
              Inga veckomål satta ännu. Lägg in mål i Inställningar för att aktivera uppföljningen.
            </p>
          ) : null}

          {/* Per säljare. Listan visas ÄVEN med en enda rad, till skillnad från vad jag först
              byggde: överlappet mot teamraderna ovanför är tre av sex — Samtal, Offerter och
              Ordervärde — medan Offertvärde, Antal ordrar och Fakturerat ordervärde bara finns
              här. Att dölja listan för en ensam säljare tog alltså bort tre uppföljningar hen
              inte kunde se någon annanstans. Rangordningen döljs i stället när det bara finns
              en rad; att sätta "#1" på ensamheten säger ingenting. */}
          {!scoreboardFailed && sellers.length > 0 ? (
            <>
              <div className="my-1 h-px bg-slate-100" />
              <p className={cn('m-0', crm.sectionTitle)}>Per säljare</p>
              <SellerGoalList entries={sellers} />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// TVÅ roller, inte sju. Raderna bar emerald, teal, sky, rose, amber och violet — sex hues där
// bara rose betydde något ("dåligt"). Resten var dekoration på rader som alla mäter samma sak:
// utfall mot mål. Nu säger färgen antingen "framsteg" eller "kräver åtgärd", och framstegsgrönt
// kommer ur varumärkets ramp i stället för Tailwinds palett.
//
// ⚠️ Ett uppnått mål färgades först i --crm-flow-1. Det gjorde samma färgruta till TVÅ saker på
// samma sida — "Offert" i fördelningsremsan och "i mål" här — och rampens stopp är ordinala
// (var i flödet), inte binära (uppnått eller ej). Att raden är i mål står redan i talet bredvid
// ("17 / 15"); att säga det med färg också var en tredje röst för samma sak.
function stripTone(tone: 'progress' | 'attention') {
  return tone === 'attention' ? 'var(--crm-attention)' : 'var(--crm-flow-3)';
}

function StatusStrip({ label, value, tone, goal, currency = false }: { label: string; value: number; tone: 'progress' | 'attention'; goal?: number; currency?: boolean }) {
  // The bar needs something to measure against: a goal. Without one, a count keeps the old rough
  // 16-%-per-unit fill and a money row shows a damped full bar — the same convention the
  // leaderboard uses for a figure with no target, since a krona amount has no natural scale of
  // its own.
  const hasGoal = goal != null && goal > 0;
  const denominator = hasGoal ? goal! : null;
  const width = denominator != null
    ? value <= 0 ? 0 : Math.min(100, (value / denominator) * 100)
    : currency
      ? value > 0 ? 100 : 0
      : value <= 0 ? 0 : Math.min(100, value * 16);
  const displayValue = currency ? formatCurrency(value, 'SEK') : value;
  const displayGoal = hasGoal
    ? currency ? formatCurrency(goal!, 'SEK') : String(goal)
    : null;

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
        <span className="min-w-0 truncate">{label}</span>
        <strong className="shrink-0 text-slate-800">{displayGoal ? `${displayValue} / ${displayGoal}` : displayValue}</strong>
      </div>
      {/* Staplarna bär ingen egen information: värdet och målet står i klartext på raden ovanför,
          och en skärmläsare som läser upp dem igen som progressbar hade sagt samma sak två gånger
          med sämre ord. De är dekor och deklareras som dekor. */}
      <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--crm-track)' }} aria-hidden="true">
        <div
          className={cn('h-1.5 rounded-full transition-all', denominator == null && currency && 'opacity-40')}
          style={{ width: `${width}%`, backgroundColor: stripTone(tone) }}
        />
      </div>
    </div>
  );
}

// Hur många säljare som syns innan man ber om resten. Tre räcker för att listan ska läsa som en
// rangordning utan att kortet blir en egen sida — sex säljare à sex rader var 1 080 px, och det
// var i praktiken hela vänsterkolumnens dödyta.
const SELLER_PREVIEW_COUNT = 3;

// Raderna som förut var kortet "Teamöversikt / Topplista". Kortchromet är borta — de bor numera
// inne i måluppföljningskortet, under teamets rader, eftersom de är samma data en nivå ner.
function SellerGoalList({ entries }: { entries: ScoreboardSeller[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? entries : entries.slice(0, SELLER_PREVIEW_COUNT);

  return (
    <>
      <div className="grid gap-2">
        {visible.map((entry, index) => (
          <div key={entry.userId} className="rounded-xl border border-slate-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {entries.length > 1 ? (
                  <span className={cn('tabular-nums', crm.metaStrong)}>{index + 1}.</span>
                ) : null}
                <strong className={crm.bodyStrong}>{entry.name}</strong>
              </div>
              <span className={cn('tabular-nums', crm.metaStrong)}>{Math.round(entry.progressScore * 100)} %</span>
            </div>
            <div className="mt-2 grid gap-1">
              <TeamProgressRow label="Samtal" value={entry.metrics.calls.done} target={entry.metrics.calls.target ?? undefined} />
              <TeamProgressRow label="Offerter" value={entry.metrics.quotes.done} target={entry.metrics.quotes.target ?? undefined} />
              <TeamProgressRow label="Offertvärde" value={entry.metrics.quoteValue.done} target={entry.metrics.quoteValue.target ?? undefined} currency />
              <TeamProgressRow label="Antal ordrar" value={entry.metrics.orderCount.done} target={entry.metrics.orderCount.target ?? undefined} />
              <TeamProgressRow label="Ordervärde" value={entry.metrics.orderValue.done} target={entry.metrics.orderValue.target ?? undefined} currency />
              <TeamProgressRow label="Fakturerat ordervärde" value={entry.metrics.invoicedValue.done} target={entry.metrics.invoicedValue.target ?? undefined} currency />
            </div>
          </div>
        ))}
      </div>
      {entries.length > SELLER_PREVIEW_COUNT ? (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className={cn('mt-2 justify-self-start text-xs', crm.link)}
        >
          {showAll ? 'Visa färre' : `Visa alla (${entries.length})`}
        </button>
      ) : null}
    </>
  );
}

// Samma två roller som StatusStrip. Säljarraderna bar fem hues för sex rader som alla mäter
// utfall mot mål — färgen skilde raderna åt, inte betydelsen.
function TeamProgressRow({ label, value, target, currency = false }: { label: string; value: number; target?: number; currency?: boolean }) {
  // Rader utan veckomål (t.ex. fakturerat ordervärde) visar BARA talet. De ritade förut en
  // full stapel dämpad till 40 % opacitet — "subtle visual" enligt kommentaren, men en fylld
  // stapel läser som ett uppnått mål, och raden har inget mål att uppnå. Nu finns ingen stapel
  // alls där, vilket också är det enda som skiljer de två sorternas rader åt visuellt.
  const hasTarget = target != null && target > 0;
  const width = hasTarget ? (value <= 0 ? 0 : Math.min(100, (value / target!) * 100)) : 0;
  const displayValue = currency ? formatCurrency(value, 'SEK') : value;
  const displayTarget = hasTarget ? (currency ? formatCurrency(target!, 'SEK') : target) : null;

  return (
    <div className="grid gap-0.5">
      <div className={cn('flex items-center justify-between gap-2', crm.micro)}>
        <span>{label}</span>
        <strong className="text-slate-700">{displayTarget != null ? `${displayValue} / ${displayTarget}` : displayValue}</strong>
      </div>
      {hasTarget ? (
        <div className="h-1 rounded-full" style={{ backgroundColor: 'var(--crm-track)' }} aria-hidden="true">
          <div
            className="h-1 rounded-full"
            style={{ width: `${width}%`, backgroundColor: stripTone('progress') }}
          />
        </div>
      ) : null}
    </div>
  );
}
