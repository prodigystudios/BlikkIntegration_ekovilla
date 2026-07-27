"use client";

import { cn } from '@/lib/shared/cn';

// Progress overlay for the document e-mail flow.
//
// Preparing the draft means a Fortnox round-trip for the PDF, which can take a couple of
// seconds. Without feedback the page just looked frozen, so the wait is shown as what it
// actually is: an ordered three-step sequence, each step with a real state. The numbered
// look is earned here — this IS a sequence, not a decorated list.
//
// It also blocks the surface deliberately: a second click would start a second download.

export type DocumentEmailPhase = 'contact' | 'pdf' | 'mail';

const PHASE_LABELS: Record<DocumentEmailPhase, { label: string; helper: string }> = {
  contact: { label: 'Hämtar kontaktuppgifter', helper: 'Läser kundens adresser.' },
  pdf: { label: 'Laddar ner PDF', helper: 'Hämtar dokumentet från Fortnox – bifoga det i mejlet.' },
  mail: { label: 'Öppnar ditt mejlprogram', helper: 'Utkastet är förifyllt med mottagare och text.' },
};

export default function DocumentEmailProgress({
  steps,
  phase,
}: {
  /** The steps this run will actually go through, in order. */
  steps: DocumentEmailPhase[];
  /** The step running right now. */
  phase: DocumentEmailPhase;
}) {
  const currentIndex = steps.indexOf(phase);

  return (
    <div
      role="status"
      aria-live="polite"
      className="crm-overlay-in fixed inset-0 z-[2900] flex items-end justify-center bg-slate-950/40 [backdrop-filter:blur(3px)] sm:items-center sm:p-4"
    >
      <div className="crm-sheet-in w-full rounded-t-2xl border border-solid border-[#e0e8dc] bg-[#f9fbf7] p-5 shadow-[0_-12px_50px_rgba(15,23,42,0.28)] sm:max-w-[380px] sm:rounded-2xl sm:shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
        <p className="m-0 mb-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Förbereder mejl
        </p>

        <ol className="m-0 grid list-none gap-0 p-0">
          {steps.map((step, index) => {
            const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
            const isLast = index === steps.length - 1;

            return (
              <li key={step} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
                {/* Marker + connector — the connector is what makes the order readable. Flex,
                    not grid, so the connector's flex-1 fills the row height. */}
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full border-2 border-solid transition-colors',
                      state === 'done' && 'border-transparent bg-emerald-600',
                      state === 'active' && 'animate-spin border-[#cfdcc9] motion-reduce:animate-none',
                      state === 'pending' && 'border-[#dce4d8]',
                    )}
                    style={state === 'active' ? { borderTopColor: 'var(--crm-primary)' } : undefined}
                  >
                    {state === 'done' ? (
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                        <path d="M3.5 8.5l3 3 6-7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </span>
                  {!isLast ? (
                    <span
                      aria-hidden
                      className={cn(
                        'my-1 w-0.5 flex-1 rounded-full transition-colors',
                        index < currentIndex ? 'bg-emerald-500' : 'bg-[#e0e8dc]',
                      )}
                    />
                  ) : null}
                </div>

                <div className={cn('grid gap-0.5', isLast ? 'pb-0' : 'pb-4')}>
                  <span
                    className={cn(
                      'text-sm font-semibold transition-colors',
                      state === 'pending' ? 'text-slate-400' : 'text-slate-900',
                    )}
                  >
                    {PHASE_LABELS[step].label}
                  </span>
                  {state === 'active' ? (
                    <span className="text-[11px] leading-snug text-slate-500">{PHASE_LABELS[step].helper}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
