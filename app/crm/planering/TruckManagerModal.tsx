'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import type { OpsTruck } from '@/lib/domains/planning/types';

const API = '/api/crm/planering/trucks';
const COLOR_INPUT = 'h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-[#dce4d8] bg-white p-0.5';
const TEXT_INPUT = 'h-8 flex-1 rounded-lg border border-[#dce4d8] bg-white px-2 text-[13px] text-slate-900 outline-none transition focus:border-emerald-500';
const PRIMARY = 'inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-[12px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50';

// Fleet management: list every truck (incl inactive), rename/recolor/(de)activate, add or remove.
// onChanged lets the board refresh its active-truck lanes after a change.
export default function TruckManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [trucks, setTrucks] = useState<OpsTruck[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3f6f52');

  useEffect(() => {
    let active = true;
    fetch(API, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (active && j.ok) setTrucks(j.data.trucks as OpsTruck[]);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function patchLocal(id: string, patch: Partial<OpsTruck>) {
    setTrucks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function saveTruck(t: OpsTruck) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t.name, color: t.color, active: t.active }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte spara bilen');
      toast.success('Sparad');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeTruck(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte ta bort bilen');
      setTrucks((prev) => prev.filter((t) => t.id !== id));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addTruck(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte lägga till bilen');
      setTrucks((prev) => [...prev, j.data.item as OpsTruck]);
      setNewName('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Hantera bilar"
      maxWidth="sm:max-w-[560px]"
      header={
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Hantera bilar</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">Lägg till, byt namn/färg eller avaktivera bilar i flottan.</p>
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
          {trucks.map((t) => (
            <div key={t.id} className={cn('flex items-center gap-2 rounded-xl border border-[#e0e8dc] bg-white p-2', !t.active && 'opacity-60')}>
              <input type="color" value={t.color || '#94a3b8'} onChange={(e) => patchLocal(t.id, { color: e.target.value })} className={COLOR_INPUT} aria-label="Färg" />
              <input value={t.name} onChange={(e) => patchLocal(t.id, { name: e.target.value })} className={TEXT_INPUT} aria-label="Namn" />
              <label className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
                <input type="checkbox" checked={t.active} onChange={(e) => patchLocal(t.id, { active: e.target.checked })} className="h-3.5 w-3.5 accent-emerald-600" />
                Aktiv
              </label>
              <button type="button" onClick={() => saveTruck(t)} disabled={busy} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
                Spara
              </button>
              <button
                type="button"
                onClick={() => removeTruck(t.id)}
                disabled={busy}
                aria-label="Ta bort bil"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#e0e8dc] bg-white text-slate-400 transition hover:border-rose-300 hover:text-rose-500 disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
              </button>
            </div>
          ))}

          {trucks.length === 0 && <p className="py-2 text-center text-[12px] text-slate-400">Inga bilar upplagda än.</p>}

          <form onSubmit={addTruck} className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-2">
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className={COLOR_INPUT} aria-label="Färg" />
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ny bil…" className={TEXT_INPUT} aria-label="Namn på ny bil" />
            <button type="submit" disabled={busy || !newName.trim()} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
              Lägg till
            </button>
          </form>
        </div>
      )}
    </CrmModal>
  );
}
