"use client";
import React from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import CrmModal from '@/app/crm/components/CrmModal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { cn } from '@/lib/shared/cn';
import { DEFAULT_BREAK_MINUTES, minutesToHours, parseBreakMinutes, workedMinutes } from '@/lib/domains/time/hours';
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
//
// ⚠️ Det här är CRM-modalen och den används BARA av app/tid/TidClient.tsx. Blikks tidrapportering
// har sin egen, components/dashboard/TimeReportModal.tsx, som inte delar en rad med den här. Att
// ändra här kan alltså inte röra vägen mot Blikk — kontrollera det innan du tror något annat.
//
// FORM (omdesign 2026-08-14, i takt med /tid): sage-paletten i stället för slate, och summan står
// DÄR DEN UPPSTÅR — i passblocket, bredvid rasten — inte i en grå ruta längst ner under
// anteckningen, dit man på en telefon behöver skrolla för att se om man skrev rätt.

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

// Fältstil på ett ställe.

/**
 * Etikett för ETT FÄLT — medvetet inte `crm.sectionTitle`.
 *
 * Tokenen är en avdelningsrubrik: 10 px i slate-400, vilket är ungefär 2,9:1 mot vitt och alltså
 * under WCAG AA:s 4,5:1 utan att kvala in som stor text. Det duger för ett ord som märker upp ett
 * stycke man ändå läser, men inte för texten som talar om vad man ska skriva i rutan — allra minst
 * i en app som används på en telefon i dagsljus. Samma familj (versaler, spärrad), mörkare ton:
 * slate-600 ligger runt 7:1 mot alla ytor formuläret använder.
 */
const LABEL = 'text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600';

// 'HH:MM:SS' från Postgres → 'HH:MM' som <input type="time"> vill ha.
function toTimeInput(value: string | null): string {
  return value ? value.slice(0, 5) : '';
}

function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2).replace('.', ',');
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
  // Delad default med arbetsorderns tidflik — se DEFAULT_BREAK_MINUTES. `??` och inte `||`: en
  // sparad rad med rast 0 ska behålla sin nolla, annars hade varje redigering av ett rastfritt pass
  // tyst dragit av en timme.
  const [breakMinutes, setBreakMinutes] = React.useState(String(entry?.break_minutes ?? DEFAULT_BREAK_MINUTES));
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

  // ⚠️ parseBreakMinutes, ALDRIG `Number(x) || 0` — skälet står på funktionen. Null betyder "går
  // inte att tolka", och då ska summan visa noll och spara-knappen vara stängd. Med `|| 0` blev
  // "0,5" i stället en rast på noll minuter: en timme extra betald tid, utan ett ord i gränssnittet
  // och utan ett spår i ändringsloggen. Rättningsmodalen har haft spärren sedan den skrevs.
  const parsedBreak = parseBreakMinutes(breakMinutes);

  const previewMinutes = React.useMemo(() => {
    if (kind === 'absence') {
      const hours = Number(String(absenceHours).replace(',', '.'));
      return Number.isFinite(hours) ? Math.round(hours * 60) : 0;
    }
    if (parsedBreak === null) return 0;
    return workedMinutes({
      workDate: date,
      startTime: start || null,
      endTime: end || null,
      breakMinutes: parsedBreak,
    });
  }, [kind, absenceHours, date, start, end, parsedBreak]);

  // ⚠️ `grossMinutes` läser `end <= start` som ett pass över midnatt, så identiska klockslag ger
  // exakt 1440 minuter — och serverns guard är `> 1440`, alltså exklusiv. Ett dubbeltryck eller ett
  // klistrat klockslag hade skrivit ett DYGN på den egna månaden, med bara siffran i rutan som
  // signal. Samma spärr, och samma skäl, som i rättningsmodalen.
  const sameClock = kind !== 'absence' && !!start && start === end;

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
    && !sameClock
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
        break_minutes: kind === 'absence' ? 0 : (parsedBreak ?? 0),
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
            className="py-2.5 flex-1 rounded-xl border border-solid border-[#dbe4d6] bg-white text-sm font-semibold text-slate-600 transition hover:border-slate-400 sm:flex-none sm:px-5"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="py-2.5 flex-1 rounded-xl text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
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

        {/* Sorten först: den avgör vilka fält som ens är relevanta nedanför. */}
        <div className="flex gap-1 rounded-xl bg-[#eef3ea] p-1">
          {KINDS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setKind(option.key)}
              aria-pressed={kind === option.key}
              className={cn(
                'px-2 py-2 flex-1 rounded-lg text-sm font-semibold transition',
                kind === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="grid gap-1">
          <span className={LABEL}>Datum</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {kind === 'absence' ? (
          <>
            <label className="grid gap-1">
              <span className={LABEL}>Frånvaroorsak</span>
              {/* aria-label MÅSTE ordagrant innehålla den synliga etiketten. `role="combobox"`
                  förbjuder namn från innehåll, så namnet kommer från det omslutande `<label>` —
                  men sätter vi ändå en aria-label vinner den, och avviker den från etiketten faller
                  WCAG 2.5.3 (Label in Name): rösstyrning letar efter det man SER. Den står kvar som
                  garanti för att fältet aldrig blir namnlöst, inte för att etiketten inte når fram. */}
              <Select value={absenceId} onChange={(e) => setAbsenceId(e.target.value)} aria-label="Frånvaroorsak">
                <option value="">Välj…</option>
                {reference.absence_type.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
            </label>
            {/* Ingen summering här: talet man skriver ÄR summan. Att eka det i en egen ruta hade
                sett ut som en uträkning utan att vara en. */}
            <label className="grid gap-1">
              <span className={LABEL}>Antal timmar</span>
              <Input inputMode="decimal" value={absenceHours} onChange={(e) => setAbsenceHours(e.target.value)} placeholder="8" />
              {/* Utan den här raden blir ett oläsbart timtal ett tyst avstängt Spara: knappen
                  slocknar och ingenting säger varför. */}
              {previewMinutes <= 0 ? (
                <span className="text-sm text-rose-600">Ange antal timmar som en siffra, t.ex. 4 eller 7,5.</span>
              ) : null}
            </label>
          </>
        ) : (
          <>
            {kind === 'work_order' ? (
              <div className="grid gap-1.5">
                <span className={LABEL}>Jobb</span>
                {jobsLoading ? (
                  <span className="text-sm text-slate-500">Hämtar dagens jobb…</span>
                ) : jobs.length === 0 ? (
                  // Tomt läge som går att agera på, inte bara en upplysning: knappen gör det den
                  // föreslår, i stället för att be någon leta rätt på fliken själv.
                  <div className="grid gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p className="m-0 text-sm text-amber-900">Inga jobb schemalagda på dig den dagen.</p>
                    <button
                      type="button"
                      onClick={() => setKind('internal')}
                      className="px-3 py-1.5 justify-self-start rounded-lg border border-solid border-amber-300 bg-white text-sm font-semibold text-amber-900 transition hover:border-amber-400"
                    >
                      Rapportera som intern tid
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    {jobs.map((job) => (
                      <button
                        key={job.work_order_id}
                        type="button"
                        onClick={() => setWorkOrderId(job.work_order_id)}
                        aria-pressed={workOrderId === job.work_order_id}
                        className={cn(
                          'px-3 py-2.5 justify-start text-left w-full rounded-xl border border-solid text-sm transition',
                          workOrderId === job.work_order_id
                            ? 'border-transparent text-white shadow-sm'
                            : 'border-[#dbe4d6] bg-white text-slate-700 hover:border-slate-400',
                        )}
                        style={workOrderId === job.work_order_id ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                      >
                        {job.order_number ? `#${job.order_number} · ` : ''}{job.customer || job.project_name || 'Jobb'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <label className="grid gap-1">
                <span className={LABEL}>Internprojekt</span>
                <Select value={internalId} onChange={(e) => setInternalId(e.target.value)} aria-label="Internprojekt">
                  <option value="">Välj…</option>
                  {reference.internal_project.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </Select>
              </label>
            )}

            {/* Passet i ett block, och SUMMAN INUTI DET. Den var tidigare en grå ruta längst ner,
                efter anteckningen — alltså utanför skärmen på en telefon, trots att den är hela
                svaret på "skrev jag rätt?". Nu står den bredvid rasten som drar av den. */}
            <div className="grid gap-3 rounded-2xl border border-solid border-[#e0e8dc] bg-[#f6f9f4] p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className={LABEL}>Start</span>
                  <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="grid gap-1">
                  <span className={LABEL}>Slut</span>
                  <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                </label>
              </div>

              <div className="flex items-end justify-between gap-3">
                <label className="grid gap-1">
                  <span className={LABEL}>Rast (min)</span>
                  <span className="block w-24">
                    <Input inputMode="numeric" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
                  </span>
                </label>
                {/* shrink-0 + nowrap: flexbarn krymper under sitt innehåll som standard, så både
                    etiketten och talet bröts mitt itu — "8,50" på en rad och "h" på nästa. Talet är
                    stort för att det är blockets svar, inte för att det ska ta plats; text-xl
                    räcker och lämnar rummet åt rastfältet bredvid. */}
                <div className="shrink-0 text-right">
                  <div className={cn(LABEL, 'whitespace-nowrap')}>Arbetad tid</div>
                  <div className={cn('whitespace-nowrap text-xl font-bold tabular-nums leading-tight', previewMinutes > 0 ? 'text-slate-900' : 'text-slate-500')}>
                    {formatHours(previewMinutes)} h
                  </div>
                </div>
              </div>

              {/* Fyra lägen, inte två. Tomt klockslag, samma klockslag, en otolkbar rast och en för
                  lång rast ger alla noll minuter i summan, men bara ett av dem handlar om rasten —
                  och att skylla på rasten när fältet är tomt skickar folk att ändra fel sak.
                  Ordningen och orden är rättningsmodalens, så samma fel läses likadant. */}
              {!start || !end ? (
                <p className="m-0 text-sm text-slate-500">Fyll i start- och sluttid.</p>
              ) : sameClock ? (
                <p className="m-0 text-sm text-rose-600">Start och slut är samma klockslag.</p>
              ) : parsedBreak === null ? (
                <p className="m-0 text-sm text-rose-600">Rasten måste vara ett helt antal minuter.</p>
              ) : previewMinutes <= 0 ? (
                <p className="m-0 text-sm text-rose-600">Rasten är längre än passet.</p>
              ) : null}
            </div>
          </>
        )}

        {reference.time_code.length > 0 ? (
          <label className="grid gap-1">
            <span className={LABEL}>Tidkod (valfri)</span>
            <Select value={timeCodeId} onChange={(e) => setTimeCodeId(e.target.value)} aria-label="Tidkod (valfri)">
              <option value="">—</option>
              {reference.time_code.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          </label>
        ) : null}

        <label className="grid gap-1">
          <span className={LABEL}>Anteckning{requiresNote ? ' (krävs)' : ''}</span>
          {/* `min-h-0` upphäver hus-basens `min-h-[120px]` — samma tailwind-merge-grupp, så den
              vinner, och `rows={2}` får bestämma höjden. Rutan ska vara låg: modalen måste rymmas
              på en telefonskärm. (Det är den lagliga varianten av överstyrningen — `h-*` hade
              hamnat i en ANNAN grupp och min-height hade vunnit tyst.) Bytet från en handskriven
              klass ger hover, grön fokusring och disabled-läge som fälten runt omkring. */}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="min-h-0"
            placeholder="Valfri information om dagen"
          />
        </label>
      </div>
    </CrmModal>
  );
}
