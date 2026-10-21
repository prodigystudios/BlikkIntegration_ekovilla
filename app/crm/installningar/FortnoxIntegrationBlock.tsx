'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import type { FortnoxConnectionStatus } from '@/lib/domains/fortnox/types';

type SyncState = 'idle' | 'loading' | 'success' | 'error';

type SyncResult = {
  label: string;
  state: SyncState;
  message: string | null;
};

const defaultSync = (): SyncResult => ({ label: '', state: 'idle', message: null });

export default function FortnoxIntegrationBlock({
  initialStatus,
}: {
  initialStatus: FortnoxConnectionStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  // OAuth-flödet (/api/fortnox/auth och dess callback) redirectar hit med ?fortnox_error=<skäl> när
  // kopplingen inte sparades — t.ex. när spärren utanför produktion avvisar fel bolag.
  const connectError = useSearchParams().get('fortnox_error');
  const [disconnecting, setDisconnecting] = useState(false);
  const [articleSync, setArticleSync] = useState<SyncResult>(defaultSync);
  const [customerSync, setCustomerSync] = useState<SyncResult>(defaultSync);
  const [verifySync, setVerifySync] = useState<SyncResult>(defaultSync);
  const [blikkManagerSync, setBlikkManagerSync] = useState<SyncResult>(defaultSync);
  // Kunder som matchades mot CRM men inte fick ansvarig (med namn + orsak), ackumuleras över sidorna.
  type UnresolvedCustomer = { customerNumber: string; customerName: string; reason: 'unmapped_seller' | 'no_seller'; sellerBlikkId?: number };
  const [blikkUnresolved, setBlikkUnresolved] = useState<UnresolvedCustomer[]>([]);

  async function handleDisconnect() {
    if (!confirm('Är du säker på att du vill koppla från Fortnox?')) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/fortnox/auth/disconnect', { method: 'POST' });
      if (res.ok) {
        setStatus({ ...status, connected: false, connected_at: null, connected_by: null });
      }
    } finally {
      setDisconnecting(false);
    }
  }

  async function runSync(
    endpoint: string,
    setter: React.Dispatch<React.SetStateAction<SyncResult>>,
  ) {
    setter({ label: '', state: 'loading', message: null });
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.ok) {
        const d = json.data;
        setter({ label: '', state: 'success', message: `${d.synced} artiklar synkade (${d.pages} sidor)` });
      } else {
        setter({ label: '', state: 'error', message: json.error || 'Okänt fel' });
      }
    } catch {
      setter({ label: '', state: 'error', message: 'Nätverksfel' });
    }
  }

  // Kundsynken och kortpasset körs inte samtidigt, och inget av dem två gånger. Två kortpass hade hämtat samma kort
  // dubbelt så fort som Fortnox tillåter (429:orna lämnar korten i kön), två synkar hade bläddrat listan parallellt.
  // Knapparna spärras också, men refarna håller även för ett dubbelklick innan staten hunnit renderas.
  const customerSyncRunning = useRef(false);
  const cardPassRunning = useRef(false);

  // Kundlistan bär bara tio fält; omvänd moms, betalningsvillkor, prislista m.m. finns på kundkortet. Synken köar nya och
  // i Fortnox ändrade kunder, och kortpasset startar direkt efteråt — annars stod de köade fälten kvar tills någon
  // mindes att trycka på nästa knapp. Synkraden står som pågående tills kortpasset är klart, och visar om det inte blev det.
  async function runCustomerSync() {
    if (customerSyncRunning.current || cardPassRunning.current) return;
    customerSyncRunning.current = true;
    setCustomerSync({ label: '', state: 'loading', message: null });
    try {
      const res = await fetch('/api/fortnox/customers/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setCustomerSync({ label: '', state: 'error', message: json.error || 'Okänt fel' });
        return;
      }
      const d = json.data as { created: number; updated: number; pendingCards: number };
      const summary = `${d.created} nya, ${d.updated} uppdaterade kunder.`;
      if (d.pendingCards === 0) {
        setCustomerSync({ label: '', state: 'success', message: summary });
        return;
      }
      setCustomerSync({ label: '', state: 'loading', message: `${summary} Hämtar ${d.pendingCards} kundkort nedan...` });
      const cardsDone = await runCardPass();
      setCustomerSync(cardsDone
        ? { label: '', state: 'success', message: summary }
        : { label: '', state: 'error', message: `${summary} Kundkorten blev inte klara – se steget nedan.` });
    } catch {
      setCustomerSync({ label: '', state: 'error', message: 'Nätverksfel' });
    } finally {
      customerSyncRunning.current = false;
    }
  }

  // Reads the Fortnox card of every queued customer (type, reverse VAT, terms of
  // payment, price list …). The endpoint processes one throttled batch per call and
  // returns how many remain, so we loop, accumulating progress as we go. Each batch
  // starts after the previous one's last customer number: a card that fails stays
  // queued but is not retried first in every batch, so the run always moves forward.
  // The run ends at the end of the queue; failed cards are retried by the next run.
  // Returns whether the queue is empty.
  async function runCardPass(): Promise<boolean> {
    if (cardPassRunning.current) return false;
    cardPassRunning.current = true;
    setVerifySync({ label: '', state: 'loading', message: 'Hämtar kundkort...' });
    let fetched = 0;
    let corrected = 0;
    let failed = 0;
    let after: string | null = null;
    try {
      for (let guard = 0; guard < 1000; guard++) {
        const res = await fetch('/api/fortnox/customers/verify-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ after }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setVerifySync({ label: '', state: 'error', message: json.error || 'Okänt fel' });
          return false;
        }
        const d = json.data as { processed: number; corrected: number; remaining: number; failed: number; last: string | null };
        fetched += d.processed - d.failed;
        corrected += d.corrected;
        failed += d.failed;
        after = d.last;
        if (d.processed === 0 || d.remaining === 0) {
          if (d.remaining === 0) {
            setVerifySync({ label: '', state: 'success', message: `Klart – ${fetched} kundkort hämtade, ${corrected} kunder omklassade.` });
            return true;
          }
          setVerifySync({
            label: '',
            state: 'error',
            message: `${fetched} kundkort hämtade, ${failed} gick inte att hämta. ${d.remaining} står kvar – kör igen senare.`,
          });
          return false;
        }
        setVerifySync({
          label: '',
          state: 'loading',
          message: `${fetched} kundkort hämtade, ${corrected} omklassade, ${d.remaining} kvar...`,
        });
      }
      setVerifySync({ label: '', state: 'success', message: `Pausat efter ${fetched} kundkort – kör igen för resten.` });
      return false;
    } catch {
      setVerifySync({ label: '', state: 'error', message: 'Nätverksfel' });
      return false;
    } finally {
      cardPassRunning.current = false;
    }
  }

  // Knappen "Hämta kundkort" — inte medan en kundsynk pågår, som startar passet själv.
  async function runCardPassFromButton() {
    if (customerSyncRunning.current) return;
    await runCardPass();
  }

  // Backfill av kundansvarig från Blikk. Endpointen bearbetar en Blikk-listsida per anrop
  // och returnerar nextPage, så vi loopar sida för sida tills nextPage === null. Endast
  // företagskunder berörs; ansvarig skrivs över med Blikks värde.
  async function runBlikkManagers() {
    setBlikkManagerSync({ label: '', state: 'loading', message: 'Startar import...' });
    setBlikkUnresolved([]);
    let updated = 0;
    let processed = 0;
    let unmatched = 0;
    const unresolved: UnresolvedCustomer[] = [];
    let page: number | null = 1;
    try {
      for (let guard = 0; guard < 2000 && page != null; guard++) {
        const res = await fetch('/api/crm/customers/sync-blikk-managers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setBlikkManagerSync({ label: '', state: 'error', message: json.error || 'Okänt fel' });
          return;
        }
        const d = json.data as {
          updated: number; processed: number; nextPage: number | null;
          unresolved: UnresolvedCustomer[]; unmatchedCustomer: unknown[];
        };
        updated += d.updated;
        processed += d.processed;
        unmatched += d.unmatchedCustomer.length;
        unresolved.push(...d.unresolved);
        setBlikkUnresolved([...unresolved]);
        page = d.nextPage;
        if (page == null) {
          setBlikkManagerSync({
            label: '', state: 'success',
            message: `Klart – ${updated} kundansvariga satta (${processed} kontakter). ${unresolved.length} kunder utan ansvarig, ${unmatched} Blikk-kunder saknar CRM-motsvarighet.`,
          });
          return;
        }
        setBlikkManagerSync({
          label: '', state: 'loading',
          message: `${updated} satta, ${unresolved.length} utan ansvarig... (sida ${page})`,
        });
      }
      setBlikkManagerSync({ label: '', state: 'success', message: `Pausat efter ${processed} kontakter – kör igen för resten.` });
    } catch {
      setBlikkManagerSync({ label: '', state: 'error', message: 'Nätverksfel' });
    }
  }

  const connectedAt = status.connected_at
    ? new Date(status.connected_at).toLocaleDateString('sv-SE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-base font-bold text-slate-900">Fortnox-integration</h2>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            Koppla mot Fortnox för artikelregister, offerter och ordrar.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {status.is_test_mode && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
              Testläge
            </span>
          )}
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              status.connected
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            {status.connected ? 'Kopplad' : 'Ej kopplad'}
          </span>
        </div>
      </div>

      {connectError && !status.connected && (
        <p
          role="alert"
          className="m-0 mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
        >
          Fortnox kopplades inte: {connectError}
        </p>
      )}

      {status.connected ? (
        <div className="grid gap-3">
          {connectedAt && (
            <p className="m-0 text-xs text-slate-500">Ansluten sedan {connectedAt}</p>
          )}

          {/* Article sync */}
          <SyncRow
            label="Synka artikelregister"
            description="Importerar alla aktiva artiklar från Fortnox till lokal cache."
            state={articleSync.state}
            message={articleSync.message}
            onSync={() => runSync('/api/fortnox/articles/sync', setArticleSync)}
          />

          {/* Customer sync */}
          <SyncRow
            label="Synka kunder från Fortnox"
            description="Läser Fortnox kundlista (namn, org.nr, e-post, telefon, fakturaadress) och köar nya och ändrade kunder för kundkorten nedan, som hämtas direkt efteråt."
            state={customerSync.state}
            message={customerSync.message}
            onSync={runCustomerSync}
            disabled={verifySync.state === 'loading'}
          />

          {/* Kortpasset: allt kundlistan saknar, och den bekräftade kundtypen */}
          <SyncRow
            label="Hämta kundkort"
            description="Läser kundkortet i Fortnox för köade kunder: kundtyp, omvänd moms, betalningsvillkor, prislista, fakturamejl och adresser. Kan ta en kvart vid många kunder – håll sidan öppen. Avbryts det fortsätter nästa körning där det slutade."
            state={verifySync.state}
            message={verifySync.message}
            onSync={runCardPassFromButton}
            disabled={customerSync.state === 'loading'}
          />

          {/* Kundansvarig från Blikk (backfill, endast företagskunder) */}
          <SyncRow
            label="Hämta kundansvarig från Blikk"
            description="Matchar företagskunder mot Blikk via kundnummer och sätter ansvarig säljare. Skriver över befintlig kundansvarig. Säljare utan Blikk-koppling rapporteras."
            state={blikkManagerSync.state}
            message={blikkManagerSync.message}
            onSync={runBlikkManagers}
          />

          {/* Vilka kunder som matchades men inte fick ansvarig (så admin kan åtgärda) */}
          {blikkUnresolved.length > 0 ? (
            <details className="rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-amber-800">
                {blikkUnresolved.length} kunder utan ansvarig – visa vilka
              </summary>
              <p className="mt-2 mb-1 text-[11px] text-amber-700">
                <strong>Omappad säljare</strong> = Blikk-säljaren är inte kopplad under Admin → Blikk-koppling
                (mappa den och kör om). <strong>Ingen ansvarig i Blikk</strong> = kunden saknar ansvarig säljare i Blikk.
              </p>
              <ul className="mt-1 grid gap-1">
                {blikkUnresolved.map((u) => (
                  <li key={`${u.customerNumber}-${u.reason}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-slate-700">
                      <span className="font-semibold">{u.customerName}</span>
                      <span className="text-slate-400"> · #{u.customerNumber}</span>
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-amber-700">
                      {u.reason === 'unmapped_seller'
                        ? `Omappad säljare${u.sellerBlikkId ? ` (Blikk-id ${u.sellerBlikkId})` : ''}`
                        : 'Ingen ansvarig i Blikk'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="mt-1 border-t border-slate-100 pt-3">
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-50"
            >
              {disconnecting ? 'Kopplar från...' : 'Koppla från Fortnox'}
            </button>
          </div>
        </div>
      ) : (
        <a
          href="/api/fortnox/auth"
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 no-underline transition hover:bg-emerald-100"
        >
          Anslut Fortnox
        </a>
      )}
    </div>
  );
}

function SyncRow({
  label,
  description,
  state,
  message,
  onSync,
  disabled = false,
}: {
  label: string;
  description: string;
  state: SyncState;
  message: string | null;
  onSync: () => void;
  // Spärrad av ett annat steg som pågår (kundsynken och kortpasset får inte köras samtidigt).
  disabled?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state === 'loading') {
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state]);

  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <strong className="block text-sm font-semibold text-slate-900">{label}</strong>
          <span className="text-xs text-slate-500">{description}</span>
        </div>
        <button
          onClick={onSync}
          disabled={state === 'loading' || disabled}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {state === 'loading' ? `Synkar... ${elapsed}s` : 'Synka'}
        </button>
      </div>
      {message && (
        <p
          className={`m-0 mt-1 text-xs font-medium ${
            state === 'success' ? 'text-emerald-700' : 'text-rose-600'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
