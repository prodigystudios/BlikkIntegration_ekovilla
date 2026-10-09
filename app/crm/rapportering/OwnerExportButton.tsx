"use client";

import { useState } from 'react';

// Excel-exporten till ägarna: året hittills per säljare och vecka, budget mot utfall och orderstocken.
// Följer INTE periodväljaren — filen är alltid året hittills (Williams beslut 2026-10-09), och knappen
// säger det, så ingen tror att den exporterar den period som står vald.
//
// Hämtas med fetch i stället för en vanlig länk: ett fel ska bli ett meddelande här, inte en nedladdad
// JSON-fil eller en tom sida.

function filenameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] || 'Forsaljningsrapport.xlsx';
}

export default function OwnerExportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/crm/reports/export', { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error || 'Kunde inte skapa Excel-filen.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFrom(res.headers.get('Content-Disposition'));
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Kunde inte skapa Excel-filen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid justify-items-end gap-1">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-wait disabled:opacity-70"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 14.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" />
        </svg>
        <span>{busy ? 'Skapar Excel…' : 'Excel: året per vecka'}</span>
      </button>
      {error ? <p role="alert" className="m-0 text-[12px] text-rose-700">{error}</p> : null}
    </div>
  );
}
