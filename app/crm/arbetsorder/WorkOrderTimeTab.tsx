"use client";

import { useState } from 'react';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate, formatDateTime } from '@/app/crm/lib/format';

export type TimeEntryItem = {
  id: string;
  work_order_id: string;
  user_id: string;
  work_date: string;
  hours: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  user?: { full_name?: string | null } | null;
};

export type TimeDraft = { work_date: string; hours: string; note: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type Props = {
  entries: TimeEntryItem[];
  loading: boolean;
  totalHours: number;
  currentUserId: string | null;
  onCreate: (data: TimeDraft) => Promise<boolean>;
  onUpdate: (id: string, data: TimeDraft) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
};

export default function WorkOrderTimeTab({ entries, loading, totalHours, currentUserId, onCreate, onUpdate, onDelete }: Props) {
  const [createDraft, setCreateDraft] = useState<TimeDraft>({ work_date: todayIso(), hours: '', note: '' });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TimeDraft>({ work_date: '', hours: '', note: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function submitCreate() {
    setCreating(true);
    const ok = await onCreate(createDraft);
    if (ok) setCreateDraft({ work_date: todayIso(), hours: '', note: '' });
    setCreating(false);
  }

  function startEdit(item: TimeEntryItem) {
    setConfirmDeleteId(null);
    setEditingId(item.id);
    setEditDraft({ work_date: item.work_date, hours: String(item.hours), note: item.note || '' });
  }

  async function submitEdit(id: string) {
    setBusyId(id);
    const ok = await onUpdate(id, editDraft);
    if (ok) setEditingId(null);
    setBusyId(null);
  }

  async function confirmDelete(id: string) {
    setBusyId(id);
    await onDelete(id);
    setBusyId(null);
    setConfirmDeleteId(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className={cn(crm.cardInner, 'grid gap-3')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={crm.sectionTitle}>Tidrapporter</p>
          <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{totalHours.toFixed(1)} h totalt</span>
        </div>
        {loading ? <div className="text-sm text-slate-500">Laddar tid…</div> : null}
        {!loading && entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-6 text-sm text-slate-500">Ingen tid rapporterad ännu.</div>
        ) : null}
        {!loading ? entries.map((item) => {
          const isOwn = !!currentUserId && item.user_id === currentUserId;
          const isEditing = editingId === item.id;
          if (isEditing) {
            return (
              <div key={item.id} className="grid gap-2 rounded-xl border border-emerald-200 bg-[#f1f5ee] px-3 py-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={editDraft.work_date} onChange={(e) => setEditDraft((c) => ({ ...c, work_date: e.target.value }))} type="date" />
                  <Input value={editDraft.hours} onChange={(e) => setEditDraft((c) => ({ ...c, hours: e.target.value }))} inputMode="decimal" placeholder="8" />
                </div>
                <Textarea value={editDraft.note} onChange={(e) => setEditDraft((c) => ({ ...c, note: e.target.value }))} rows={2} placeholder="Vad gjordes?" />
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setEditingId(null)} className={crm.ghostButton}>Avbryt</button>
                  <button type="button" onClick={() => submitEdit(item.id)} disabled={busyId === item.id} className={cn(crm.saveButton, 'h-9 w-auto px-4')}>
                    {busyId === item.id ? 'Sparar…' : 'Spara'}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={item.id} className="grid gap-1 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <strong className="text-slate-900">{item.user?.full_name || 'Medarbetare'}</strong>
                <span className="text-slate-500">{item.hours} h · {formatDate(item.work_date)}</span>
              </div>
              {item.note ? <div className="text-slate-600">{item.note}</div> : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">Registrerad {formatDateTime(item.created_at)}</span>
                {isOwn ? (
                  confirmDeleteId === item.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Ta bort?</span>
                      <button type="button" onClick={() => confirmDelete(item.id)} disabled={busyId === item.id} className="font-semibold text-rose-600 hover:text-rose-700">Ja</button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-slate-400 hover:text-slate-600">Nej</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-3 text-xs">
                      <button type="button" onClick={() => startEdit(item)} className="font-medium text-slate-500 hover:text-slate-800">Redigera</button>
                      <button type="button" onClick={() => setConfirmDeleteId(item.id)} className="font-medium text-slate-400 hover:text-rose-500">Ta bort</button>
                    </span>
                  )
                ) : null}
              </div>
            </div>
          );
        }) : null}
      </div>

      <div className={cn(crm.cardInner, 'grid gap-3 lg:content-start')}>
        <p className={crm.sectionTitle}>Ny tidrad</p>
        <label className="grid gap-1 text-sm text-slate-600">
          <span className={crm.sectionTitle}>Datum</span>
          <Input value={createDraft.work_date} onChange={(e) => setCreateDraft((c) => ({ ...c, work_date: e.target.value }))} type="date" />
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          <span className={crm.sectionTitle}>Timmar</span>
          <Input value={createDraft.hours} onChange={(e) => setCreateDraft((c) => ({ ...c, hours: e.target.value }))} inputMode="decimal" placeholder="8" />
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          <span className={crm.sectionTitle}>Kommentar</span>
          <Textarea value={createDraft.note} onChange={(e) => setCreateDraft((c) => ({ ...c, note: e.target.value }))} rows={4} placeholder="Vad gjordes?" />
        </label>
        <button type="button" onClick={submitCreate} disabled={creating} className={crm.saveButton}>
          {creating ? 'Sparar tid…' : 'Rapportera tid'}
        </button>
      </div>
    </div>
  );
}
