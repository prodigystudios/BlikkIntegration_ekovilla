"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatCurrency, formatQuantity, formatSacks } from '@/app/crm/lib/format';
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

const OPEN_STORAGE_KEY = 'crm.workOrder.afterCalculation.open';

/**
 * Om uppställningen är utfälld, ihågkommet mellan arbetsordrar.
 *
 * Standard är HOPFÄLLD, men den som faktiskt följer lönsamheten öppnar den på varje order — och ett
 * val man måste göra om på varje sida är ett val som slutar användas.
 *
 * ⚠️ localStorage läses i en EFFEKT, aldrig under första renderingen. Servern har ingen
 * localStorage, så ett värde därifrån i initialstaten hade gett olika HTML på server och klient och
 * en hydreringsvarning. Läsningen är dessutom try/catch:ad: i privat läge kan själva åtkomsten
 * kasta, och en kraschad Ekonomi-yta vore ett dyrt pris för en ihågkommen fällning.
 */
function useAfterCalculationOpen(): [boolean, (next: boolean) => void] {
  const [open, setOpenState] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(OPEN_STORAGE_KEY) === '1') setOpenState(true);
    } catch {
      // Ingen lagring att läsa — standarden gäller.
    }
  }, []);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(OPEN_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Valet gäller den här sidvisningen även när det inte går att spara.
    }
  }, []);

  return [open, setOpen];
}

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
      {/* Minustecknet bara när det finns något att dra av. En nollrapport är en giltig rad
          ("vi var här, inget gick åt") och "−0 kr" läser som ett räknefel. */}
      <span className={cn('shrink-0 text-sm tabular-nums', amount == null ? 'text-slate-400' : 'text-slate-900')}>
        {amount == null ? '–' : `${negative && amount !== 0 ? '−' : ''}${formatCurrency(amount, 'SEK')}`}
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
      {/* Går talet inte att räkna skrivs ETT streck, inte två. Procenten är null i exakt samma
          lägen som beloppet, och "–  –" bredvid varandra läser som ett renderingsfel snarare än
          som ett svar. */}
      <span className="flex shrink-0 items-baseline gap-2">
        {amount == null ? null : (
          <span className="text-xs tabular-nums text-slate-500">{formatPercent(percent)}</span>
        )}
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
  // ⚠️ Hooken står FÖRE varje villkorlig retur. `forbidden` avgörs av ett svar som landar efter
  // första renderingen, så en tidig retur ovanför hade ändrat antalet hooks mellan två renderingar
  // och kraschat hela sidan (react-hooks/rules-of-hooks).
  const [open, setOpen] = useAfterCalculationOpen();

  // Utan nyckeln finns blocket inte — inte ett tomt kort med en förklaring om behörighet.
  if (forbidden) return null;

  return (
    <div className="grid gap-1 border-t border-[#e0e8dc] pt-4">
      {/* ⚠️ IHOPFÄLLD SOM STANDARD. Ekonomi-kortet bär redan ett dussin artikelrader plus
          summering och fakturering; uppställningen nedan är ytterligare en halv skärm, och långt
          ifrån alla som öppnar en arbetsorder är där för lönsamheten. Talen som ändå ska gå att
          fånga i förbifarten (TB1 och TB2 i procent) står i Snabböversikten till höger — därför
          upprepas de INTE i den hopfällda rubriken, som annars hade visat samma siffra tre gånger
          i samma vy. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="-mx-1 flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[#f1f5ee]"
      >
        <span className="flex items-center gap-1.5">
          <svg
            className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-90')}
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={crm.sectionTitle}>Efterkalkyl</span>
        </span>
        {result?.isPreliminary ? (
          <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-800')}>Preliminär</span>
        ) : null}
      </button>

      {!open ? null : loading && !result ? (
        <p className="text-[11px] leading-4 text-slate-500">Räknar…</p>
      ) : !result ? (
        <p className="text-[11px] leading-4 text-slate-500">
          Efterkalkylen kunde inte hämtas. Ladda om sidan.
        </p>
      ) : (
        <>
          {/* ⚠️ EN MISSLYCKAD OMHÄMTNING KASTAR INTE BORT TALEN. Kortet räknar om efter varje
              sparad artikelrad och varje borttagen delrapport; föll den omräkningen ersattes en
              fullt läsbar uppställning av en felrad — och beskedet ska säga att talen är gamla,
              inte radera dem. */}
          {loadError ? (
            <p className="mb-1 text-[11px] leading-snug text-amber-800">
              Senaste uppdateringen misslyckades. Talen nedan är från förra hämtningen.
            </p>
          ) : null}
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

            {/* Sålda rader utanför säckrapporten — skivor, duk, brandmatta, etablering. Utan dem
                bidrar allt vi säljer som inte är lösull med intäkt och noll kostnad, och TB blir
                systematiskt för högt. Etableringsraden hamnar här med 0 kr, vilket är sant: den
                artikeln har inköpspris 0 i Fortnox. */}
            {result.otherMaterialLines.map((line, index) => (
              <LedgerRow
                key={`${line.articleNumber ?? line.label}-${index}`}
                label={line.label}
                detail={[
                  formatQuantity(line.quantity),
                  line.purchasePrice != null ? `× ${formatUnitPrice(line.purchasePrice)}` : 'inköpspris saknas',
                ].join(' ')}
                amount={line.cost}
                negative
              />
            ))}

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
