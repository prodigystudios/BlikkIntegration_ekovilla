'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import type { OpsTruck, OpsDepot } from '@/lib/domains/planning/types';

const API = '/api/crm/planering/trucks';
const DEPOTS_API = '/api/crm/planering/depots';
const COLOR_INPUT = 'h-9 w-full cursor-pointer rounded-lg border border-[#dce4d8] bg-white p-1';
const TEXT_INPUT = 'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15';
const SELECT_INPUT = 'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-emerald-500';
const PRIMARY = 'inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-4 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50';
const DANGER = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#e0e8dc] bg-white px-3 text-[13px] font-semibold text-slate-500 transition hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50';

// Fleet management: list every truck (incl inactive), rename/recolor/(de)activate, add or remove.
// onChanged lets the board refresh its active-truck lanes after a change.
export default function TruckManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [trucks, setTrucks] = useState<OpsTruck[]>([]);
  const [depots, setDepots] = useState<OpsDepot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3f6f52');

  useEffect(() => {
    let active = true;
    Promise.all([fetch(API, { cache: 'no-store' }).then((r) => r.json()), fetch(DEPOTS_API, { cache: 'no-store' }).then((r) => r.json())])
      .then(([truckRes, depotRes]) => {
        if (!active) return;
        if (truckRes.ok) setTrucks(truckRes.data.trucks as OpsTruck[]);
        if (depotRes.ok) setDepots((depotRes.data.depots as OpsDepot[]).filter((d) => d.active));
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
        body: JSON.stringify({ name: t.name, color: t.color, active: t.active, depot_id: t.depot_id }),
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
        <div className="grid gap-3">
          {trucks.map((t) => (
            <div key={t.id} className={cn('rounded-xl border border-[#e0e8dc] bg-white p-3', !t.active && 'opacity-60')}>
              <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2.5">
                <input type="color" value={t.color || '#94a3b8'} onChange={(e) => patchLocal(t.id, { color: e.target.value })} className={COLOR_INPUT} aria-label="Färg" />
                <input value={t.name} onChange={(e) => patchLocal(t.id, { name: e.target.value })} className={TEXT_INPUT} placeholder="Bilens namn" aria-label="Namn" />
              </div>
              <div className="mt-2.5 flex flex-wrap items-end gap-3">
                <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                  <label className="px-0.5 text-[11px] font-semibold text-slate-500">Depå</label>
                  <select
                    value={t.depot_id ?? ''}
                    onChange={(e) => patchLocal(t.id, { depot_id: e.target.value || null })}
                    aria-label="Depå"
                    className={SELECT_INPUT}
                  >
                    <option value="">Ingen depå</option>
                    {depots.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#e0e8dc] bg-[#f9fbf7] px-3 text-[13px] font-semibold text-slate-600">
                  <input type="checkbox" checked={t.active} onChange={(e) => patchLocal(t.id, { active: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                  Aktiv
                </label>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#eef3eb] pt-2.5">
                <button type="button" onClick={() => removeTruck(t.id)} disabled={busy} className={DANGER}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                  Ta bort
                </button>
                <button type="button" onClick={() => saveTruck(t)} disabled={busy} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
                  Spara
                </button>
              </div>
            </div>
          ))}

          {trucks.length === 0 && <p className="py-2 text-center text-[13px] text-slate-400">Inga bilar upplagda än.</p>}

          <form onSubmit={addTruck} className="rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-3">
            <p className="mb-2 px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Lägg till ny bil</p>
            <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2.5">
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className={COLOR_INPUT} aria-label="Färg" />
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bilens namn…" className={TEXT_INPUT} aria-label="Namn på ny bil" />
              <button type="submit" disabled={busy || !newName.trim()} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
                Lägg till
              </button>
            </div>
          </form>
        </div>
      )}
    </CrmModal>
  );
}
