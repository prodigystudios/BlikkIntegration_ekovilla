"use client";

import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatCurrency, formatSacks } from '@/app/crm/lib/format';
import type { AfterCalculation } from '@/lib/domains/crm/afterCalculation';

// Efterkalkylen i Ekonomi-kortet: vad jobbet FAKTISKT gav.
//
// ── UPPSTÄLLNINGEN ÄR EN SUBTRAKTION, INTE EN TALRAD ─────────────────────────
// Blocket läses uppifrån och ned som räkningen görs: intäkt, minus material, minus arbete, =
// TB1/TB2. En rad statistikrutor hade visat samma siffror utan att visa hur de hänger ihop — och
// det är just sambandet som gör en efterkalkyl kontrollerbar. Varje avdragsrad bär därför sin egen
// aritmetik under etiketten ("91 säck EKOVILLA x 100 kr"), så talet går att räkna efter för hand.
//
// ── OKÄNT SKRIVS "–", ALDRIG "0 kr" ─────────────────────────────────────────
// Ett jobb utan säckrapport har inte materialkostnad noll — vi vet inte vad materialet kostade. En
// nolla där är den mest optimistiska siffra kalkylen kan visa, och den ser exakt ut som ett svar.
// Domänmodulen returnerar null för allt som saknas; här blir null ett streck och en rad i
// preliminärnotisen som säger VARFÖR.
//
// ── INGA TG-TRÖSKLAR, MED FLIT ──────────────────────────────────────────────
// Offertens 25/40 (MARGIN_THRESHOLDS) är satta för förkalkylens TG och kan inte återanvändas: TB2
// ligger per definition lägre, så varje jobb hade lyst rött. Nivåer för TB2 kräver utfall att sätta
// dem mot, och det underlaget är dagsfärskt. Tills dess färgas bara det som inte kräver en
// tröskel: ett NEGATIVT TB2 betyder att jobbet gick med förlust, vilket är sant oavsett var någon
// senare drar gränsen.

function formatPercent(value: number | null): string {
  if (value == null) return '–';
  return `${value.toFixed(1).replace('.', ',')} %`;
}

function formatHours(value: number | null): string {
  if (value == null) return '–';
  return `${value.toFixed(1).replace('.', ',')} h`;
}

/**
 * À-priset per säck, med ören kvar.
 *
 * ⚠️ INTE formatCurrency. Den avrundar till hela kronor (maximumFractionDigits: 0), vilket är rätt
 * för en summa men fel för en faktor: står det "88 kr/säck" bredvid en kostnad räknad på 87,50 går
 * raden inte längre att räkna efter för hand — och att den ska gå att räkna efter är hela skälet
 * till att aritmetiken skrivs ut.
 */
function formatUnitPrice(value: number): string {
  return `${new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} kr`;
}

/** En rad i uppställningen. `detail` bär radens egen aritmetik, så summan går att räkna efter. */
function LedgerRow({
  label,
  detail,
  amount,
  negative,
}: {
  label: string;
  detail?: string | null;
  amount: number | null;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="text-sm text-slate-600">{label}</span>
        {detail ? <span className="block text-[11px] leading-snug text-slate-500">{detail}</span> : null}
      </span>
      <span className={cn('shrink-0 text-sm tabular-nums', amount == null ? 'text-slate-400' : 'text-slate-900')}>
        {amount == null ? '–' : `${negative ? '−' : ''}${formatCurrency(amount, 'SEK')}`}
      </span>
    </div>
  );
}

/** TB-raderna. Kraftigare än avdragen, med täckningsgraden som andrahandsuppgift. */
function ResultRow({
  label,
  amount,
  percent,
  emphasis,
}: {
  label: string;
  amount: number | null;
  percent: number | null;
  emphasis?: boolean;
}) {
  const isLoss = amount != null && amount < 0;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={cn('text-sm', emphasis ? 'font-semibold text-slate-900' : 'text-slate-700')}>{label}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className={cn('text-xs tabular-nums text-slate-500')}>{formatPercent(percent)}</span>
        <span
          className={cn(
            'tabular-nums',
            emphasis ? 'text-base font-bold' : 'text-sm font-semibold',
            amount == null ? 'text-slate-400' : isLoss ? 'text-rose-700' : 'text-slate-900',
          )}
        >
          {amount == null ? '–' : formatCurrency(amount, 'SEK')}
        </span>
      </span>
    </div>
  );
}

export default function WorkOrderAfterCalculation({
  result,
  loading,
  loadError,
  forbidden,
}: {
  result: AfterCalculation | null;
  loading: boolean;
  loadError: boolean;
  forbidden: boolean;
}) {
  // Utan nyckeln finns blocket inte — inte ett tomt kort med en förklaring om behörighet.
  if (forbidden) return null;

  return (
    <div className="grid gap-1 border-t border-[#e0e8dc] pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className={crm.sectionTitle}>Efterkalkyl</p>
        {result?.isPreliminary ? (
          <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-800')}>Preliminär</span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-[11px] leading-4 text-slate-500">Räknar…</p>
      ) : loadError || !result ? (
        <p className="text-[11px] leading-4 text-slate-500">
          Efterkalkylen kunde inte hämtas. Ladda om sidan — talen står kvar orörda så länge.
        </p>
      ) : (
        <>
          <div className="grid divide-y divide-[#e0e8dc]">
            <LedgerRow label="Intäkt (ex moms)" amount={result.revenue} />

            {/* En rad per material, med säckantal och à-pris. Rader som inte gick att prissätta
                står kvar med ett streck i beloppet — de säckarna blåstes, och att dölja dem hade
                gjort materialkostnaden lägre än den är utan att något sa det. */}
            {result.materialLines.length === 0 ? (
              <LedgerRow label="Material" detail="Inga säckar rapporterade än" amount={null} negative />
            ) : (
              result.materialLines.map((line, index) => {
                // En enda materialrad bär etiketten "Material" och materialnamnet i aritmetiken.
                // Är de flera blir materialnamnet självt etiketten — annars hade ordet "Material"
                // upprepats tre gånger i rad och läst som ett renderingsfel.
                const single = result.materialLines.length === 1;
                const name = line.material ?? 'Utan material';
                return (
                  <LedgerRow
                    key={`${line.material ?? 'okant'}-${index}`}
                    label={single ? 'Material' : name}
                    detail={[
                      `${formatSacks(line.sacks)} säck`,
                      single ? name : null,
                      line.purchasePrice != null ? `× ${formatUnitPrice(line.purchasePrice)}/säck` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    amount={line.cost}
                    negative
                  />
                );
              })
            )}

            <LedgerRow
              label="Arbete"
              detail={
                result.laborHours == null
                  ? 'Ingen tid rapporterad än'
                  : result.laborCostPerHour == null
                    ? `${formatHours(result.laborHours)} · timkostnad ej satt`
                    : `${formatHours(result.laborHours)} × ${formatUnitPrice(result.laborCostPerHour)}/h`
              }
              amount={result.laborCost}
              negative
            />
          </div>

          <div className="mt-1 grid divide-y divide-[#e0e8dc] border-t-2 border-[#cfdcc8] pt-1">
            <ResultRow label="TB1 efter material" amount={result.tb1} percent={result.tg1} />
            <ResultRow label="TB2 efter arbete" amount={result.tb2} percent={result.tg2} emphasis />
          </div>

          {/* Preliminärnotisen säger VAD som saknas, inte bara att något gör det. "Preliminär" utan
              skäl läses som ett systemfel; med skäl är den en åtgärdslista. */}
          {result.gaps.length > 0 ? (
            <ul className="mt-2 grid list-none gap-1 p-0">
              {result.gaps.map((gap) => (
                <li key={gap.kind} className="text-[11px] leading-snug text-slate-500">
                  {gap.message}
                </li>
              ))}
            </ul>
          ) : null}

          {result.gaps.some((gap) => gap.kind === 'no_labor_rate' || gap.kind === 'missing_cost_article') ? (
            <Link href="/crm/installningar/kalkyl" className={cn(crm.link, 'mt-1 text-[11px]')}>
              Öppna kalkylinställningarna
            </Link>
          ) : null}

          <p className="mt-2 text-[11px] leading-snug text-slate-400">
            Räknas på rapporterade säckar och rapporterad tid. Timkostnaden gäller per person och timme, och den
            aktuella satsen används på alla jobb.
          </p>
        </>
      )}
    </div>
  );
}
