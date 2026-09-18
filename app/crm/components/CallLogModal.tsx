"use client";
import { useState } from 'react';
import CrmModal from '@/app/crm/components/CrmModal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { cn } from '@/lib/shared/cn';
import { CALL_OUTCOMES, CALL_OUTCOME_META, type CrmCallOutcome } from '@/app/crm/lib/callDisplay';

// Logga ett samtal på något som redan bestämmer VEM samtalet gällde — i dag offerten i
// QuoteCallsCard.
//
// ⚠️ MEDVETET INTE samma formulär som /crm/samtal. Den sidan väljer också kontakten: prospekt, företag,
// kontaktperson, telefon, e-post, ort — och kan redigera ett tidigare samtal. Här är identiteten
// redan given av offerten och härleds på SERVERN ur offertens snapshot (quoteCallIdentity), så
// fälten finns inte att fylla i. Att pressa in båda i en modal hade betytt en "låst" halva som
// aldrig visas härifrån, och en kontaktväljare som aldrig används därifrån.
//
// Det som däremot INTE får drifta är vokabulären — utfallen bor i app/crm/lib/callDisplay.ts och
// delas med samtalssidan.

export type CallLogDraft = {
  outcome: CrmCallOutcome;
  summary: string;
  next_step: string;
  /** 'YYYY-MM-DDTHH:mm' från <input type="datetime-local">, eller tomt = nu. */
  call_at: string;
};

export default function CallLogModal({
  contextLabel,
  saving,
  onClose,
  onSubmit,
}: {
  /** Vem samtalet loggas på, utskrivet så man ser det innan man sparar. */
  contextLabel: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: CallLogDraft) => void;
}) {
  const [outcome, setOutcome] = useState<CrmCallOutcome>('follow_up');
  const [summary, setSummary] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [callAt, setCallAt] = useState('');

  const canSave = summary.trim().length > 0 && !saving;

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Logga samtal"
      maxWidth="sm:max-w-[560px]"
      header={
        <div className="grid gap-1">
          <h2 className="m-0 text-base font-semibold text-slate-900">Logga samtal</h2>
          <p className="m-0 text-xs text-slate-500">{contextLabel}</p>
        </div>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-solid border-[#dce4d8] bg-white text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3]"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ outcome, summary, next_step: nextStep, call_at: callAt })}
            disabled={!canSave}
            className={cn(
              'px-3 py-2 rounded-lg text-sm font-semibold text-white transition',
              canSave ? 'bg-emerald-700 hover:bg-emerald-800' : 'cursor-not-allowed bg-slate-300',
            )}
          >
            {saving ? 'Sparar…' : 'Spara samtal'}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Utfall</span>
          <div className="flex flex-wrap gap-1.5">
            {CALL_OUTCOMES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setOutcome(value)}
                aria-pressed={outcome === value}
                className={cn(
                  'px-3 py-1.5 rounded-lg border border-solid text-sm font-semibold transition',
                  outcome === value
                    ? CALL_OUTCOME_META[value].className
                    : 'border-[#dce4d8] bg-white text-slate-600 hover:border-[#c8d4c3]',
                )}
              >
                {CALL_OUTCOME_META[value].label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">{CALL_OUTCOME_META[outcome].helper}</span>
        </div>

        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Sammanfattning</span>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            placeholder="Vad sa kunden?"
          />
          {/* Utan den här raden blir ett tomt fält ett tyst avstängt Spara. */}
          {summary.trim() === '' ? (
            <span className="text-xs text-slate-500">Skriv något om samtalet för att kunna spara.</span>
          ) : null}
        </label>

        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Nästa steg (valfritt)</span>
          <Input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Ex. Ringa upp på torsdag" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Tidpunkt</span>
          <Input type="datetime-local" value={callAt} onChange={(e) => setCallAt(e.target.value)} />
          <span className="text-xs text-slate-500">Lämna tomt för nu.</span>
        </label>
      </div>
    </CrmModal>
  );
}
