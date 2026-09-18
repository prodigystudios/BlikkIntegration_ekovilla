"use client";
import { useEffect, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import CallLogModal, { type CallLogDraft } from '@/app/crm/components/CallLogModal';
import { CALL_OUTCOME_ACCENT, CALL_OUTCOME_META, callAtToIso, type CrmCallOutcome } from '@/app/crm/lib/callDisplay';
import { formatDateTime } from '@/app/crm/lib/format';

// Samtalsloggen på en offert — ALLA samtal som loggats på den, även kollegornas, plus knappen som
// loggar ett nytt.
//
// Byggd som syskon till QuoteTasksCard och med samma grind: läsningen går genom en egen route
// (/api/crm/quotes/[id]/calls) som först läser OFFERTEN med sessionsklienten. Samtalen i sig läses
// elevated — crm_calls RLS är "eget samtal, egen tilldelad kund, eller admin", så utan det hade en
// kollegas offert visat ett tomt kort.
//
// ⚠️ Kortet visar samtal loggade FRÅN offerten, inte hela kundens historik. Kundkortet är kvar som
// platsen där man ser allt man ringt med kunden.

export type QuoteCall = {
  id: string;
  outcome: CrmCallOutcome;
  summary: string;
  next_step: string | null;
  call_at: string;
  user_id: string;
  /** Sätts bara av offertens läsrutt (profiles-RLS är self-only). */
  user_name: string | null;
};

export default function QuoteCallsCard({
  quoteId,
  quoteLabel,
  currentUserId,
  canWrite,
}: {
  quoteId: string;
  /** Vad samtalet loggas på, utskrivet i modalen innan man sparar. */
  quoteLabel: string;
  /** Avgör om raden ska säga "Du" eller kollegans namn. */
  currentUserId: string | null;
  /** crm.write. Läsroller ser loggen men får ingen knapp. */
  canWrite: boolean;
}) {
  const toast = useToast();

  const [calls, setCalls] = useState<QuoteCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);

    fetch(`/api/crm/quotes/${quoteId}/calls`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) { setLoadFailed(true); setCalls([]); return; }
        setCalls(Array.isArray(json.data?.items) ? json.data.items : []);
      })
      .catch(() => { if (!cancelled) { setLoadFailed(true); setCalls([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [quoteId]);

  async function saveCall(draft: CallLogDraft) {
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: draft.outcome,
          summary: draft.summary.trim(),
          next_step: draft.next_step.trim() || null,
          // Utelämnas när fältet är tomt — då sätter databasen tidpunkten till nu.
          ...(callAtToIso(draft.call_at) ? { call_at: callAtToIso(draft.call_at) } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Kunde inte logga samtalet');

      // Nyast först, samma ordning som servern ger. Raden kommer tillbaka med namn påsatt av
      // routen, så den behöver inte hämtas om.
      setCalls((current) => [json.data.item as QuoteCall, ...current]);
      setFormOpen(false);
      toast.success('Samtal loggat');
    } catch (e) {
      toast.error((e as Error)?.message || 'Kunde inte logga samtalet');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#e3e9df] bg-[#f9fbf7] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </span>
          <div className="grid min-w-0 gap-0.5">
            <span className="text-sm font-semibold text-slate-800">Samtal</span>
            <span className="text-xs leading-5 text-slate-500">
              {loading
                ? 'Hämtar…'
                : loadFailed
                  ? 'Kunde inte hämta samtalen.'
                  : calls.length === 0
                    ? 'Inga samtal loggade på offerten.'
                    : `${calls.length} ${calls.length === 1 ? 'samtal' : 'samtal'} loggade här.`}
            </span>
          </div>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-solid border-[#dce4d8] bg-white text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3]"
          >
            Logga samtal
          </button>
        ) : null}
      </div>

      {!loading && calls.length > 0 ? (
        <div className="mt-3 grid gap-1.5">
          {calls.map((call) => (
            <div key={call.id} className="relative overflow-hidden rounded-lg border border-solid border-[#e3e9df] bg-white py-2 pl-4 pr-3">
              <span className={cn('absolute inset-y-0 left-0 w-1.5', CALL_OUTCOME_ACCENT[call.outcome])} aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className={cn('rounded-md border border-solid px-1.5 py-0.5 font-semibold', CALL_OUTCOME_META[call.outcome].className)}>
                  {CALL_OUTCOME_META[call.outcome].label}
                </span>
                <span>{formatDateTime(call.call_at)}</span>
                <span>
                  ·{' '}
                  {currentUserId && call.user_id === currentUserId
                    ? 'Du'
                    // Namnet kan saknas om profilen inte har något satt — säg "en kollega" hellre
                    // än att rita en rå uuid.
                    : call.user_name || 'En kollega'}
                </span>
              </div>
              <p className="m-0 mt-1 whitespace-pre-wrap text-[13px] leading-5 text-slate-700">{call.summary}</p>
              {call.next_step ? (
                <p className="m-0 mt-1 text-xs text-slate-500">Nästa steg: {call.next_step}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {formOpen ? (
        <CallLogModal
          contextLabel={quoteLabel}
          saving={saving}
          onClose={() => setFormOpen(false)}
          onSubmit={saveCall}
        />
      ) : null}
    </div>
  );
}
