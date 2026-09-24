"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate } from '@/app/crm/lib/format';
import { safetyRoundOrderRef, type SafetyRoundListRow } from '@/lib/domains/safetyRounds/types';
import { ROUND_STATUS_BADGE, ROUND_STATUS_LABEL } from './_components/safetyUi';
import { useStartSafetyRound } from './_components/useStartSafetyRound';

// /skyddsrond — alla ronder, senaste först, och starten av en ny rond på valfri arbetsorder.
//
// Ordersöket går genom en smal serverfunktion (safety_round_order_lookup) och inte genom CRM:ets
// ordersök: en rondledare kan sakna CRM-åtkomst helt och ska ändå kunna starta en rond.

type OrderHit = {
  id: string;
  order_number: string | null;
  fortnox_order_number: string | null;
  project_name: string | null;
  client_name: string | null;
  address: string | null;
};

function OrderSearch() {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<OrderHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const { start, startingFor } = useStartSafetyRound();

  // Sök 300 ms efter sista tangenten. Svar som kommer i fel ordning kastas (löpnumret).
  useEffect(() => {
    const q = query.trim();
    // Löpnumret räknas upp även här: ett svar på en äldre fråga får inte landa efter att fältet tömts.
    const current = ++seq.current;
    if (q.length < 2) {
      setHits(null);
      setError(null);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/safety-rounds/orders?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (current !== seq.current) return;
        if (!res.ok || !json.ok) {
          setError(json?.error || 'Kunde inte söka arbetsordrar.');
          setHits(null);
        } else {
          setError(null);
          setHits((json.data?.items || []) as OrderHit[]);
        }
      } catch {
        if (current === seq.current) setError('Ingen kontakt med servern. Kontrollera uppkopplingen.');
      } finally {
        if (current === seq.current) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <section className={cn(crm.cardInner, 'grid gap-3 p-4')} aria-labelledby="new-round-title">
      <h2 id="new-round-title" className={cn('m-0', crm.cardTitle)}>
        Ny skyddsrond
      </h2>
      <div className="grid gap-1">
        <label htmlFor={inputId} className={cn('m-0', crm.label)}>
          Arbetsorder
        </label>
        <Input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ordernummer, projekt eller kund"
          autoComplete="off"
        />
      </div>

      {error ? <p className="m-0 text-sm text-rose-800">{error}</p> : null}
      {searching && !hits ? <p className={cn('m-0', crm.meta)}>Söker…</p> : null}
      {hits && hits.length === 0 ? (
        <p className={cn('m-0', crm.meta)}>Ingen arbetsorder matchar ”{query.trim()}”.</p>
      ) : null}
      {hits && hits.length > 0 ? (
        <ul className="m-0 grid list-none divide-y divide-[#e8eee4] p-0">
          {hits.map((hit) => {
            const ref = safetyRoundOrderRef(hit);
            return (
              <li key={hit.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-1">
                <div className="min-w-0 flex-1">
                  <p className={cn('m-0', crm.bodyStrong)}>{hit.project_name || 'Namnlös order'}</p>
                  <p className={cn('m-0', crm.meta)}>{[ref && `Order ${ref}`, hit.client_name, hit.address].filter(Boolean).join(', ')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void start(hit.id)}
                  disabled={startingFor !== null}
                  className={cn(crm.saveButton, 'min-h-11 w-full sm:w-auto sm:px-5')}
                >
                  {startingFor === hit.id ? 'Startar…' : 'Starta rond'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export default function SafetyRoundsListClient({ canWrite }: { canWrite: boolean }) {
  const [rounds, setRounds] = useState<SafetyRoundListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/safety-rounds', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setLoadError(true);
        return;
      }
      setRounds((json.data?.items || []) as SafetyRoundListRow[]);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4">
      <header>
        <h1 className={cn('m-0', crm.pageTitle)}>Skyddsronder</h1>
        <p className={cn('m-0 mt-1', crm.pageSubtitle)}>Skyddsronder ute på arbetsplatserna, med checklista och handlingsplan.</p>
      </header>

      {canWrite ? <OrderSearch /> : null}

      <section className={cn(crm.card, 'overflow-hidden')} aria-labelledby="rounds-title">
        <h2 id="rounds-title" className={cn('m-0 px-4 pb-2 pt-4', crm.cardTitle)}>
          Senaste ronderna
        </h2>
        {loading ? (
          <p className={cn('m-0 px-4 pb-4', crm.meta)} role="status">
            Hämtar…
          </p>
        ) : loadError ? (
          <div className="flex flex-wrap items-center gap-3 px-4 pb-4">
            <p className="m-0 text-sm text-rose-800">Kunde inte hämta skyddsronderna.</p>
            <button type="button" onClick={() => void load()} className={cn(crm.ghostButton, 'min-h-11')}>
              Försök igen
            </button>
          </div>
        ) : rounds.length === 0 ? (
          <p className={cn('m-0 px-4 pb-4', crm.meta)}>
            Inga skyddsronder ännu.{canWrite ? ' Sök fram arbetsordern ovan, eller starta ronden från arbetsordern.' : ''}
          </p>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-[#e8eee4] p-0">
            {rounds.map((round) => {
              const ref = safetyRoundOrderRef(round);
              return (
                <li key={round.id}>
                  <Link
                    href={`/skyddsrond/${round.id}`}
                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 text-inherit no-underline hover:bg-white"
                  >
                    <div className="min-w-0">
                      <p className={cn('m-0 truncate', crm.bodyStrong)}>{round.project_name}</p>
                      <p className={cn('m-0 truncate', crm.meta)}>
                        {[`Rond ${round.round_number}`, ref && `order ${ref}`, formatDate(round.held_on), round.leader_name].filter(Boolean).join(', ')}
                      </p>
                    </div>
                    <span className={cn(crm.badge, 'shrink-0', ROUND_STATUS_BADGE[round.status])}>{ROUND_STATUS_LABEL[round.status]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
