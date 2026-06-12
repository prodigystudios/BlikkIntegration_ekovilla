'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import type { OpsDepot } from '@/lib/domains/planning/types';

const API = '/api/crm/planering/depots';
const TEXT_INPUT = 'h-8 w-full rounded-lg border border-[#dce4d8] bg-white px-2 text-[13px] text-slate-900 outline-none transition focus:border-emerald-500';
const PRIMARY = 'inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-[12px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50';

// Depot management: list every depot (incl inactive), rename/relocate/(de)activate, add or remove.
// onChanged lets the truck pickers + board refresh after a change.
export default function DepotManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [depots, setDepots] = useState<OpsDepot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');

  useEffect(() => {
    let active = true;
    fetch(API, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (active && j.ok) setDepots(j.data.depots as OpsDepot[]);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function patchLocal(id: string, patch: Partial<OpsDepot>) {
    setDepots((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function saveDepot(d: OpsDepot) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/${d.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: d.name, location: d.location, active: d.active }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte spara depån');
      toast.success('Sparad');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeDepot(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte ta bort depån');
      setDepots((prev) => prev.filter((d) => d.id !== id));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addDepot(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), location: newLocation.trim() || null }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte lägga till depån');
      setDepots((prev) => [...prev, j.data.item as OpsDepot]);
      setNewName('');
      setNewLocation('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Hantera depåer"
      maxWidth="sm:max-w-[560px]"
      header={
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Hantera depåer</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">Lager där säckarna förvaras. Koppla bilar till en depå under Bilar.</p>
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
          {depots.map((d) => (
            <div key={d.id} className={cn('grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2 rounded-xl border border-[#e0e8dc] bg-white p-2', !d.active && 'opacity-60')}>
              <input value={d.name} onChange={(e) => patchLocal(d.id, { name: e.target.value })} className={TEXT_INPUT} aria-label="Namn" placeholder="Namn" />
              <input value={d.location ?? ''} onChange={(e) => patchLocal(d.id, { location: e.target.value })} className={TEXT_INPUT} aria-label="Plats" placeholder="Plats (valfritt)" />
              <label className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
                <input type="checkbox" checked={d.active} onChange={(e) => patchLocal(d.id, { active: e.target.checked })} className="h-3.5 w-3.5 accent-emerald-600" />
                Aktiv
              </label>
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => saveDepot(d)} disabled={busy} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
                  Spara
                </button>
                <button
                  type="button"
                  onClick={() => removeDepot(d.id)}
                  disabled={busy}
                  aria-label="Ta bort depå"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#e0e8dc] bg-white text-slate-400 transition hover:border-rose-300 hover:text-rose-500 disabled:opacity-50"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          {depots.length === 0 && <p className="py-2 text-center text-[12px] text-slate-400">Inga depåer upplagda än.</p>}

          <form onSubmit={addDepot} className="mt-1 grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ny depå…" className={TEXT_INPUT} aria-label="Namn på ny depå" />
            <input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Plats (valfritt)" className={TEXT_INPUT} aria-label="Plats" />
            <button type="submit" disabled={busy || !newName.trim()} className={PRIMARY} style={{ backgroundColor: 'var(--crm-primary)' }}>
              Lägg till
            </button>
          </form>
        </div>
      )}
    </CrmModal>
  );
}
