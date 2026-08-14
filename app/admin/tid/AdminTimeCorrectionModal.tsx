"use client";
import React from 'react';
import CrmModal from '@/app/crm/components/CrmModal';
import Input from '../../../components/ui/Input';
import { cn } from '../../../lib/shared/cn';
import { minutesToHours, workedMinutes } from '../../../lib/domains/time/hours';
import type { TimeReferenceItem } from '../../../lib/domains/time/reference';
import type { PersonPeriodSummary } from '../../../lib/domains/time/summary';

// Adminrättelse av en tidrad, i en modal.
//
// ⚠️ MODAL OCH INTE INLINE I TABELLEN, av två skäl. Det första är att `globals.css` sätter
// `label { display: block; width: 100% }` utan lager, så fälten staplades på höjden i tabellcellen
// hur mycket flex man än la på — samma familj som knapparnas padding. Det andra väger tyngre: att
// byta arbetsorder kräver en sökbar väljare, och den får inte plats i en tabellrad.
//
// ⚠️ VAD SOM GÅR ATT RÄTTA: allt utom vem tiden tillhör. Ägaren läses ur databasen i routen och
// finns inte ens i schemat — att rätta ett fel är en sak, att flytta någons timmar till en annan
// persons löneunderlag en annan.
//
// Varje ändring loggas av en databastrigger, och perioden måste vara öppen: låstriggern prövar
// radens ägare, så attesterad tid går inte att röra ens härifrån.

type Kind = 'work_order' | 'internal' | 'absence';

export type CorrectionReference = {
  time_code: TimeReferenceItem[];
  internal_project: TimeReferenceItem[];
  absence_type: TimeReferenceItem[];
};

type WorkOrderHit = { id: string; order_number: string | null; fortnox_order_number: string | null; project_name: string | null; client_name: string | null };

const KINDS: Array<{ key: Kind; label: string }> = [
  { key: 'work_order', label: 'Arbetsorder' },
  { key: 'internal', label: 'Intern' },
  { key: 'absence', label: 'Frånvaro' },
];

const FIELD = 'w-full rounded-xl border border-solid border-[#dbe4d6] bg-white px-3 py-2 text-sm text-slate-900';
const LABEL = 'text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600';

function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2).replace('.', ',');
}

/** Fortnox-numret leder, det interna är reserven — husets konvention (documentRef). */
function orderLabel(order: WorkOrderHit): string {
  const ref = order.fortnox_order_number ? `#${order.fortnox_order_number}` : order.order_number;
  return [ref, order.project_name || order.client_name].filter(Boolean).join(' · ') || 'Arbetsorder';
}

export default function AdminTimeCorrectionModal({
  day, reference, onClose, onSave,
}: {
  day: PersonPeriodSummary['rows'][number];
  reference: CorrectionReference;
  onClose: () => void;
  /** Returnerar felmeddelandet, eller null när det gick bra. */
  onSave: (patch: Record<string, unknown>) => Promise<string | null>;
}) {
  const isAbsenceRow = day.absenceMinutes > 0;

  const [kind, setKind] = React.useState<Kind>(isAbsenceRow ? 'absence' : 'work_order');
  const [date, setDate] = React.useState(day.date);
  const [start, setStart] = React.useState((day.startTime || '').slice(0, 5));
  const [end, setEnd] = React.useState((day.endTime || '').slice(0, 5));
  const [breakMinutes, setBreakMinutes] = React.useState(String(day.breakMinutes));
  const [absenceHours, setAbsenceHours] = React.useState(String(minutesToHours(day.absenceMinutes) || 8));
  const [workOrderId, setWorkOrderId] = React.useState('');
  const [internalId, setInternalId] = React.useState('');
  const [absenceId, setAbsenceId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  // Arbetsordersökning. Admin får söka i HELA registret, inte bara i personens schemalagda jobb:
  // rättelsen finns för att raden hamnat på fel order, och den rätta ordern är per definition en
  // personen inte var bokad på. (get_my_crm_jobs är dessutom självskopad — den hade gett adminens
  // egna jobb, vilket är fel lista i varje tänkbart fall.)
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<WorkOrderHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const searchSeq = React.useRef(0);

  React.useEffect(() => {
    if (kind !== 'work_order') return;
    const term = query.trim();
    if (term.length < 2) { setHits([]); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    // Fördröjning så en sökning inte skickas per tangenttryck.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/work-orders?q=${encodeURIComponent(term)}&limit=8`, {
          cache: 'no-store', credentials: 'same-origin',
        });
        const body = await res.json().catch(() => null);
        if (seq !== searchSeq.current) return;
        setHits(res.ok && body?.ok ? (body.data.items || []) : []);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [kind, query]);

  const previewMinutes = React.useMemo(() => {
    if (kind === 'absence') {
      const hours = Number(String(absenceHours).replace(',', '.'));
      return Number.isFinite(hours) ? Math.round(hours * 60) : 0;
    }
    return workedMinutes({ workDate: date, startTime: start || null, endTime: end || null, breakMinutes: Number(breakMinutes) || 0 });
  }, [kind, absenceHours, date, start, end, breakMinutes]);

  // Målet behöver bara väljas när man BYTER det. Rör man inte väljaren ärver raden sitt nuvarande
  // mål av servern, så en ren klockslagsrättelse ska inte kräva att man letar upp jobbet igen.
  const targetChanged = kind === 'work_order' ? !!workOrderId : kind === 'internal' ? !!internalId : !!absenceId;
  const kindChanged = kind !== (isAbsenceRow ? 'absence' : 'work_order');
  const needsTarget = kindChanged && !targetChanged;

  async function save() {
    setBusy(true);
    setFailure(null);
    const patch: Record<string, unknown> = { work_date: date };
    if (kindChanged) patch.kind = kind;
    if (kind === 'work_order' && workOrderId) patch.work_order_id = workOrderId;
    if (kind === 'internal' && internalId) patch.internal_project_id = internalId;
    if (kind === 'absence' && absenceId) patch.absence_type_id = absenceId;
    if (kind === 'absence') {
      patch.hours = Number(String(absenceHours).replace(',', '.'));
    } else {
      patch.start_time = start;
      patch.end_time = end;
      patch.break_minutes = Number(breakMinutes) || 0;
    }
    const result = await onSave(patch);
    // Lyckades det avmonterar föräldern oss — då finns ingen state kvar att skriva till.
    if (result) { setFailure(result); setBusy(false); }
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Rätta tidrad"
      maxWidth="sm:max-w-[520px]"
      header={
        <>
          <h2 className="text-lg font-bold text-slate-900">Rätta tidrad</h2>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            Ändringen loggas med ditt namn. Den anställde ser den i sin tidrapport.
          </p>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="!py-2.5 flex-1 rounded-xl border border-solid border-[#dbe4d6] bg-white text-sm font-semibold text-slate-600 transition hover:border-slate-400 sm:flex-none sm:!px-5"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || previewMinutes <= 0 || needsTarget}
            className="!py-2.5 flex-1 rounded-xl text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:!px-5"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {busy ? 'Sparar…' : 'Spara rättelse'}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        {failure ? (
          <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{failure}</div>
        ) : null}

        <div className="flex gap-1 rounded-xl bg-[#eef3ea] p-1">
          {KINDS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setKind(option.key)}
              aria-pressed={kind === option.key}
              className={cn(
                '!px-2 !py-2 flex-1 rounded-lg text-sm font-semibold transition',
                kind === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* ⚠️ `!w-auto` på varje label: globals.css ger <label> `width: 100%` utan att ligga i ett
            lager, så utan den staplas fälten på höjden oavsett grid eller flex. */}
        <label className="!w-auto grid gap-1">
          <span className={LABEL}>Datum</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {kind === 'work_order' ? (
          <div className="grid gap-1.5">
            <span className={LABEL}>Arbetsorder</span>
            <p className="m-0 text-xs text-slate-500">
              {day.label ? <>Nu: <strong className="font-semibold text-slate-700">{day.label}</strong>. </> : null}
              Sök bara om raden ska flyttas till ett annat jobb.
            </p>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sök ordernummer eller kund…" />
            {searching ? <span className="text-sm text-slate-400">Söker…</span> : null}
            {hits.length > 0 ? (
              <div className="grid gap-1.5">
                {hits.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setWorkOrderId(order.id)}
                    aria-pressed={workOrderId === order.id}
                    className={cn(
                      '!px-3 !py-2.5 !justify-start !text-left w-full rounded-xl border border-solid text-sm transition',
                      workOrderId === order.id
                        ? 'border-transparent text-white shadow-sm'
                        : 'border-[#dbe4d6] bg-white text-slate-700 hover:border-slate-400',
                    )}
                    style={workOrderId === order.id ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                  >
                    {orderLabel(order)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : kind === 'internal' ? (
          <label className="!w-auto grid gap-1">
            <span className={LABEL}>Internprojekt</span>
            <select value={internalId} onChange={(e) => setInternalId(e.target.value)} className={FIELD}>
              <option value="">{kindChanged ? 'Välj…' : 'Oförändrat'}</option>
              {reference.internal_project.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="!w-auto grid gap-1">
            <span className={LABEL}>Frånvaroorsak</span>
            <select value={absenceId} onChange={(e) => setAbsenceId(e.target.value)} className={FIELD}>
              <option value="">{kindChanged ? 'Välj…' : 'Oförändrad'}</option>
              {reference.absence_type.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        )}

        {kind === 'absence' ? (
          <label className="!w-auto grid gap-1">
            <span className={LABEL}>Antal timmar</span>
            <Input inputMode="decimal" value={absenceHours} onChange={(e) => setAbsenceHours(e.target.value)} />
          </label>
        ) : (
          <div className="grid gap-3 rounded-2xl border border-solid border-[#e0e8dc] bg-[#f6f9f4] p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="!w-auto grid gap-1">
                <span className={LABEL}>Start</span>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="!w-auto grid gap-1">
                <span className={LABEL}>Slut</span>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <div className="flex items-end justify-between gap-3">
              <label className="!w-auto grid gap-1">
                <span className={LABEL}>Rast (min)</span>
                <span className="block w-24">
                  <Input inputMode="numeric" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
                </span>
              </label>
              <div className="shrink-0 text-right">
                <div className={cn(LABEL, 'whitespace-nowrap')}>Arbetad tid</div>
                <div className={cn('whitespace-nowrap text-xl font-bold tabular-nums leading-tight', previewMinutes > 0 ? 'text-slate-900' : 'text-slate-300')}>
                  {formatHours(previewMinutes)} h
                </div>
              </div>
            </div>
            {!start || !end ? (
              <p className="m-0 text-sm text-slate-500">Fyll i start- och sluttid.</p>
            ) : previewMinutes <= 0 ? (
              <p className="m-0 text-sm text-rose-600">Rasten är längre än passet.</p>
            ) : null}
          </div>
        )}

        {needsTarget ? (
          <p className="m-0 text-sm text-amber-800">
            Sorten är ändrad — välj {kind === 'work_order' ? 'en arbetsorder' : kind === 'internal' ? 'ett internprojekt' : 'en frånvaroorsak'} innan du sparar.
          </p>
        ) : null}
      </div>
    </CrmModal>
  );
}
