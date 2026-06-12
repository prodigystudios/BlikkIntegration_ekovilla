'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import type { JobTypeRow } from '@/lib/domains/planning/jobTypes';

const API = '/api/crm/planering/job-types';
const COLOR_INPUT = 'h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-[#dce4d8] bg-white p-0.5';
const TEXT_INPUT = 'h-8 flex-1 rounded-lg border border-[#dce4d8] bg-white px-2 text-[13px] text-slate-900 outline-none transition focus:border-emerald-500';
const PRIMARY = 'inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-[12px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50';

// Job-type management: rename, recolor, (de)activate or add/remove job types. The key is stable
// (shown read-only). onChanged refreshes the board's picker + chips.
export default function JobTypeManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [types, setTypes] = useState<JobTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#0d9488');

  useEffect(() => {
    let active = true;
    fetch(API, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (active && j.ok) setTypes(j.data.jobTypes as JobTypeRow[]);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function patchLocal(id: string, patch: Partial<JobTypeRow>) {
    setTypes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function saveType(t: JobTypeRow) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: t.label, color: t.color, active: t.active }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte spara jobbtypen');
      toast.success('Sparad');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeType(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte ta bort jobbtypen');
      setTypes((prev) => prev.filter((t) => t.id !== id));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addType(e: FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), color: newColor }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte lägga till jobbtypen');
      setTypes((prev) => [...prev, j.data.item as JobTypeRow]);
      setNewLabel('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Hantera jobbtyper"
      maxWidth="sm:max-w-[560px]"
      header={
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Hantera jobbtyper</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">Namn + färg på korten. Avaktivera för att dölja ur väljaren utan att tappa historik.</p>
        </div>
      }
      footer={
        <button type="button" onClick={onClose} className={cn(crm.ghostButton, 'ml-auto')}>
          Stäng
        </button>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Laddar…</p>
      ) : (
        <div className="grid gap-2">
          {types.map((t) => (
            <div key={t.id} className={cn('flex items-center gap-2 rounded-xl border border-[#e0e8dc] bg-white p-2', !t.active && 'opacity-60')}>
              <input type="color" value={t.color} onChange={(e) => patchLocal(t.id, { color: e.target.value })} className={COLOR_INPUT} aria-label="Färg" />
              <input value={t.label} onChange={(e) => patchLocal(t.id, { label: e.target.value })} className={TEXT_INPUT} aria-label="Namn" />
              <label className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
                <input type="checkbox" checked={t.active} onChange={(e) => patchLocal(t.id, { active: e.target.checked })} className="h-3.5 w-3.5 accent-emerald-600" />
                Aktiv
              </label>
              <button type="button" onClick={() => saveType(t)} disabled={busy} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
                Spara
              </button>
              <button
                type="button"
                onClick={() => removeType(t.id)}
                disabled={busy}
                aria-label="Ta bort jobbtyp"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#e0e8dc] bg-white text-slate-400 transition hover:border-rose-300 hover:text-rose-500 disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
              </button>
            </div>
          ))}

          {types.length === 0 && <p className="py-2 text-center text-[12px] text-slate-400">Inga jobbtyper upplagda än.</p>}

          <form onSubmit={addType} className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-2">
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className={COLOR_INPUT} aria-label="Färg" />
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ny jobbtyp…" className={TEXT_INPUT} aria-label="Namn på ny jobbtyp" />
            <button type="submit" disabled={busy || !newLabel.trim()} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
              Lägg till
            </button>
          </form>
        </div>
      )}
    </CrmModal>
  );
}
