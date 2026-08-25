"use client";

import { useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate, formatSacks } from '@/app/crm/lib/format';
import { constructionLabel } from '@/lib/domains/crm/constructions';
import { totalReportedSacks, UNSPECIFIED_CONSTRUCTION_LABEL } from '@/lib/domains/planning/sackLedger';
import type { SackReportView } from '@/lib/domains/planning/reports';

// Spåret på arbetsordern — vem rapporterade vad, när.
//
// Snabböversiktens ruta säger HUR MÅNGA. Det här kortet säger var talet kommer ifrån: hela
// historiken i tidsordning. Ingenting skrivs om — en rad står som den skrevs — men en
// felrapporterad delrapport kan tas bort, se BORTTAGNINGEN nedan.
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
//
// ── BORTTAGNINGEN ────────────────────────────────────────────────────────────
// Kortet är inte längre bara en läsvy: en dubbelrapporterad dag går att ta bort härifrån. Det är
// den enda rättning som finns, för en ny rad kan bara addera (kolumnen har `check (sacks_blown >=
// 0)`), och innan knappen fanns var manuell radering i Supabase enda vägen.
//
// ⚠️ VILKA rader som får tas bort avgörs av `can_delete` FRÅN SERVERN, aldrig av en koll här. Se
// SackReportView.can_delete — regeln bor i RLS, och en andra kopia i klienten hade ritat knappar
// som svarar 403. Egenkontrollens rader bär den aldrig.

export default function WorkOrderSackTrailCard({
  reports,
  loading,
  loadError,
  isRemoving,
  onDelete,
}: {
  reports: SackReportView[];
  loading: boolean;
  /** Hämtningen misslyckades — säg det, i stället för att påstå att boken är tom. */
  loadError: boolean;
  /** Per rad, inte en delad flagga: två borttagningar i rad får inte låsa upp varandras knappar. */
  isRemoving: (id: string) => boolean;
  onDelete: (id: string) => void;
}) {
  const total = totalReportedSacks(reports);
  // Bekräftelsen är inline och per rad, inte en modal. Samma mönster som kommentarerna och
  // filerna på ordern: frågan ställs där raden står, så man ser VILKEN rad man tar bort medan man
  // svarar på frågan.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className={cn(crm.cardInner, 'grid gap-3')}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={crm.cardTitle}>Säckrapporter</p>
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
        // …och säg VAR rapporten görs. Kortet är en läsvy; den som står här och undrar varför den
        // är tom ska inte behöva leta efter skrivstället.
        <p className={crm.emptyValue}>
          Ingen har rapporterat säckar på det här jobbet än. Delrapporter kommer från
          installatörens vy, slutsumman från egenkontrollen.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {reports.map((item) => {
            const placement = constructionLabel(item.construction) || UNSPECIFIED_CONSTRUCTION_LABEL;
            const meta = [placement, item.material].filter(Boolean).join(' · ');
            return (
              <li
                key={item.id}
                className={cn(
                  'grid gap-0.5 border-l-2 pl-2.5',
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
                  {item.can_delete ? (
                    <span className="ml-auto flex items-center gap-2 text-xs">
                      {confirmId === item.id ? (
                        <>
                          <span className="text-slate-500">Ta bort?</span>
                          <button
                            type="button"
                            onClick={() => onDelete(item.id)}
                            disabled={isRemoving(item.id)}
                            className="font-semibold text-rose-600 transition hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isRemoving(item.id) ? 'Tar bort…' : 'Ja'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            disabled={isRemoving(item.id)}
                            className="text-slate-400 transition hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Nej
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmId(item.id)}
                          className="font-medium text-slate-400 transition hover:text-rose-500"
                        >
                          Ta bort
                        </button>
                      )}
                    </span>
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
