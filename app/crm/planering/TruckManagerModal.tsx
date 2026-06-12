'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import { useEntityCrud } from './useEntityCrud';
import { TrashIcon } from './managerModalUi';
import type { OpsTruck, OpsDepot } from '@/lib/domains/planning/types';

const API = '/api/crm/planering/trucks';
const DEPOTS_API = '/api/crm/planering/depots';

// Fleet management: rename/recolor/(de)activate/assign-depot, add or remove. onChanged refreshes the
// board's active-truck lanes after a change.
export default function TruckManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { items: trucks, loading, busy, patchLocal, save, remove, add } = useEntityCrud<OpsTruck>({
    api: API,
    listKey: 'trucks',
    toPayload: (t) => ({ name: t.name, color: t.color, active: t.active, depot_id: t.depot_id }),
    labels: { saveFail: 'Kunde inte spara bilen', removeFail: 'Kunde inte ta bort bilen', addFail: 'Kunde inte lägga till bilen' },
  });
  const [depots, setDepots] = useState<OpsDepot[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3f6f52');

  // Active depots for the per-truck depot picker (separate collection from trucks).
  useEffect(() => {
    let active = true;
    fetch(DEPOTS_API, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (active && j.ok) setDepots((j.data.depots as OpsDepot[]).filter((d) => d.active));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function onSave(t: OpsTruck) {
    if (await save(t)) onChanged();
  }
  async function onRemove(id: string) {
    if (await remove(id)) onChanged();
  }
  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await add({ name: newName.trim(), color: newColor })) {
      setNewName('');
      onChanged();
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
                <input type="color" value={t.color || '#94a3b8'} onChange={(e) => patchLocal(t.id, { color: e.target.value })} className={crm.colorInput} aria-label="Färg" />
                <input value={t.name} onChange={(e) => patchLocal(t.id, { name: e.target.value })} className={crm.input} placeholder="Bilens namn" aria-label="Namn" />
              </div>
              <div className="mt-2.5 flex flex-wrap items-end gap-3">
                <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                  <label className="px-0.5 text-[11px] font-semibold text-slate-500">Depå</label>
                  <select
                    value={t.depot_id ?? ''}
                    onChange={(e) => patchLocal(t.id, { depot_id: e.target.value || null })}
                    aria-label="Depå"
                    className={crm.select}
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
                <button type="button" onClick={() => onRemove(t.id)} disabled={busy} className={crm.dangerButton}>
                  <TrashIcon />
                  Ta bort
                </button>
                <button type="button" onClick={() => onSave(t)} disabled={busy} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>
                  Spara
                </button>
              </div>
            </div>
          ))}

          {trucks.length === 0 && <p className="py-2 text-center text-[13px] text-slate-400">Inga bilar upplagda än.</p>}

          <form onSubmit={onAdd} className="rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-3">
            <p className="mb-2 px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Lägg till ny bil</p>
            <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2.5">
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className={crm.colorInput} aria-label="Färg" />
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bilens namn…" className={crm.input} aria-label="Namn på ny bil" />
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
