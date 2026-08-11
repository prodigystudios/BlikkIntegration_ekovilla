"use client";
import React from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import CrmModal from '@/app/crm/components/CrmModal';
import Input from '@/components/ui/Input';
import { minutesToHours, workedMinutes } from '@/lib/domains/time/hours';
import type { TimeReferenceItem } from '@/lib/domains/time/reference';

// Formuläret för en tidrad. Tre sorter, samma modal: arbetsorder, intern tid, frånvaro.
//
// ⚠️ TIMSUMMAN HÄR ÄR EN FÖRHANDSVISNING, inte sanningen. Servern räknar om minuterna ur klockslagen
// (lib/domains/time/entries.ts) och databasen skriver `hours` med en trigger. Uträkningen delas —
// samma workedMinutes på båda sidor — så siffran stämmer, men den som ändrar värdet på vägen ändrar
// bara vad hen själv ser.
//
// Frånvaro har INGA klockslag: byrån vill ha "Frånvarotimmar", och en halv dag VAB är fyra timmar,
// inte 08:00–12:00.

export type TimeEntryKind = 'work_order' | 'internal' | 'absence';

export type ReferenceData = {
  time_code: TimeReferenceItem[];
  internal_project: TimeReferenceItem[];
  absence_type: TimeReferenceItem[];
};

export type EditableEntry = {
  id: string;
  kind: TimeEntryKind;
  work_date: string;
  work_order_id: string | null;
  internal_project_id: string | null;
  absence_type_id: string | null;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  minutes_worked: number | null;
  time_code_id: string | null;
  note: string | null;
  /** Etiketten för raden jobb, så en redigerad rad går att visa även om schemat ändrats sedan dess. */
  work_order_label?: string | null;
};

type MyJob = { work_order_id: string; order_number: string | null; project_name: string | null; customer: string | null };

const KINDS: Array<{ key: TimeEntryKind; label: string }> = [
  { key: 'work_order', label: 'Arbetsorder' },
  { key: 'internal', label: 'Intern' },
  { key: 'absence', label: 'Frånvaro' },
];

// 'HH:MM:SS' från Postgres → 'HH:MM' som <input type="time"> vill ha.
function toTimeInput(value: string | null): string {
  return value ? value.slice(0, 5) : '';
}

export default function TimeEntryModal({
  reference,
  defaultDate,
  entry,
  onClose,
  onSaved,
}: {
  reference: ReferenceData;
  defaultDate: string;
  /** Satt = redigering, annars ny rad. */
  entry?: EditableEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = React.useMemo(() => createClientComponentClient(), []);

  const [kind, setKind] = React.useState<TimeEntryKind>(entry?.kind ?? 'work_order');
  const [date, setDate] = React.useState(entry?.work_date ?? defaultDate);
  const [start, setStart] = React.useState(toTimeInput(entry?.start_time ?? null) || '07:00');
  const [end, setEnd] = React.useState(toTimeInput(entry?.end_time ?? null) || '16:00');
  const [breakMinutes, setBreakMinutes] = React.useState(String(entry?.break_minutes ?? 30));
  const [absenceHours, setAbsenceHours] = React.useState(
    entry?.kind === 'absence' && entry.minutes_worked ? String(minutesToHours(entry.minutes_worked)) : '8',
  );
  const [workOrderId, setWorkOrderId] = React.useState(entry?.work_order_id ?? '');
  const [internalId, setInternalId] = React.useState(entry?.internal_project_id ?? '');
  const [absenceId, setAbsenceId] = React.useState(entry?.absence_type_id ?? '');
  const [timeCodeId, setTimeCodeId] = React.useState(entry?.time_code_id ?? '');
  const [note, setNote] = React.useState(entry?.note ?? '');

  const [jobs, setJobs] = React.useState<MyJob[]>([]);
  const [jobsLoading, setJobsLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Jobben för det valda datumet. Samma källa som fältvyns feed (get_my_crm_jobs), så listan är
  // exakt de jobb personen faktiskt var schemalagd på — inte en fritextsökning som i Blikk-modalen,
  // där man i praktiken inte kunde välja projekt alls utan ett planerat jobb.
  React.useEffect(() => {
    if (kind !== 'work_order' || !date) return;
    let cancelled = false;
    setJobsLoading(true);
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_my_crm_jobs', { start_date: date, end_date: date });
      if (cancelled) return;
      const unique: MyJob[] = [];
      if (!rpcError) {
        const seen = new Set<string>();
        for (const row of (data ?? []) as any[]) {
          if (!row.work_order_id || seen.has(row.work_order_id)) continue;
          seen.add(row.work_order_id);
          unique.push({
            work_order_id: row.work_order_id,
            order_number: row.fortnox_order_number || row.order_number,
            project_name: row.project_name,
            customer: row.customer,
          });
        }
      }

      // Vid redigering kan schemat ha ändrats sedan raden skrevs, så radens eget jobb saknas i
      // dagens lista. Lägg till det i stället för att tappa det — annars går en gammal rad inte att
      // rätta utan att först byta jobb.
      if (entry?.work_order_id && !unique.some((job) => job.work_order_id === entry.work_order_id)) {
        unique.push({
          work_order_id: entry.work_order_id,
          order_number: null,
          project_name: entry.work_order_label || 'Valt jobb',
          customer: null,
        });
      }

      setJobs(unique);

      // ⚠️ Nollställ valet om det inte längre finns i listan. Utan det behåller formuläret jobbet
      // från FÖREGÅENDE datum när man byter dag: rutan säger "inga jobb schemalagda" medan Spara
      // ändå postar gårdagens arbetsorder. Fel jobb på lönen och på jobbkalkylen.
      setWorkOrderId((current) => (unique.some((job) => job.work_order_id === current) ? current : ''));

      // Ett enda jobb den dagen är det överlägset vanligaste — välj det, så blir en normal
      // dagrapport tre fält och en knapp.
      if (unique.length === 1) setWorkOrderId(unique[0].work_order_id);

      setJobsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, kind, date, entry]);

  const previewMinutes = React.useMemo(() => {
    if (kind === 'absence') {
      const hours = Number(String(absenceHours).replace(',', '.'));
      return Number.isFinite(hours) ? Math.round(hours * 60) : 0;
    }
    return workedMinutes({
      workDate: date,
      startTime: start || null,
      endTime: end || null,
      breakMinutes: Number(breakMinutes) || 0,
    });
  }, [kind, absenceHours, date, start, end, breakMinutes]);

  // Kommentarkravet kommer från referensraden (Blikks commentRequiredWhenTimeReporting), så en
  // internpost som "Övrigt" kan tvinga fram en förklaring.
  const requiresNote = React.useMemo(() => {
    const target = kind === 'internal'
      ? reference.internal_project.find((item) => item.id === internalId)
      : kind === 'absence'
        ? reference.absence_type.find((item) => item.id === absenceId)
        : null;
    return target?.requires_note === true;
  }, [kind, internalId, absenceId, reference]);

  const canSave = previewMinutes > 0
    && (kind !== 'work_order' || !!workOrderId)
    && (kind !== 'internal' || !!internalId)
    && (kind !== 'absence' || !!absenceId)
    && (!requiresNote || note.trim().length > 0)
    && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        kind,
        work_date: date,
        work_order_id: kind === 'work_order' ? workOrderId : null,
        internal_project_id: kind === 'internal' ? internalId : null,
        absence_type_id: kind === 'absence' ? absenceId : null,
        start_time: kind === 'absence' ? null : start,
        end_time: kind === 'absence' ? null : end,
        break_minutes: kind === 'absence' ? 0 : Number(breakMinutes) || 0,
        hours: kind === 'absence' ? Number(String(absenceHours).replace(',', '.')) : null,
        time_code_id: timeCodeId || null,
        note: note.trim() || null,
      };
      const res = await fetch(entry ? `/api/time/entries/${entry.id}` : '/api/time/entries', {
        method: entry ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte spara'); return; }
      onSaved();
    } catch {
      setError('Kunde inte spara');
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel={entry ? 'Redigera tidrad' : 'Rapportera tid'}
      maxWidth="sm:max-w-[560px]"
      header={
        <>
          <h2 className="text-lg font-bold text-slate-900">{entry ? 'Redigera tidrad' : 'Rapportera tid'}</h2>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {kind === 'absence'
              ? 'Frånvaro anges i timmar — inga klockslag behövs.'
              : 'Ange start och slut. Rasten dras av i summan.'}
          </p>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-solid border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {saving ? 'Sparar…' : 'Spara'}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        {error ? (
          <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        ) : null}

        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {KINDS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setKind(option.key)}
              className={
                'flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ' +
                (kind === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="grid gap-1">
          <span className="text-xs font-semibold text-slate-600">Datum</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {kind === 'absence' ? (
          <>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">Frånvaroorsak</span>
              <select
                value={absenceId}
                onChange={(e) => setAbsenceId(e.target.value)}
                className="rounded-xl border border-solid border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Välj…</option>
                {reference.absence_type.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">Antal timmar</span>
              <Input
                inputMode="decimal"
                value={absenceHours}
                onChange={(e) => setAbsenceHours(e.target.value)}
                placeholder="8"
              />
            </label>
          </>
        ) : (
          <>
            {kind === 'work_order' ? (
              <div className="grid gap-1">
                <span className="text-xs font-semibold text-slate-600">Jobb</span>
                {jobsLoading ? (
                  <span className="text-sm text-slate-400">Hämtar dagens jobb…</span>
                ) : jobs.length === 0 ? (
                  <span className="rounded-xl border border-solid border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Inga jobb schemalagda på dig den dagen. Rapportera som <strong>Intern</strong> om du jobbat ändå.
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {jobs.map((job) => (
                      <button
                        key={job.work_order_id}
                        type="button"
                        onClick={() => setWorkOrderId(job.work_order_id)}
                        className={
                          'rounded-full border border-solid px-3 py-1.5 text-left text-sm transition ' +
                          (workOrderId === job.work_order_id
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')
                        }
                      >
                        {job.order_number ? `#${job.order_number} · ` : ''}{job.customer || job.project_name || 'Jobb'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-600">Internprojekt</span>
                <select
                  value={internalId}
                  onChange={(e) => setInternalId(e.target.value)}
                  className="rounded-xl border border-solid border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Välj…</option>
                  {reference.internal_project.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid grid-cols-3 gap-2">
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-600">Start</span>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-600">Slut</span>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-600">Rast (min)</span>
                <Input inputMode="numeric" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
              </label>
            </div>
          </>
        )}

        {reference.time_code.length > 0 ? (
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">Tidkod (valfri)</span>
            <select
              value={timeCodeId}
              onChange={(e) => setTimeCodeId(e.target.value)}
              className="rounded-xl border border-solid border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {reference.time_code.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="grid gap-1">
          <span className="text-xs font-semibold text-slate-600">
            Anteckning{requiresNote ? ' (krävs)' : ''}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="rounded-xl border border-solid border-slate-200 px-3 py-2 text-sm"
            placeholder="Valfri information om dagen"
          />
        </label>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {kind === 'absence' ? 'Frånvaro' : 'Arbetad tid'}:{' '}
          <strong>{minutesToHours(previewMinutes).toString().replace('.', ',')} h</strong>
          {kind !== 'absence' && Number(breakMinutes) > 0 ? (
            <span className="text-slate-500"> (efter {breakMinutes} min rast)</span>
          ) : null}
        </div>
      </div>
    </CrmModal>
  );
}
