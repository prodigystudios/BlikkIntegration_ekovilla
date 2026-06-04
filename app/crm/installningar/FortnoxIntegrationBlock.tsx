'use client';

import { useState } from 'react';
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
  const [disconnecting, setDisconnecting] = useState(false);
  const [articleSync, setArticleSync] = useState<SyncResult>(defaultSync);
  const [customerSync, setCustomerSync] = useState<SyncResult>(defaultSync);

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
        const msg =
          endpoint.includes('articles')
            ? `${d.synced} artiklar synkade (${d.pages} sidor)`
            : `${d.created} nya, ${d.updated} uppdaterade kunder`;
        setter({ label: '', state: 'success', message: msg });
      } else {
        setter({ label: '', state: 'error', message: json.error || 'Okänt fel' });
      }
    } catch {
      setter({ label: '', state: 'error', message: 'Nätverksfel' });
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
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
            description="Importerar Fortnox-kunder som Fortnox-kunder i CRM:et."
            state={customerSync.state}
            message={customerSync.message}
            onSync={() => runSync('/api/fortnox/customers/sync', setCustomerSync)}
          />

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
}: {
  label: string;
  description: string;
  state: SyncState;
  message: string | null;
  onSync: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <strong className="block text-sm font-semibold text-slate-900">{label}</strong>
          <span className="text-xs text-slate-500">{description}</span>
        </div>
        <button
          onClick={onSync}
          disabled={state === 'loading'}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {state === 'loading' ? 'Synkar...' : 'Synka'}
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
