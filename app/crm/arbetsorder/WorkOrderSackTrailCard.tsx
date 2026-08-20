"use client";

import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate, formatSacks } from '@/app/crm/lib/format';
import { constructionLabel } from '@/lib/domains/crm/constructions';
import { totalReportedSacks, UNSPECIFIED_CONSTRUCTION_LABEL } from '@/lib/domains/planning/sackLedger';
import type { SackReportView } from '@/lib/domains/planning/reports';

// Spåret på arbetsordern — vem rapporterade vad, när.
//
// Snabböversiktens ruta säger HUR MÅNGA. Det här kortet säger var talet kommer ifrån. Huvudboken är
// append-only, så ingenting försvinner ur den; kortet är hela historiken i tidsordning.
//
// ── KRONOLOGISKT, INTE GRUPPERAT ─────────────────────────────────────────────
// Medvetet en annan läsning än fältvyns kort, som grupperar per placering. Fältet frågar "hur långt
// har vi kommit på vinden" mitt i ett jobb; kontoret frågar "vad hände på det här jobbet, och
// varför står det 91 när raderna ser ut att bli 146". Det är en fråga om ORDNING, inte om plats.
//
// ⚠️ DE ERSATTA RADERNA MÅSTE SYNAS SOM ERSATTA. Efter en egenkontroll ligger delrapporterna kvar.
// Listas de rakt av räknar kontoret 30 + 25 + 91 = 146 och tror att talen inte går ihop. Rubrikens
// total plus de överstrukna raderna är tillsammans förklaringen — det är precis samma felklass som
// "Ej rapporterat" kontra "0 st", och den löses på samma sätt: skriv ut skillnaden i stället för att
// låta läsaren gissa.

export default function WorkOrderSackTrailCard({
  reports,
  loading,
  loadError,
}: {
  reports: SackReportView[];
  loading: boolean;
  /** Hämtningen misslyckades — säg det, i stället för att påstå att boken är tom. */
  loadError: boolean;
}) {
  const total = totalReportedSacks(reports);

  return (
    <div className={cn(crm.cardInner, 'grid gap-3')}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={crm.sectionTitle}>Säckrapporter</p>
        {!loading && reports.length > 0 ? (
          <p className="m-0 text-sm font-semibold text-slate-900">
            {formatSacks(total)} <span className="text-xs font-medium text-slate-500">säckar totalt</span>
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="m-0 text-sm text-slate-400">Hämtar…</p>
      ) : loadError ? (
        <p className="m-0 text-sm text-amber-700">Kunde inte hämta säckrapporterna. Ladda om sidan.</p>
      ) : reports.length === 0 ? (
        // "Ingen har rapporterat", inte "noll säckar". Skillnaden är densamma som i
        // snabböversiktens ruta: det ena är ett påstående om jobbet, det andra om rapporteringen.
        <p className={crm.emptyValue}>Ingen har rapporterat säckar på det här jobbet än.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {reports.map((item) => {
            const placement = constructionLabel(item.construction) || UNSPECIFIED_CONSTRUCTION_LABEL;
            const meta = [placement, item.material].filter(Boolean).join(' · ');
            return (
              <li
                key={item.id}
                className={cn(
                  'grid gap-0.5 border-l-2 border-solid pl-2.5',
                  item.superseded ? 'border-[#e0e8dc]' : 'border-[#c3d4bc]',
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className={cn('text-xs', item.superseded ? 'text-slate-400' : 'text-slate-500')}>
                    {formatDate(item.report_day)} · {item.created_by_name}
                  </span>
                  <span
                    className={cn(
                      'text-sm font-semibold tabular-nums',
                      item.superseded ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-900',
                    )}
                  >
                    {formatSacks(item.sacks_blown)} st
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn('text-sm', item.superseded ? 'text-slate-400' : 'text-slate-700')}>{meta}</span>
                  {item.kind === 'final' ? (
                    <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>Egenkontroll</span>
                  ) : null}
                  {item.superseded ? (
                    <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-500')}>Ersatt</span>
                  ) : null}
                </div>
                {item.note ? (
                  <p className={cn('m-0 text-xs leading-relaxed', item.superseded ? 'text-slate-400' : 'text-slate-600')}>
                    {item.note}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {reports.some((item) => item.superseded) ? (
        // Regeln i en mening, på det ställe där någon annars börjar addera för hand.
        <p className="m-0 rounded-xl bg-[#eef3ec] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          Egenkontrollen är jobbets slutsumma. Delrapporter som lämnats innan den räknas inte med i
          totalen — de står kvar som historik.
        </p>
      ) : null}
    </div>
  );
}
