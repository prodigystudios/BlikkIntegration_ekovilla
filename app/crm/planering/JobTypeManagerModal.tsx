'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import type { JobTypeRow } from '@/lib/domains/planning/jobTypes';

const API = '/api/crm/planering/job-types';
const COLOR_INPUT = 'h-9 w-full cursor-pointer rounded-lg border border-[#dce4d8] bg-white p-1';
const TEXT_INPUT = 'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15';
const PRIMARY = 'inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-4 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50';
const DANGER = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#e0e8dc] bg-white px-3 text-[13px] font-semibold text-slate-500 transition hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50';

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
        <div className="grid gap-3">
          {types.map((t) => (
            <div key={t.id} className={cn('rounded-xl border border-[#e0e8dc] bg-white p-3', !t.active && 'opacity-60')}>
              <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2.5">
                <input type="color" value={t.color} onChange={(e) => patchLocal(t.id, { color: e.target.value })} className={COLOR_INPUT} aria-label="Färg" />
                <input value={t.label} onChange={(e) => patchLocal(t.id, { label: e.target.value })} className={TEXT_INPUT} placeholder="Jobbtypens namn" aria-label="Namn" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#eef3eb] pt-2.5">
                <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#e0e8dc] bg-[#f9fbf7] px-3 text-[13px] font-semibold text-slate-600">
                  <input type="checkbox" checked={t.active} onChange={(e) => patchLocal(t.id, { active: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                  Aktiv
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => removeType(t.id)} disabled={busy} className={DANGER}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                    Ta bort
                  </button>
                  <button type="button" onClick={() => saveType(t)} disabled={busy} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
                    Spara
                  </button>
                </div>
              </div>
            </div>
          ))}

          {types.length === 0 && <p className="py-2 text-center text-[13px] text-slate-400">Inga jobbtyper upplagda än.</p>}

          <form onSubmit={addType} className="rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-3">
            <p className="mb-2 px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Lägg till ny jobbtyp</p>
            <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2.5">
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className={COLOR_INPUT} aria-label="Färg" />
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Jobbtypens namn…" className={TEXT_INPUT} aria-label="Namn på ny jobbtyp" />
              <button type="submit" disabled={busy || !newLabel.trim()} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
                Lägg till
              </button>
            </div>
          </form>
        </div>
      )}
    </CrmModal>
  );
}
