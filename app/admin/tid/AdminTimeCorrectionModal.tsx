"use client";
import React from 'react';
import CrmModal from '@/app/crm/components/CrmModal';
import Input from '../../../components/ui/Input';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';
import { minutesToHours, parseBreakMinutes, workedMinutes } from '../../../lib/domains/time/hours';
import type { TimeReferenceItem } from '../../../lib/domains/time/reference';
import type { PersonPeriodSummary } from '../../../lib/domains/time/summary';

// Adminrättelse av en tidrad, i en modal.
//
// ⚠️ MODAL OCH INTE INLINE I TABELLEN. Skälet som väger är att byta arbetsorder kräver en sökbar
// väljare, och den får inte plats i en tabellrad. (Det fanns ett andra skäl: `label { width: 100% }`
// i globals.css staplade fälten på höjden hur mycket flex man än la på. Den regeln ligger i
// `:where()` sedan 2026-08-16 och går numera att överrida med en klass, så den binder inte längre.)
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

const FIELD = 'w-full rounded-xl border border-[#dbe4d6] bg-white px-3 py-2 text-sm text-slate-900';
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
  // Sorten kommer från RADEN, inte ur siffrorna: en internrad har arbetade minuter precis som en
  // arbetsorderrad, så en gissning öppnade den som "Arbetsorder" och tappade sedan valt jobb tyst.
  const [kind, setKind] = React.useState<Kind>(day.kind);
  const [date, setDate] = React.useState(day.date);
  const [start, setStart] = React.useState((day.startTime || '').slice(0, 5));
  const [end, setEnd] = React.useState((day.endTime || '').slice(0, 5));
  const [breakMinutes, setBreakMinutes] = React.useState(String(day.breakMinutes));
  // ⚠️ Radens EGNA minuter som utgångsvärde, inte 8. `|| 8` slog till på varje arbetsrad som görs
  // om till frånvaro (absenceMinutes är noll där per konstruktion) och föreslog då åtta timmar för
  // ett fyratimmarspass — dubbelt mot sanningen, på löneunderlaget.
  const [absenceHours, setAbsenceHours] = React.useState(
    String(minutesToHours(day.absenceMinutes || day.workMinutes) || ''),
  );
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
  // ⚠️ Valet måste synas ÄVEN när träfflistan är borta. Förut kunde man klicka en träff för att
  // läsa den, tömma sökrutan så listan försvann, och spara — varpå raden tyst flyttades till det
  // jobbet. Den enda markören satt på träffknappen, som just hade avmonterats.
  const [chosen, setChosen] = React.useState<WorkOrderHit | null>(null);
  const [searching, setSearching] = React.useState(false);
  const searchSeq = React.useRef(0);

  React.useEffect(() => {
    if (kind !== 'work_order') return;
    const term = query.trim();
    // setSearching(false) också här: utan den satt "Söker…" kvar för alltid när man backade ned
    // under två tecken, eftersom den grenen aldrig nådde finally.
    if (term.length < 2) { setHits([]); setSearching(false); return; }
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
      } catch {
        // Utan den här grenen låg FÖRRA sökningens träffar kvar under den NYA termen, och ett klick
        // flyttade raden till en order man inte sökt efter.
        if (seq === searchSeq.current) setHits([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [kind, query]);

  const parsedBreak = parseBreakMinutes(breakMinutes);
  const absenceValue = Number(String(absenceHours).replace(',', '.'));

  const previewMinutes = React.useMemo(() => {
    if (kind === 'absence') {
      return Number.isFinite(absenceValue) && absenceValue > 0 ? Math.round(absenceValue * 60) : 0;
    }
    if (parsedBreak === null) return 0;
    return workedMinutes({ workDate: date, startTime: start || null, endTime: end || null, breakMinutes: parsedBreak });
  }, [kind, absenceValue, date, start, end, parsedBreak]);

  // ⚠️ `grossMinutes` läser `end <= start` som ett pass över midnatt, så identiska klockslag ger
  // exakt 1440 minuter — och serverns guard är `> 1440`, alltså exklusiv. Ett dubbelklistrat
  // klockslag hade skrivit ett DYGN på någon annans månad, med "24,00 h" i förhandsvisningen som
  // enda signal. Ett pass måste sluta på en annan tid än det börjar.
  const sameClock = kind !== 'absence' && !!start && start === end;

  // Målet behöver bara väljas när man BYTER det. Rör man inte väljaren ärver raden sitt nuvarande
  // mål av servern, så en ren klockslagsrättelse ska inte kräva att man letar upp jobbet igen.
  const targetChanged = kind === 'work_order' ? !!workOrderId : kind === 'internal' ? !!internalId : !!absenceId;
  const kindChanged = kind !== day.kind;
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
      patch.break_minutes = parsedBreak ?? 0;
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
            Ändringen loggas med ditt namn, datum och radens värde före och efter.
          </p>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={cn(crm.ghostButton, 'h-auto flex-1 py-2.5 sm:flex-none sm:px-5')}
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || previewMinutes <= 0 || needsTarget || sameClock || !date}
            className={cn(crm.formButton, 'h-auto flex-1 py-2.5 sm:ml-auto sm:flex-none sm:px-5')}
            style={{ backgroundColor: 'var(--ek-green)' }}
          >
            {busy ? 'Sparar…' : 'Spara rättelse'}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        {failure ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{failure}</div>
        ) : null}

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

        {/* `w-auto` på varje label: <label> är 100 % brett som default (globals.css), vilket skulle
            stapla fälten på höjden i griden. Klassen räcker — regeln ligger i `:where()`. */}
        <label className="w-auto grid gap-1">
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
            {chosen ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <span className="font-semibold text-emerald-900">Flyttas till {orderLabel(chosen)}</span>
                <button
                  type="button"
                  onClick={() => { setWorkOrderId(''); setChosen(null); }}
                  className="p-0 text-sm font-semibold text-emerald-800 underline underline-offset-2"
                >
                  Ångra
                </button>
              </div>
            ) : null}
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sök ordernummer eller kund…" />
            {searching ? <span className="text-sm text-slate-400">Söker…</span> : null}
            {hits.length > 0 ? (
              <div className="grid gap-1.5">
                {hits.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => { setWorkOrderId(order.id); setChosen(order); }}
                    aria-pressed={workOrderId === order.id}
                    className={cn(
                      'px-3 py-2.5 justify-start text-left w-full rounded-xl border text-sm transition',
                      workOrderId === order.id
                        ? 'border-transparent text-white shadow-sm'
                        : 'border-[#dbe4d6] bg-white text-slate-700 hover:border-slate-400',
                    )}
                    style={workOrderId === order.id ? { backgroundColor: 'var(--ek-green)' } : undefined}
                  >
                    {orderLabel(order)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : kind === 'internal' ? (
          <label className="w-auto grid gap-1">
            <span className={LABEL}>Internprojekt</span>
            <select value={internalId} onChange={(e) => setInternalId(e.target.value)} className={FIELD}>
              <option value="">{kindChanged ? 'Välj…' : 'Oförändrat'}</option>
              {reference.internal_project.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="w-auto grid gap-1">
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
          <label className="w-auto grid gap-1">
            <span className={LABEL}>Antal timmar</span>
            <Input inputMode="decimal" value={absenceHours} onChange={(e) => setAbsenceHours(e.target.value)} />
          </label>
        ) : (
          <div className="grid gap-3 rounded-2xl border border-[#e0e8dc] bg-[#f6f9f4] p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="w-auto grid gap-1">
                <span className={LABEL}>Start</span>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="w-auto grid gap-1">
                <span className={LABEL}>Slut</span>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <div className="flex items-end justify-between gap-3">
              <label className="w-auto grid gap-1">
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
            ) : sameClock ? (
              <p className="m-0 text-sm text-rose-600">Start och slut är samma klockslag.</p>
            ) : parsedBreak === null ? (
              <p className="m-0 text-sm text-rose-600">Rasten måste vara ett helt antal minuter.</p>
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
