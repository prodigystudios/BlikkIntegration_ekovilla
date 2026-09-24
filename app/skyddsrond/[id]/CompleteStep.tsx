"use client";

import { useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDateTime } from '@/app/crm/lib/format';
import { openFortnoxPdf } from '@/app/crm/lib/fortnoxDoc';
import type { CompletionProblem, SafetyRoundSummary } from '@/lib/domains/safetyRounds/completion';
import type { SafetyRound } from '@/lib/domains/safetyRounds/types';
import { ITEM_STATUS_RAIL } from '../_components/safetyUi';

// Steg 5 — Slutför: mallens summering, det som återstår, och knappen som låser ronden.
//
// Listan över det som återstår är SAMMA som slutför-rutten nekar med (completion.ts), så knappen och
// servern säger aldrig olika saker. Varje rad tar en till steget där felet rättas.

export type StepKey = 'info' | 'participants' | 'checklist' | 'actions' | 'complete';

type Props = {
  round: SafetyRound;
  summary: SafetyRoundSummary;
  problems: CompletionProblem[];
  canWrite: boolean;
  completing: boolean;
  pdfUrl: string;
  onComplete: () => Promise<boolean>;
  onGoTo: (step: StepKey) => void;
};

export default function CompleteStep({ round, summary, problems, canWrite, completing, pdfUrl, onComplete, onGoTo }: Props) {
  const [confirming, setConfirming] = useState(false);
  const completed = round.status === 'completed';

  const rows: Array<{ label: string; value: number; rail?: string }> = [
    { label: 'OK', value: summary.ok, rail: ITEM_STATUS_RAIL.ok },
    { label: 'Delvis', value: summary.partial, rail: ITEM_STATUS_RAIL.partial },
    { label: 'Brist', value: summary.defect, rail: ITEM_STATUS_RAIL.defect },
    { label: 'Ej relevant', value: summary.na, rail: ITEM_STATUS_RAIL.na },
    { label: 'Hög + Allvarlig', value: summary.highOrSevere },
    { label: 'Till handlingsplan', value: summary.toActionPlan },
  ];

  return (
    <div className="grid gap-4">
      <section className={cn(crm.cardInner, 'grid gap-3 p-4')} aria-labelledby="summary-title">
        <h2 id="summary-title" className={cn('m-0', crm.cardTitle)}>
          Summering
        </h2>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 border-0 border-b border-solid border-[#e8eee4] pb-2">
              <dt className={cn('flex items-center gap-2', crm.meta)}>
                {row.rail ? <span aria-hidden className={cn('h-3 w-1 rounded-full', row.rail)} /> : null}
                {row.label}
              </dt>
              <dd className="m-0 text-base font-bold tabular-nums text-slate-900">{row.value}</dd>
            </div>
          ))}
        </dl>
        {summary.unassessed > 0 ? (
          <p className={cn('m-0', crm.meta)}>{summary.unassessed === 1 ? 'En punkt' : `${summary.unassessed} punkter`} är inte bedömda ännu.</p>
        ) : null}
      </section>

      {completed ? (
        <section className="grid gap-3 rounded-2xl border border-solid border-emerald-200 bg-emerald-50 p-4">
          <p className="m-0 text-sm font-semibold text-emerald-900">Ronden slutfördes {formatDateTime(round.completed_at)}.</p>
          <p className="m-0 text-sm leading-relaxed text-emerald-900">
            Rondinfo, deltagare och checklista är låsta. Uppföljningen av åtgärderna förs in under Handlingsplan.
          </p>
        </section>
      ) : problems.length > 0 ? (
        <section className="grid gap-3 rounded-2xl border border-solid border-amber-200 bg-amber-50 p-4" aria-labelledby="problems-title">
          <h2 id="problems-title" className="m-0 text-sm font-bold text-amber-950">
            Kvar innan ronden kan slutföras
          </h2>
          <ul className="m-0 grid list-none gap-1 p-0">
            {problems.map((problem, index) => (
              <li key={`${problem.step}-${index}`}>
                <button
                  type="button"
                  onClick={() => onGoTo(problem.step)}
                  // Understruken: raderna är vägar till felet, och på en telefon finns ingen hovring som
                  // avslöjar det.
                  className="min-h-11 w-full justify-start rounded-lg p-0 px-2 text-left text-sm text-amber-950 underline decoration-amber-400 underline-offset-2 hover:bg-amber-100"
                >
                  {problem.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
        {!completed && canWrite ? (
          confirming ? (
            <>
              <p className={cn('m-0 sm:basis-full', crm.meta)}>
                Rondinfo, deltagare och checklista låses. Handlingsplanen kan fortfarande följas upp.
              </p>
              <button
                type="button"
                onClick={async () => {
                  if (await onComplete()) setConfirming(false);
                }}
                disabled={completing}
                className={cn(crm.saveButton, 'min-h-11 sm:w-auto sm:px-5')}
              >
                {completing ? 'Slutför…' : 'Slutför och lås ronden'}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={cn(crm.ghostButton, 'min-h-11')}>
                Avbryt
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={problems.length > 0}
              className={cn(crm.saveButton, 'min-h-11 sm:w-auto sm:px-5')}
            >
              Slutför ronden
            </button>
          )
        ) : null}
        <button type="button" onClick={() => openFortnoxPdf(pdfUrl)} className={cn(crm.ghostButton, 'min-h-11')}>
          {completed ? 'Öppna protokollet (PDF)' : 'Förhandsgranska protokollet (PDF)'}
        </button>
      </div>
    </div>
  );
}
