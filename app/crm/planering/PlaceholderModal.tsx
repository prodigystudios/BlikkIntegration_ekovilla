'use client';

import { useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { OpsTruck } from '@/lib/domains/planning/types';
import type { JobType } from '@/lib/domains/planning/jobTypes';

export type PlaceholderInput = {
  title: string;
  customer: string | null;
  truck_id: string;
  start_day: string;
  end_day: string;
  job_type: string | null;
};

// Create a placeholder card — a booked truck/day slot before the real CRM work order exists.
export default function PlaceholderModal({
  trucks,
  jobTypes,
  defaultDay,
  onClose,
  onCreate,
}: {
  trucks: OpsTruck[];
  jobTypes: JobType[];
  defaultDay: string;
  onClose: () => void;
  onCreate: (input: PlaceholderInput) => Promise<void> | void;
}) {
  const [title, setTitle] = useState('');
  const [customer, setCustomer] = useState('');
  const [truckId, setTruckId] = useState(trucks[0]?.id ?? '');
  const [startDay, setStartDay] = useState(defaultDay);
  const [endDay, setEndDay] = useState(defaultDay);
  const [jobType, setJobType] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = title.trim().length > 0 && truckId && startDay && endDay && endDay >= startDay;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        customer: customer.trim() || null,
        truck_id: truckId,
        start_day: startDay,
        end_day: endDay,
        job_type: jobType || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const field = 'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-2.5 text-[12.5px] text-slate-700 outline-none transition focus:border-emerald-500';

  return (
    <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="planning-modal w-full max-w-sm rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-0.5 text-[14px] font-bold text-slate-900">Ny platshållare</h3>
        <p className="mb-3 text-[11px] text-slate-500">Boka en bil/dag innan den riktiga arbetsordern finns.</p>

        <div className="grid gap-2.5">
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Titel</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="t.ex. Vind Ekvägen 4" className={field} autoFocus />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Kund (valfritt)</span>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} className={field} />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Bil</span>
            <select value={truckId} onChange={(e) => setTruckId(e.target.value)} className={field}>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-slate-500">Från</span>
              <input type="date" value={startDay} onChange={(e) => { setStartDay(e.target.value); if (endDay < e.target.value) setEndDay(e.target.value); }} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-slate-500">Till</span>
              <input type="date" value={endDay} min={startDay} onChange={(e) => setEndDay(e.target.value)} className={field} />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Jobbtyp (valfritt)</span>
            <select value={jobType} onChange={(e) => setJobType(e.target.value)} className={field}>
              <option value="">—</option>
              {jobTypes.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className={cn(crm.ghostButton, 'flex-1')}>Avbryt</button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="flex-1 rounded-lg border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Skapar…' : 'Skapa'}
          </button>
        </div>
      </div>
    </div>
  );
}
