"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate } from '@/app/crm/lib/format';
import { completionProblems, summarizeItems } from '@/lib/domains/safetyRounds/completion';
import { stepCounts } from '@/lib/domains/safetyRounds/form';
import { safetyRoundOrderRef } from '@/lib/domains/safetyRounds/types';
import { ROUND_STATUS_BADGE, ROUND_STATUS_LABEL } from '../_components/safetyUi';
import ActionsStep from './ActionsStep';
import ChecklistStep from './ChecklistStep';
import CompleteStep, { type StepKey } from './CompleteStep';
import ParticipantsStep from './ParticipantsStep';
import RoundInfoStep from './RoundInfoStep';
import { useSafetyRound } from './useSafetyRound';

// Skyddsronden — formuläret som fylls i på plats, i fem steg i mallens ordning: Rondinfo →
// Deltagare → Checklista → Handlingsplan → Slutför.
//
// Stegen är flikar, inte en tvingande guide: en rond går sällan rakt uppifrån och ned (man ser en
// brist, går tillbaka och lägger till en deltagare). Flikraden står kvar överst när man scrollar,
// och varje flik bär sitt tal — "Checklista 12/20" — så att det syns vad som återstår utan att man
// behöver öppna steget.
//
// Allt sparas medan man skriver (useSafetyRound); ingen spara-knapp finns, och raden i huvudet säger
// om en sparning är på väg.

const STEP_LABEL: Record<StepKey, string> = {
  info: 'Rondinfo',
  participants: 'Deltagare',
  checklist: 'Checklista',
  actions: 'Handlingsplan',
  complete: 'Slutför',
};
const STEPS: StepKey[] = ['info', 'participants', 'checklist', 'actions', 'complete'];

export default function SafetyRoundClient({ roundId }: { roundId: string }) {
  const router = useRouter();
  const controller = useSafetyRound(roundId);
  const { data, loading, loadError, saving, suggestions } = controller;
  const [step, setStep] = useState<StepKey>('info');
  const topRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const loaded = data !== null;

  // Den aktiva fliken ska synas i flikraden. På en telefon ryms inte alla fem, och "Visa
  // handlingsplanen" från checklistan byter till ett steg som ligger utanför bild — utan det här
  // stod man på Handlingsplan med Rondinfo markerad… eller ingenting alls markerat. Bara radens
  // egen sidledsscroll flyttas: scrollIntoView hade också rört <main> och avbrutit uppscrollningen.
  useEffect(() => {
    const nav = navRef.current;
    const tab = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !tab) return;
    const pad = 8;
    const left = tab.offsetLeft - pad;
    const right = tab.offsetLeft + tab.offsetWidth + pad;
    if (left < nav.scrollLeft) nav.scrollTo({ left });
    else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: right - nav.clientWidth });
  }, [step, loaded]);

  const derived = useMemo(() => {
    if (!data) return null;
    return {
      counts: stepCounts(data),
      summary: summarizeItems(data.items),
      problems: completionProblems(data),
    };
  }, [data]);

  if (loading) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <p className={cn('m-0', crm.pageSubtitle)} role="status">
          Hämtar skyddsronden…
        </p>
      </div>
    );
  }

  if (loadError || !data || !derived) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <div className="grid gap-3 rounded-2xl border border-solid border-rose-200 bg-rose-50 p-4">
          <p className="m-0 text-sm font-semibold text-rose-900">Kunde inte öppna skyddsronden</p>
          <p className="m-0 text-sm text-rose-900">{loadError || 'Okänt fel.'}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void controller.refresh()} className={cn(crm.ghostButton, 'min-h-11')}>
              Försök igen
            </button>
            <Link href="/skyddsrond" className={cn(crm.ghostButton, 'min-h-11 no-underline')}>
              Alla skyddsronder
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { round, participants, items, actions, canWrite, categories } = data;
  const completed = round.status === 'completed';
  const readOnly = completed || !canWrite;
  const orderRef = safetyRoundOrderRef(round);
  const pdfUrl = `/api/safety-rounds/${round.id}/pdf`;

  const counts: Record<StepKey, string | null> = {
    info: null,
    participants: String(derived.counts.participants),
    checklist: `${derived.counts.assessed}/${derived.counts.total}`,
    actions: String(derived.counts.actions),
    complete: null,
  };

  function goTo(next: StepKey) {
    setStep(next);
    // Upp till sidans topp, så att steget börjar i början. ⚠️ Det är appskalets <main> som scrollar
    // (AppShell: overflow-auto på 100dvh), inte fönstret — window.scrollTo hade inte gjort något.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    topRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }

  const nextStep = STEPS[STEPS.indexOf(step) + 1];

  return (
    // pb-16: appens flytande Rapportera-knapp står nere till höger och hade annars täckt den sista
    // knappen ("Nästa: …") på en telefon.
    <div ref={topRef} className="mx-auto grid w-full max-w-3xl scroll-mt-4 grid-cols-1 gap-4 pb-16">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? router.back() : router.push('/skyddsrond'))}
            className="inline-flex min-h-11 w-fit items-center gap-1.5 p-0 text-sm text-slate-600 hover:text-slate-900"
          >
            ← Tillbaka
          </button>
          {canWrite ? (
            <p className={cn('m-0', crm.meta)} role="status" aria-live="polite">
              {saving ? 'Sparar…' : 'Allt är sparat'}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(crm.badge, ROUND_STATUS_BADGE[round.status])}>{ROUND_STATUS_LABEL[round.status]}</span>
          <span className={crm.meta}>
            Skyddsrond {round.round_number}
            {orderRef ? `, order ${orderRef}` : ''}
          </span>
        </div>
        <h1 className={cn('m-0', crm.pageTitle)}>{round.project_name}</h1>
        <p className={cn('m-0', crm.pageSubtitle)}>
          {[round.client_name, formatDate(round.held_on)].filter(Boolean).join(', ')}
        </p>
      </header>

      {/* Flikraden står kvar överst: checklistan är lång, och steget byts ofta mitt i den. */}
      {/* Sidledsscrollen följer startsidans snabblänkar (components/dashboard/QuickLinks.tsx):
          tunn list, snäpp och tröghetsscroll på iOS. */}
      <nav
        ref={navRef}
        aria-label="Rondens steg"
        className="sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-[#e5ede5]/95 px-1 py-2 backdrop-blur [scroll-snap-type:x_proximity] [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]"
      >
        {STEPS.map((key) => {
          const active = key === step;
          const label = key === 'complete' && completed ? 'Protokoll' : STEP_LABEL[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => goTo(key)}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'min-h-11 shrink-0 snap-start rounded-full border border-solid p-0 px-4 text-sm font-semibold transition',
                active
                  ? 'border-[color:var(--ek-green)] bg-[color:var(--ek-green)] text-white'
                  : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600 hover:text-slate-900',
              )}
            >
              {label}
              {counts[key] ? <span className={cn('ml-1.5 tabular-nums', active ? 'text-white/80' : 'text-slate-500')}>{counts[key]}</span> : null}
            </button>
          );
        })}
      </nav>

      {completed && step !== 'complete' ? (
        <p className="m-0 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Ronden är slutförd och låst.{step === 'actions' && canWrite ? ' Uppföljningen av åtgärderna går fortfarande att föra in.' : ''}
        </p>
      ) : null}

      {step === 'info' ? (
        <RoundInfoStep
          round={round}
          readOnly={readOnly}
          canDelete={canWrite && !completed}
          deleting={controller.deleting}
          directory={suggestions.directory}
          onPatch={(patch) => void controller.patchRound(patch)}
          onDelete={async () => {
            if (await controller.deleteRound()) router.replace('/skyddsrond');
          }}
        />
      ) : step === 'participants' ? (
        <ParticipantsStep
          participants={participants}
          readOnly={readOnly}
          directory={suggestions.directory}
          crew={suggestions.crew}
          onAdd={controller.addParticipant}
          onPatch={(id, patch) => void controller.patchParticipant(id, patch)}
          onRemove={(id) => void controller.removeParticipant(id)}
        />
      ) : step === 'checklist' ? (
        <ChecklistStep
          items={items}
          actions={actions}
          categories={categories}
          readOnly={readOnly}
          onPatchItem={(id, patch) => void controller.patchItem(id, patch)}
          onAddCustomItem={controller.addCustomItem}
          onRemoveCustomItem={(id) => void controller.removeCustomItem(id)}
          onAddAction={controller.addAction}
          onGoToActions={() => goTo('actions')}
        />
      ) : step === 'actions' ? (
        <ActionsStep
          actions={actions}
          items={items}
          lockedCore={readOnly}
          canFollowUp={canWrite}
          directory={suggestions.directory}
          onAdd={controller.addAction}
          onPatch={(id, patch) => void controller.patchAction(id, patch)}
          onRemove={(id) => void controller.removeAction(id)}
        />
      ) : (
        <CompleteStep
          round={round}
          summary={derived.summary}
          problems={derived.problems}
          canWrite={canWrite}
          completing={controller.completing}
          pdfUrl={pdfUrl}
          onComplete={controller.complete}
          onGoTo={goTo}
        />
      )}

      {nextStep ? (
        <button type="button" onClick={() => goTo(nextStep)} className={cn(crm.ghostButton, 'min-h-11 w-full')}>
          Nästa: {nextStep === 'complete' && completed ? 'Protokoll' : STEP_LABEL[nextStep]}
        </button>
      ) : null}
    </div>
  );
}
