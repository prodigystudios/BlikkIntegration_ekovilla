"use client";

import { useState } from 'react';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate, formatDateTime } from '@/app/crm/lib/format';
import { DEFAULT_BREAK_MINUTES, minutesToHours, workedMinutes } from '@/lib/domains/time/hours';

// Kontorets Tid-flik. Den skriver i `crm_time_entries` — SAMMA tabell som löneunderlaget — och
// därför fångar den klockslag sedan 2026-08-14. Ett timtal går inte att räkna övertid eller OB på:
// nio timmar säger inte om de låg 07–16 eller 14–23, och lönebyrån härleder båda ur just start och
// slut.
//
// Fliken är fortfarande "min egen tid på det här jobbet": RLS tillåter bara egna rader, så knapparna
// för att ändra och ta bort visas bara på dem.
//
// Timsumman här är en FÖRHANDSVISNING. Servern räknar om minuterna ur klockslagen med samma
// funktion (workedMinutes → buildTimeEntryRow), och `hours` skrivs av en databastrigger — klientens
// siffra kan alltså aldrig bli någons lön.

export type TimeEntryItem = {
  id: string;
  work_order_id: string;
  user_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number | null;
  hours: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  user?: { full_name?: string | null } | null;
};

export type TimeDraft = { work_date: string; start_time: string; end_time: string; break_minutes: string; note: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(): TimeDraft {
  // Utgångsvärdet delas med /tid — se DEFAULT_BREAK_MINUTES för varför det är en konstant och inte
  // en literal per formulär.
  return {
    work_date: todayIso(),
    start_time: '',
    end_time: '',
    break_minutes: String(DEFAULT_BREAK_MINUTES),
    note: '',
  };
}

/** Postgres `time` kommer som 'HH:MM:SS'; <input type="time"> vill ha 'HH:MM'. */
function toClockInput(value: string | null): string {
  return value ? value.slice(0, 5) : '';
}

/**
 * Förhandsvisning av arbetad tid.
 *
 * Tre utfall, inte två: ofyllt, orimligt och räknat. Slås de två första ihop står det "fyll i
 * start- och sluttid" på fält som ÄR ifyllda, och den verkliga orsaken — att rasten är längre än
 * passet — dyker upp först som ett rött meddelande när man redan tryckt spara.
 */
function draftHours(draft: TimeDraft): { tone: 'hint' | 'error' | 'ok'; text: string } {
  if (!draft.start_time || !draft.end_time) return { tone: 'hint', text: 'Fyll i start- och sluttid.' };
  const minutes = workedMinutes({
    workDate: draft.work_date,
    startTime: draft.start_time,
    endTime: draft.end_time,
    breakMinutes: Number(draft.break_minutes || 0),
  });
  if (minutes <= 0) return { tone: 'error', text: 'Rasten är längre än passet.' };
  return { tone: 'ok', text: `${minutesToHours(minutes).toFixed(2).replace('.', ',')} h` };
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

function DraftFields({ draft, onChange }: { draft: TimeDraft; onChange: (next: TimeDraft) => void }) {
  const preview = draftHours(draft);
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-slate-600">
          <span className={crm.sectionTitle}>Datum</span>
          <Input value={draft.work_date} onChange={(e) => onChange({ ...draft, work_date: e.target.value })} type="date" />
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          <span className={crm.sectionTitle}>Rast (min)</span>
          <Input value={draft.break_minutes} onChange={(e) => onChange({ ...draft, break_minutes: e.target.value })} inputMode="numeric" placeholder={String(DEFAULT_BREAK_MINUTES)} />
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          <span className={crm.sectionTitle}>Starttid</span>
          <Input value={draft.start_time} onChange={(e) => onChange({ ...draft, start_time: e.target.value })} type="time" />
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          <span className={crm.sectionTitle}>Sluttid</span>
          <Input value={draft.end_time} onChange={(e) => onChange({ ...draft, end_time: e.target.value })} type="time" />
        </label>
      </div>
      <p className={cn('m-0 text-xs', preview.tone === 'error' ? 'text-rose-600' : 'text-slate-500')}>
        {preview.tone === 'ok'
          ? <>Arbetad tid efter rastavdrag: <strong className="text-slate-700">{preview.text}</strong></>
          : preview.text}
      </p>
    </>
  );
}

export default function WorkOrderTimeTab({ entries, loading, totalHours, currentUserId, onCreate, onUpdate, onDelete }: Props) {
  const [createDraft, setCreateDraft] = useState<TimeDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TimeDraft>(emptyDraft);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function submitCreate() {
    setCreating(true);
    const ok = await onCreate(createDraft);
    if (ok) setCreateDraft(emptyDraft());
    setCreating(false);
  }

  function startEdit(item: TimeEntryItem) {
    setConfirmDeleteId(null);
    setEditingId(item.id);
    setEditDraft({
      work_date: item.work_date,
      start_time: toClockInput(item.start_time),
      end_time: toClockInput(item.end_time),
      break_minutes: String(item.break_minutes ?? 0),
      note: item.note || '',
    });
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
              <div key={item.id} className="grid gap-2 rounded-xl border border-solid border-emerald-200 bg-[#f1f5ee] px-3 py-3">
                <DraftFields draft={editDraft} onChange={setEditDraft} />
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
          const start = toClockInput(item.start_time);
          const end = toClockInput(item.end_time);
          return (
            <div key={item.id} className="grid gap-1 rounded-xl border border-solid border-[#e0e8dc] bg-[#f1f5ee] px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <strong className="text-slate-900">{item.user?.full_name || 'Medarbetare'}</strong>
                <span className="text-slate-500">
                  {/* Rader från före klockslagskravet har bara ett timtal. De visas som de är i
                      stället för att gömmas — de ska rättas, inte försvinna. */}
                  {start && end ? `${start}–${end} · ` : null}{item.hours} h · {formatDate(item.work_date)}
                </span>
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
        <DraftFields draft={createDraft} onChange={setCreateDraft} />
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
