"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { egenkontrollArchiveHref } from '@/lib/domains/crm/egenkontrollLink';
import {
  PORTAL_JOB_DOCUMENT_KINDS,
  PORTAL_JOB_DOCUMENT_LABELS,
  type PortalJobDocumentKind,
  type PortalJobDocumentsView,
  type PortalJobDocumentView,
} from '@/lib/domains/portal/jobDocuments';
import { portalWhenInSentence } from './portalWhen';

// Dokumenten till butiken, längst ned i kortet "Butiken" (RESELLER_PORTAL_CRM_PLAN.md fas 7, William 2026-09-28): per
// sort den senaste versionen, vem som skickade den och om den kom fram, "Öppna" på exakt den PDF butiken fick, och
// knapparna för den som får skicka (den som har ordern, eller en admin; servern avgör med svarsregeln).
//
// Orderbekräftelsen skickas av sig själv när butiken fått bekräftelsen på jobbet; knappen skickar en ny när ordern
// ändrats. Egenkontrollen skickas bara med knappen, och kortet visar vilken fil det gäller innan man trycker. Ett
// avbrutet jobb får inga dokument.
//
// Varje tryck har ett id redan innan det skickas, så att ett dubbelklick eller ett omförsök blir samma dokument.

type Props = {
  workOrderId: string;
  /** Vyns läsläge (ekonomins läsvy). Servern avgör ändå vem som får skicka. */
  canEdit: boolean;
};

/** Dokumenten ändras sällan: den automatiska orderbekräftelsen kommer inom ett cron-varv. */
const REFRESH_MS = 60_000;
const REFRESH_MIN_GAP_MS = 2_000;
/** Dokumentet skickas direkt efter svaret; läs om strax efter, så att "Skickas …" byts mot utfallet. */
const AFTER_SEND_RELOADS_MS = [4_000, 12_000];

const SEND_LABEL: Record<PortalJobDocumentKind, { first: string; again: string; done: string }> = {
  order_confirmation: {
    first: 'Skicka orderbekräftelsen',
    again: 'Skicka en ny orderbekräftelse',
    done: 'Orderbekräftelsen skickas till butiken.',
  },
  self_inspection: {
    first: 'Skicka egenkontrollen',
    again: 'Skicka egenkontrollen igen',
    done: 'Egenkontrollen skickas till butiken.',
  },
};

type Tone = 'idle' | 'progress' | 'done' | 'problem';

/** Arket till vänster: tomt när inget har skickats, grönt när butiken har det, rött när det inte kom fram. */
function Sheet({ tone }: { tone: Tone }) {
  const fill = tone === 'done' ? 'var(--ek-green)' : tone === 'problem' ? '#be123c' : '#ffffff';
  const stroke = tone === 'done' ? 'var(--ek-green)' : tone === 'problem' ? '#be123c' : '#9fb39a';
  const lines = tone === 'done' || tone === 'problem' ? '#ffffff' : '#c5d3c1';
  return (
    <svg aria-hidden="true" viewBox="0 0 24 30" className="h-[30px] w-6 shrink-0">
      <path d="M1.5 1.5h14l7 7v20h-21z" fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M15.5 1.5v7h7" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M5.5 14h13M5.5 18h13M5.5 22h8" stroke={lines} strokeWidth="1.5" strokeLinecap="round" />
      {tone === 'progress' ? <circle cx="18" cy="24" r="3" fill="#f59e0b" /> : null}
    </svg>
  );
}

function toneOf(doc: PortalJobDocumentView | null): Tone {
  if (!doc) return 'idle';
  if (doc.status === 'failed' || doc.delivery === 'failed') return 'problem';
  if (doc.status === 'building' || doc.delivery === 'sending') return 'progress';
  if (doc.delivery === 'sent') return 'done';
  return 'idle';
}

/** Vad som hänt med den senaste versionen, som en mening. `mayAct`: den som tittar kan skicka en ny. */
function stateLine(doc: PortalJobDocumentView, now: Date, mayAct: boolean): { text: string; problem: boolean } {
  const at = portalWhenInSentence(doc.createdAt, now);
  const by = doc.createdByName ? `av ${doc.createdByName}` : 'automatiskt';
  if (doc.status === 'building') return { text: 'Skapas …', problem: false };
  if (doc.status === 'failed') return { text: `Gick inte att skicka ${at}. ${doc.error ?? ''}`.trim(), problem: true };
  switch (doc.delivery) {
    case 'sent':
      return { text: `Skickad ${by} ${at}.`, problem: false };
    case 'failed':
      // En ny med knappen köas alltid på nytt; portalsidans "Skicka om" kan nekas när jobbet har senare händelser.
      return {
        text: mayAct ? 'Kom inte fram till butiken. Skicka en ny.' : 'Kom inte fram till butiken. Den som har ordern kan skicka en ny.',
        problem: true,
      };
    case 'replaced':
      return { text: 'Ersattes av en nyare innan den hann skickas.', problem: false };
    default:
      return { text: `Skickas till butiken … (${by} ${at})`, problem: false };
  }
}

export default function WorkOrderPortalDocuments({ workOrderId, canEdit }: Props) {
  const toast = useToast();
  const [view, setView] = useState<PortalJobDocumentsView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState<PortalJobDocumentKind | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Ett id per sort, skapat vid första trycket och kvar tills svaret kommit: ett omförsök efter ett nätfel blir samma.
  const pendingIds = useRef<Partial<Record<PortalJobDocumentKind, string>>>({});
  const loadSeq = useRef(0);
  const lastLoadAt = useRef(0);
  const followUps = useRef<number[]>([]);

  const load = useCallback(async (): Promise<PortalJobDocumentsView | null> => {
    const seq = ++loadSeq.current;
    lastLoadAt.current = Date.now();
    try {
      const res = await fetch(`/api/crm/portal/jobs/${workOrderId}/documents`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Dokumenten kunde inte hämtas.');
      if (seq !== loadSeq.current) return null;
      const next = json.data as PortalJobDocumentsView;
      setView(next);
      setLoadError(false);
      setNow(new Date());
      return next;
    } catch {
      if (seq === loadSeq.current) setLoadError(true);
      return null;
    }
  }, [workOrderId]);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastLoadAt.current < REFRESH_MIN_GAP_MS) return;
      void load();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      followUps.current.forEach((t) => window.clearTimeout(t));
    };
  }, [load]);

  async function send(kind: PortalJobDocumentKind) {
    if (sending || !view) return;
    const sourcePath = kind === 'self_inspection' ? view.selfInspection?.path ?? null : null;
    if (kind === 'self_inspection' && !sourcePath) return;
    setSending(kind);
    const documentId = (pendingIds.current[kind] ??= crypto.randomUUID());
    try {
      const res = await fetch(`/api/crm/portal/jobs/${workOrderId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, kind, sourcePath }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        // Servern har svarat: id:t är förbrukat (ett misslyckat dokument står kvar med det) eller aldrig använt.
        if (res.status < 500) delete pendingIds.current[kind];
        toast.error(json?.error || 'Dokumentet kunde inte skickas. Försök igen.');
        void load();
        return;
      }
      delete pendingIds.current[kind];
      const document = json.data.document as PortalJobDocumentView;
      loadSeq.current += 1;
      setView((current) => (current ? { ...current, latest: { ...current.latest, [kind]: document } } : current));
      setNow(new Date());
      if (json.data.created) toast.success(SEND_LABEL[kind].done);
      let told = document.delivery === 'failed';
      if (told) toast.error(`${PORTAL_JOB_DOCUMENT_LABELS[kind]} kom inte fram till butiken.`);
      for (const ms of AFTER_SEND_RELOADS_MS) {
        const timer = window.setTimeout(async () => {
          followUps.current = followUps.current.filter((t) => t !== timer);
          const next = await load();
          const latest = next?.latest[kind];
          if (!told && latest?.id === document.id && latest.delivery === 'failed') {
            told = true;
            toast.error(`${PORTAL_JOB_DOCUMENT_LABELS[kind]} kom inte fram till butiken.`);
          }
        }, ms);
        followUps.current.push(timer);
      }
    } catch {
      // Id:t står kvar: trycker man igen blir det samma dokument, inte två.
      toast.error('Dokumentet kunde inte skickas. Försök igen.');
    } finally {
      setSending(null);
    }
  }

  const headingId = `portal-documents-${workOrderId}`;
  const mayAct = canEdit && Boolean(view?.canSend) && !view?.blocked;

  return (
    <section aria-labelledby={headingId} className="grid gap-2 border-t border-[#e0e8dc] pt-3">
      <h3 id={headingId} className={cn(crm.groupTitle, 'm-0')}>
        Dokument till butiken
      </h3>

      {!view && !loadError ? <p className="m-0 text-sm text-slate-500">Hämtar dokumenten …</p> : null}
      {loadError && !view ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800">
          <span>Dokumenten kunde inte hämtas.</span>
          <button type="button" onClick={() => void load()} className={crm.ghostButton}>
            Försök igen
          </button>
        </div>
      ) : null}

      {view ? (
        <>
          {view.blocked === 'cancelled' ? (
            <p className={cn(crm.micro, 'm-0')}>Jobbet är avbrutet. Butiken får inga fler dokument.</p>
          ) : null}
          <ul className="m-0 grid list-none gap-2 p-0">
            {PORTAL_JOB_DOCUMENT_KINDS.map((kind) => (
              <DocumentRow
                key={kind}
                kind={kind}
                doc={view.latest[kind]}
                view={view}
                now={now}
                workOrderId={workOrderId}
                mayAct={mayAct}
                sending={sending}
                onSend={() => void send(kind)}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function DocumentRow({
  kind,
  doc,
  view,
  now,
  workOrderId,
  mayAct,
  sending,
  onSend,
}: {
  kind: PortalJobDocumentKind;
  doc: PortalJobDocumentView | null;
  view: PortalJobDocumentsView;
  now: Date;
  workOrderId: string;
  mayAct: boolean;
  sending: PortalJobDocumentKind | null;
  onSend: () => void;
}) {
  const label = PORTAL_JOB_DOCUMENT_LABELS[kind];
  const state = doc ? stateLine(doc, now, mayAct) : null;
  const candidate = kind === 'self_inspection' ? view.selfInspection : null;

  // Vad som står när inget har skickats.
  let empty: string | null = null;
  if (!doc) {
    if (view.blocked === 'cancelled') empty = 'Skickades inte.';
    else if (kind === 'order_confirmation') {
      empty =
        view.blocked === 'not_confirmed'
          ? 'Skickas av sig själv när butiken har fått bekräftelsen på jobbet.'
          : 'Inte skickad än.';
    } else if (view.blocked === 'not_confirmed') empty = 'Kan skickas när butiken har fått bekräftelsen på jobbet.';
    else if (mayAct && !candidate) empty = 'Ingen egenkontroll på ordern än. Den kommer när montörerna lämnat in den.';
    else empty = 'Inte skickad.';
  }

  const canSendThis =
    mayAct &&
    (kind === 'order_confirmation' ? true : Boolean(candidate?.belongsToOrder)) &&
    doc?.status !== 'building';
  const buttonText = sending === kind ? 'Skickar …' : doc?.status === 'ready' ? SEND_LABEL[kind].again : SEND_LABEL[kind].first;

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border border-[#e0e8dc] bg-white px-3 py-2.5">
      <Sheet tone={toneOf(doc)} />
      <div className="grid min-w-0 gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[13px] font-semibold text-slate-900">{label}</span>
          {doc?.status === 'ready' && doc.name ? (
            <a
              href={`/api/crm/portal/jobs/${workOrderId}/documents/${doc.id}`}
              target="_blank"
              rel="noopener"
              className={cn(crm.link, 'text-xs')}
            >
              Öppna
            </a>
          ) : null}
        </div>
        {doc?.name ? <p className="m-0 text-xs text-slate-600 [overflow-wrap:anywhere]">{doc.name}</p> : null}
        {state ? (
          <p className={cn('m-0 text-xs leading-relaxed', state.problem ? 'font-medium text-rose-700' : 'text-slate-500')}>
            {state.text}
          </p>
        ) : (
          <p className="m-0 text-xs leading-relaxed text-slate-500">{empty}</p>
        )}
        {candidate ? (
          <p className="m-0 text-xs leading-relaxed text-slate-600">
            {candidate.belongsToOrder ? 'Senaste egenkontrollen' : 'Egenkontrollen i kommentarerna gäller en annan order'}
            {candidate.commentedAt ? `, inlämnad ${portalWhenInSentence(candidate.commentedAt, now)}` : ''}:{' '}
            <a href={egenkontrollArchiveHref(candidate.path)} target="_blank" rel="noopener" className={cn(crm.link, '[overflow-wrap:anywhere]')}>
              {candidate.fileName}
            </a>
          </p>
        ) : null}
      </div>
      {canSendThis ? (
        <div className="col-start-2">
          <button
            type="button"
            onClick={onSend}
            disabled={sending !== null}
            className={cn(doc?.status === 'ready' ? crm.ghostButton : crm.saveButton, 'h-8 w-auto px-3 text-xs')}
          >
            {buttonText}
          </button>
        </div>
      ) : null}
    </li>
  );
}
