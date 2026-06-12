'use client';

import { useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import { useEntityCrud } from './useEntityCrud';
import { TrashIcon } from './managerModalUi';
import type { OpsDepot } from '@/lib/domains/planning/types';

const API = '/api/crm/planering/depots';

// Depot management: rename/relocate/(de)activate, add or remove. onChanged refreshes the truck
// pickers + board after a change.
export default function DepotManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { items: depots, loading, busy, patchLocal, save, remove, add } = useEntityCrud<OpsDepot>({
    api: API,
    listKey: 'depots',
    toPayload: (d) => ({ name: d.name, location: d.location, active: d.active }),
    labels: { saveFail: 'Kunde inte spara depån', removeFail: 'Kunde inte ta bort depån', addFail: 'Kunde inte lägga till depån' },
  });
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');

  async function onSave(d: OpsDepot) {
    if (await save(d)) onChanged();
  }
  async function onRemove(id: string) {
    if (await remove(id)) onChanged();
  }
  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await add({ name: newName.trim(), location: newLocation.trim() || null })) {
      setNewName('');
      setNewLocation('');
      onChanged();
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
        <div className="grid gap-3">
          {depots.map((d) => (
            <div key={d.id} className={cn('rounded-xl border border-[#e0e8dc] bg-white p-3', !d.active && 'opacity-60')}>
              <div className="grid grid-cols-2 gap-2.5">
                <input value={d.name} onChange={(e) => patchLocal(d.id, { name: e.target.value })} className={crm.input} placeholder="Namn" aria-label="Namn" />
                <input value={d.location ?? ''} onChange={(e) => patchLocal(d.id, { location: e.target.value })} className={crm.input} placeholder="Plats (valfritt)" aria-label="Plats" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#eef3eb] pt-2.5">
                <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#e0e8dc] bg-[#f9fbf7] px-3 text-[13px] font-semibold text-slate-600">
                  <input type="checkbox" checked={d.active} onChange={(e) => patchLocal(d.id, { active: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                  Aktiv
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onRemove(d.id)} disabled={busy} className={crm.dangerButton}>
                    <TrashIcon />
                    Ta bort
                  </button>
                  <button type="button" onClick={() => onSave(d)} disabled={busy} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>
                    Spara
                  </button>
                </div>
              </div>
            </div>
          ))}

          {depots.length === 0 && <p className="py-2 text-center text-[13px] text-slate-400">Inga depåer upplagda än.</p>}

          <form onSubmit={onAdd} className="rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-3">
            <p className="mb-2 px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Lägg till ny depå</p>
            <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2.5">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Namn…" className={crm.input} aria-label="Namn på ny depå" />
              <input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Plats (valfritt)" className={crm.input} aria-label="Plats" />
              <button type="submit" disabled={busy || !newName.trim()} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>
                Lägg till
              </button>
            </div>
          </form>
        </div>
      )}
    </CrmModal>
  );
}
