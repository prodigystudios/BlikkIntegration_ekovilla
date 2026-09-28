"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import {
  DEFAULT_PORTAL_JOB_MESSAGE_DEPARTMENT,
  PORTAL_JOB_MESSAGE_DEPARTMENTS,
  PORTAL_JOB_MESSAGE_MAX_CHARS,
  countChars,
  portalJobMessageByline,
  type PortalJobMessageDepartment,
  type PortalJobMessagesView,
  type PortalJobMessageView,
} from '@/lib/domains/portal/jobMessages';

// Kortet "Butiken": samtalet med återförsäljaren om jobbet (RESELLER_PORTAL_CRM_PLAN.md fas 6). Överst i sidokolumnen
// (William 2026-09-28), långt från de interna kommentarerna längst ned på sidan.
//
// ⚠️ ALLT som skrivs här går till butiken. Därför namnger fältet butiken och knappen säger vart texten tar vägen, och
// ytan är tvåsidig (butiken till vänster, vi till höger) i stället för kommentarernas enfärgade lista. Interna
// anteckningar hör hemma i Projektkommentarer.
//
// Tråden läses av alla som ser ordern; svarsfältet visas bara när servern säger `canReply` (den som har ordern, eller
// en admin) och vyn inte är skrivskyddad (ekonomins läsvy). Ett skickat svar går inte att ändra: portalen sparar det en
// gång per id. Svaret har ett id redan medan det skrivs, så att ett dubbelklick eller ett omförsök blir samma svar.

type Props = {
  workOrderId: string;
  storeName: string;
  /** Vyns läsläge (ekonomins läsvy). Servern avgör ändå vem som får svara. */
  canEdit: boolean;
};

/** Hur ofta tråden läses om medan fliken syns: butikens svar kan komma medan sidan står öppen. */
const REFRESH_MS = 60_000;
/** Fokus och synlighet kommer ofta i samma ögonblick; en läsning räcker. */
const REFRESH_MIN_GAP_MS = 2_000;
/** Svaret skickas direkt efter att det sparats; läs om strax efter, så att "Skickas …" byts mot utfallet. */
const AFTER_SEND_RELOADS_MS = [3_000, 10_000];
/** Räknaren visas först när det börjar bli trångt. */
const COUNTER_FROM = PORTAL_JOB_MESSAGE_MAX_CHARS - 500;

const stockholmDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' });
const stockholmTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
const stockholmDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short' });
const stockholmDateYear = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short', year: 'numeric' });

/** "08:14" i dag, "12 okt. 08:14" i år, annars med året. Svensk tid, som resten av CRM:et. */
function when(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = stockholmTime.format(at);
  if (stockholmDay.format(at) === stockholmDay.format(now)) return time;
  const sameYear = stockholmDay.format(at).slice(0, 4) === stockholmDay.format(now).slice(0, 4);
  return `${(sameYear ? stockholmDate : stockholmDateYear).format(at)} ${time}`;
}

function newDraftId(): string {
  return crypto.randomUUID();
}

function Message({ message, now }: { message: PortalJobMessageView; now: Date }) {
  const ours = message.direction === 'to_store';
  return (
    <li className={cn('flex', ours ? 'justify-end pl-6' : 'justify-start pr-6')}>
      <div
        className={cn(
          'grid min-w-0 gap-1 rounded-2xl border px-3 py-2 text-sm',
          ours
            ? 'rounded-br-md border-[color:var(--ek-accent-soft-border)] bg-[color:var(--ek-accent-soft)]'
            : 'rounded-bl-md border-[#e0e8dc] bg-white',
        )}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="font-semibold text-slate-900">{portalJobMessageByline(message)}</span>
          <time dateTime={message.sentAt} className="text-xs text-slate-500">
            {when(message.sentAt, now)}
          </time>
        </div>
        <p className="m-0 whitespace-pre-wrap break-words leading-relaxed text-slate-700">{message.body}</p>
        {message.delivery === 'sending' ? <p className="m-0 text-xs text-slate-500">Skickas …</p> : null}
        {message.delivery === 'failed' ? (
          <p className="m-0 text-xs font-medium text-rose-700">
            Kom inte fram till butiken. En admin kan skicka om det under Inställningar, Återförsäljarportalen, Utskick.
          </p>
        ) : null}
      </div>
    </li>
  );
}

export default function WorkOrderPortalMessagesCard({ workOrderId, storeName, canEdit }: Props) {
  const toast = useToast();
  const [view, setView] = useState<PortalJobMessagesView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState('');
  const [department, setDepartment] = useState<PortalJobMessageDepartment>(DEFAULT_PORTAL_JOB_MESSAGE_DEPARTMENT);
  const [sending, setSending] = useState(false);
  // Utkastets id, skapat först när det behövs (inte vid varje rendering) och bytt när svaret skickats.
  const draftId = useRef<string | null>(null);
  const threadRef = useRef<HTMLOListElement | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Löpnummer: bara den senast påbörjade läsningen får skriva, och ett skickat svar gör pågående läsningar gamla. Annars
  // hade en läsning som startade före Skicka kunnat ta bort svaret ur tråden när den kom tillbaka.
  const loadSeq = useRef(0);
  const lastLoadAt = useRef(0);
  const followUps = useRef<number[]>([]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    lastLoadAt.current = Date.now();
    try {
      const res = await fetch(`/api/crm/portal/jobs/${workOrderId}/messages`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Meddelandena kunde inte hämtas.');
      if (seq !== loadSeq.current) return;
      setView(json.data as PortalJobMessagesView);
      setLoadError(false);
      setNow(new Date());
    } catch {
      if (seq === loadSeq.current) setLoadError(true);
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
    const pending = followUps.current;
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, [load]);

  // Det senaste står längst ned, som i portalen: rulla dit när tråden växer.
  const count = view?.messages.length ?? 0;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const chars = countChars(draft.trim());
  const tooLong = chars > PORTAL_JOB_MESSAGE_MAX_CHARS;
  const canSend = chars > 0 && !tooLong && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await fetch(`/api/crm/portal/jobs/${workOrderId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: (draftId.current ??= newDraftId()), body: draft, department }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const code = json?.errorDetails?.code;
        // Id:t är redan använt för ett annat svar: börja om med ett nytt, och visa det som faktiskt skickades.
        if (code === 'portal_message_conflict') {
          draftId.current = null;
          void load();
        }
        toast.error(json?.error || 'Svaret kunde inte skickas. Försök igen.');
        return;
      }
      const message = json.data.message as PortalJobMessageView;
      loadSeq.current += 1;
      setView((current) =>
        current
          ? { ...current, messages: current.messages.some((m) => m.id === message.id) ? current.messages : [...current.messages, message] }
          : current,
      );
      setDraft('');
      draftId.current = null;
      setNow(new Date());
      if (message.delivery === 'sending') {
        followUps.current.push(...AFTER_SEND_RELOADS_MS.map((ms) => window.setTimeout(() => void load(), ms)));
      }
    } catch {
      // Id:t står kvar: skickas det igen blir det samma svar, inte två.
      toast.error('Svaret kunde inte skickas. Försök igen.');
    } finally {
      setSending(false);
    }
  }

  const showComposer = canEdit && Boolean(view?.canReply);
  const composerId = `portal-reply-${workOrderId}`;

  return (
    <section className={cn(crm.cardInner, 'grid gap-3')} aria-labelledby={`portal-messages-${workOrderId}`}>
      <header className="grid gap-0.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`portal-messages-${workOrderId}`} className={cn(crm.cardTitle, 'm-0')}>
            Butiken
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--ek-accent-soft-border)] bg-[color:var(--ek-accent-soft)] px-2.5 py-0.5 text-xs font-semibold text-[color:var(--ek-green)]">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
            Syns för butiken
          </span>
        </div>
        <p className={cn(crm.meta, 'm-0')}>Samtalet med {storeName} i återförsäljarportalen.</p>
      </header>

      {!view && !loadError ? <p className="m-0 text-sm text-slate-500">Hämtar meddelandena …</p> : null}
      {loadError && !view ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800">
          <span>Meddelandena kunde inte hämtas.</span>
          <button type="button" onClick={() => void load()} className={crm.ghostButton}>
            Försök igen
          </button>
        </div>
      ) : null}

      {view && view.messages.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-3 py-4 text-sm leading-relaxed text-slate-600">
          Inga meddelanden än. Det butiken skriver om jobbet i portalen hamnar här.
        </p>
      ) : null}

      {view && view.messages.length > 0 ? (
        <ol
          ref={threadRef}
          aria-label={`Meddelanden med ${storeName}`}
          className="m-0 grid max-h-[22rem] list-none gap-2 overflow-y-auto overscroll-contain p-0 pr-0.5"
          tabIndex={0}
        >
          {view.messages.map((message) => (
            <Message key={message.id} message={message} now={now} />
          ))}
        </ol>
      ) : null}

      {showComposer ? (
        <form
          className="grid gap-2 border-t border-[#e0e8dc] pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor={composerId} className="sr-only">
            Svar till {storeName}
          </label>
          <Textarea
            id={composerId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={`Skriv till ${storeName} …`}
            rows={3}
            autoGrow
            autoGrowMaxHeight={240}
            disabled={sending}
            aria-invalid={tooLong}
            aria-describedby={`${composerId}-hint`}
            className="min-h-[5rem] text-sm"
          />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <Select
              value={department}
              onChange={(e) => setDepartment(e.target.value as PortalJobMessageDepartment)}
              aria-label="Avdelningen som butiken ser"
              className={crm.selectMenu}
              wrapperClassName="min-w-0"
              disabled={sending}
            >
              {PORTAL_JOB_MESSAGE_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <button type="submit" disabled={!canSend} className={cn(crm.saveButton, 'w-auto px-4')}>
              {sending ? 'Skickar …' : 'Skicka till butiken'}
            </button>
          </div>
          <p id={`${composerId}-hint`} className={cn(crm.micro, 'm-0 leading-relaxed')}>
            {chars >= COUNTER_FROM ? (
              <span className={cn('font-semibold', tooLong ? 'text-rose-700' : 'text-slate-700')}>
                {tooLong
                  ? `${chars - PORTAL_JOB_MESSAGE_MAX_CHARS} tecken för mycket. `
                  : `${PORTAL_JOB_MESSAGE_MAX_CHARS - chars} tecken kvar. `}
              </span>
            ) : null}
            Butiken ser ditt namn och avdelningen. Ett skickat svar går inte att ändra.
          </p>
        </form>
      ) : view && canEdit ? (
        <p className={cn(crm.micro, 'm-0 border-t border-[#e0e8dc] pt-3')}>Bara den som har ordern, eller en admin, kan svara butiken.</p>
      ) : null}
    </section>
  );
}
