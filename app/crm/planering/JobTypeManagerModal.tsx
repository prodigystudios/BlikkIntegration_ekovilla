'use client';

import { useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import { useEntityCrud } from './useEntityCrud';
import { TrashIcon } from './managerModalUi';
import type { JobTypeRow } from '@/lib/domains/planning/jobTypes';

const API = '/api/crm/planering/job-types';

// Job-type management: rename, recolor, (de)activate or add/remove. The stable key is server-managed.
// onChanged refreshes the board's picker + chips.
export default function JobTypeManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { items: types, loading, busy, patchLocal, save, remove, add } = useEntityCrud<JobTypeRow>({
    api: API,
    listKey: 'jobTypes',
    toPayload: (t) => ({ label: t.label, color: t.color, active: t.active }),
    labels: { saveFail: 'Kunde inte spara jobbtypen', removeFail: 'Kunde inte ta bort jobbtypen', addFail: 'Kunde inte lägga till jobbtypen' },
  });
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#0d9488');

  async function onSave(t: JobTypeRow) {
    if (await save(t)) onChanged();
  }
  async function onRemove(id: string) {
    if (await remove(id)) onChanged();
  }
  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    if (await add({ label: newLabel.trim(), color: newColor })) {
      setNewLabel('');
      onChanged();
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
                <input type="color" value={t.color} onChange={(e) => patchLocal(t.id, { color: e.target.value })} className={crm.colorInput} aria-label="Färg" />
                <input value={t.label} onChange={(e) => patchLocal(t.id, { label: e.target.value })} className={crm.input} placeholder="Jobbtypens namn" aria-label="Namn" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#eef3eb] pt-2.5">
                <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#e0e8dc] bg-[#f9fbf7] px-3 text-[13px] font-semibold text-slate-600">
                  <input type="checkbox" checked={t.active} onChange={(e) => patchLocal(t.id, { active: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                  Aktiv
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onRemove(t.id)} disabled={busy} className={crm.dangerButton}>
                    <TrashIcon />
                    Ta bort
                  </button>
                  <button type="button" onClick={() => onSave(t)} disabled={busy} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>
                    Spara
                  </button>
                </div>
              </div>
            </div>
          ))}

          {types.length === 0 && <p className="py-2 text-center text-[13px] text-slate-400">Inga jobbtyper upplagda än.</p>}

          <form onSubmit={onAdd} className="rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-3">
            <p className="mb-2 px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Lägg till ny jobbtyp</p>
            <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2.5">
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className={crm.colorInput} aria-label="Färg" />
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Jobbtypens namn…" className={crm.input} aria-label="Namn på ny jobbtyp" />
              <button type="submit" disabled={busy || !newLabel.trim()} className={crm.formButton} style={{ backgroundColor: 'var(--crm-primary)' }}>
                Lägg till
              </button>
            </div>
          </form>
        </div>
      )}
    </CrmModal>
  );
}
