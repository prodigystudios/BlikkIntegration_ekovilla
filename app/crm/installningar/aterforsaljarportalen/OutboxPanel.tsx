"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/Toast';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

// Fliken Utskick (fas 4b, William 2026-09-28): det CRM:et inte fått fram till portalen. Uppgivna först, eftersom de
// kräver en människa; väntande sedan, eftersom de görs om av sig själva. Etiketterna och tiderna kommer färdiga från
// servern (page.tsx), så att servern och webbläsaren skriver samma sak.

export type OutboxItemView = {
  id: string;
  kindLabel: string;
  detail: string | null;
  status: 'dead' | 'pending' | 'sending' | 'sent' | 'superseded';
  attempts: number;
  lastError: string | null;
  queuedAtLabel: string;
  nextAttemptLabel: string | null;
  /** Jobbets butik och offert, med länk till arbetsordern. null för prislistan. */
  job: { label: string; href: string | null } | null;
  canRetry: boolean;
};

const CARD =
  'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]';

function attemptsLabel(n: number): string {
  return n === 1 ? 'ett försök' : `${n} försök`;
}

function StatusBadge({ item }: { item: OutboxItemView }) {
  if (item.status === 'dead') return <Badge variant="danger">Gav upp</Badge>;
  if (item.status === 'sending') return <Badge variant="neutral">Skickas</Badge>;
  return <Badge variant="neutral">{item.attempts > 0 ? 'Försöker igen' : 'Väntar'}</Badge>;
}

function Row({ item, retrying, onRetry, canAct }: { item: OutboxItemView; retrying: boolean; onRetry: () => void; canAct: boolean }) {
  return (
    <li className="list-none rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-slate-900">{item.kindLabel}</span>
          {item.detail && <span className="ml-2 text-sm text-slate-600">{item.detail}</span>}
        </div>
        <StatusBadge item={item} />
      </div>

      <div className="mt-0.5 min-w-0 break-words text-xs text-slate-500">
        {item.job ? (
          item.job.href ? (
            <Link href={item.job.href} className="font-semibold text-slate-700 underline">
              {item.job.label}
            </Link>
          ) : (
            item.job.label
          )
        ) : (
          'Alla butiker'
        )}
      </div>

      {item.lastError && <div className="mt-1 break-words text-xs text-red-700">{item.lastError}</div>}

      <div className="mt-0.5 text-xs text-slate-400">
        Köad {item.queuedAtLabel}
        {item.attempts > 0 ? `, ${attemptsLabel(item.attempts)}` : ''}
        {item.nextAttemptLabel ? `. Nästa försök ${item.nextAttemptLabel}` : ''}
      </div>

      {item.status === 'dead' &&
        (item.canRetry ? (
          <div className="mt-2.5">
            <Button variant="secondary" onClick={onRetry} disabled={!canAct}>
              {retrying ? 'Skickar om…' : 'Skicka om'}
            </Button>
          </div>
        ) : (
          <p className="m-0 mt-1.5 text-xs text-slate-500">
            Skickas inte om: något senare för samma {item.job ? 'jobb' : 'prislista'} har redan gått iväg eller väntar, och
            det här hade hamnat efter det.
          </p>
        ))}
    </li>
  );
}

export default function OutboxPanel({
  items,
  integrationEnabled,
  dispatching,
  onDispatch,
}: {
  items: OutboxItemView[] | { error: string };
  integrationEnabled: boolean;
  dispatching: boolean;
  onDispatch: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const list = Array.isArray(items) ? items : [];
  const dead = list.filter((i) => i.status === 'dead');
  const waiting = list.filter((i) => i.status !== 'dead');
  const busy = dispatching || retryingId !== null;

  async function retry(id: string) {
    setRetryingId(id);
    let message: string | null = null;
    try {
      const res = await fetch(`/api/crm/portal/events/${id}/retry`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) message = json?.error || `Begäran misslyckades (${res.status})`;
    } catch {
      message = 'Servern svarade inte. Ladda om sidan och se om händelsen ligger i kön.';
    }
    setRetryingId(null);
    if (message) toast.error(message);
    else toast.success('Tillbaka i kön och skickad på nytt. Står den kvar här har den inte kommit fram än.');
    router.refresh();
  }

  return (
    <section className={CARD} aria-labelledby="portal-outbox-heading">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <h2 id="portal-outbox-heading" className="m-0 text-base font-bold text-slate-900">
          Utskick
        </h2>
        <Button variant="secondary" onClick={onDispatch} disabled={!integrationEnabled || busy}>
          {dispatching ? 'Skickar…' : 'Skicka väntande nu'}
        </Button>
      </div>
      <p className="m-0 mb-4 max-w-3xl text-sm text-slate-500">
        Det CRM:et skickar till portalen: prislistorna och jobbens status. Ett utskick som inte kommer fram görs om av sig
        självt i två dygn. Det portalen nekar ges upp direkt och står kvar här tills någon skickar om det.
      </p>

      {!Array.isArray(items) ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">{items.error}</div>
      ) : list.length === 0 ? (
        <p className="m-0 text-sm text-slate-500">Inget väntar och inget har gett upp.</p>
      ) : (
        <div className="grid gap-5">
          {dead.length > 0 && (
            <div>
              <h3 className="m-0 mb-2 text-sm font-bold text-red-800">Gav upp ({dead.length})</h3>
              <ul className="m-0 grid gap-2.5 pl-0">
                {dead.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    retrying={retryingId === item.id}
                    onRetry={() => retry(item.id)}
                    canAct={integrationEnabled && !busy}
                  />
                ))}
              </ul>
            </div>
          )}
          {waiting.length > 0 && (
            <div>
              <h3 className="m-0 mb-2 text-sm font-bold text-slate-700">Väntar ({waiting.length})</h3>
              <ul className="m-0 grid gap-2.5 pl-0">
                {waiting.map((item) => (
                  <Row key={item.id} item={item} retrying={false} onRetry={() => undefined} canAct={false} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
