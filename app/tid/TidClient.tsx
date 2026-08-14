"use client";
import React from 'react';
import PageShell from '@/components/ui/PageShell';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { minutesToHours } from '@/lib/domains/time/hours';
import { parseDecimal } from '@/lib/shared/number';
import { addDays, buildWeekDays, fmtISO, isoWeek, startOfWeek, type WeekDay } from '@/app/crm/planering/planningDates';
import { COMPENSATION_KINDS, COMPENSATION_LABELS, COMPENSATION_UNITS, summarizeCompensations, type CompensationItem, type CompensationKind } from '@/lib/domains/time/compensations';
import { isPeriodLocked, periodLabel, TIME_PERIOD_STATUS_LABELS, type TimeApprovalRow, type TimePeriodStatus } from '@/lib/domains/time/approvals';
import TimeEntryModal, { type EditableEntry, type ReferenceData } from './TimeEntryModal';

// Tidrapporten, CRM-versionen. Ligger på /tid bredvid gamla /tidrapport (som fortsätter mot Blikk)
// tills cutovern i fas 4.6 — två levande vägar, precis som "Planering" och "Planering (äldre)".
//
// ⚠️ VECKAN ÄR REMSAN, DAGEN ÄR SIDAN (omdesign 2026-08-14).
//
// Sidan svarar på EN daglig fråga — "har jag rapporterat idag?" — och den ska besvaras på en blick,
// på en telefon, med en hand. Därför bär varje dagruta i remsan sina egna timmar: en tom ruta ÄR
// svaret, ingen text behövs. Under remsan ligger en dag i taget, med sina rader och en knapp.
//
// Den förra versionen visade sju dagkort under varandra. Det gav sju likadana "Rapportera"-knappar,
// tre metrik-chips som delvis upprepade varandra och samma siffra på tre ställen — och tomma dagar
// kostade lika mycket höjd som en dag med innehåll. På en telefon låg första dagen under två fulla
// block med krom.
//
// Månadssiffrorna ligger kvar men LÄNGST NER, vid inlämningsknappen: de är det man vill se när
// perioden ska stängas, inte när man ska föra in dagens pass. Månadsöversikt per person, attest och
// export är lön/admins yta och ligger i Admin, inte här.

type EntryRow = EditableEntry & {
  hours: number;
  work_order?: { order_number: string | null; fortnox_order_number: string | null; project_name: string | null; client_name: string | null } | null;
  internal_project?: { name: string } | null;
  absence_type?: { name: string } | null;
};

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2).replace('.', ',');
}

/** Timmar för en ruta som är 48 px bred: "8", "8,5", "17". Två decimaler får inte plats. */
function compactHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace('.', ',');
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function formatStamp(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/** '2026-08-14' → 'fredag 14 augusti'. Fälten plockas ur strängen, så ingen tidszon flyttar dagen. */
function longDayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date);
}

/** '2026-08-14' → '14 aug'. Kort datum för listor där året aldrig är i fråga. */
function shortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${Number(match[3])} ${MONTHS_SHORT[Number(match[2]) - 1]}`;
}

/** '10–16 aug' eller '28 jul–3 aug' när veckan korsar ett månadsskifte. */
function weekRangeLabel(days: WeekDay[]): string {
  const first = days[0].date;
  const last = days[6].date;
  const sameMonth = first.getMonth() === last.getMonth();
  return sameMonth
    ? `${first.getDate()}–${last.getDate()} ${MONTHS_SHORT[last.getMonth()]}`
    : `${first.getDate()} ${MONTHS_SHORT[first.getMonth()]}–${last.getDate()} ${MONTHS_SHORT[last.getMonth()]}`;
}

function entryMinutes(entry: EntryRow): number {
  return entry.minutes_worked ?? Math.round(Number(entry.hours || 0) * 60);
}

function entryLabel(entry: EntryRow): string {
  if (entry.kind === 'absence') return entry.absence_type?.name || 'Frånvaro';
  if (entry.kind === 'internal') return entry.internal_project?.name || 'Internt';
  const order = entry.work_order;
  if (!order) return 'Arbetsorder';
  const number = order.fortnox_order_number || order.order_number;
  return [number ? `#${number}` : null, order.client_name || order.project_name].filter(Boolean).join(' · ') || 'Arbetsorder';
}

const STATUS_TONE: Record<TimePeriodStatus, string> = {
  open: 'border-slate-200 bg-white text-slate-600',
  submitted: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

export default function TidClient() {
  const [weekOffset, setWeekOffset] = React.useState(0);
  const monday = React.useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
  const weekDays = React.useMemo(() => buildWeekDays(monday), [monday]);
  const todayIso = React.useMemo(() => fmtISO(new Date()), []);

  // Månaden som veckans måndag ligger i — det är den perioden lönen räknar på.
  const monthAnchor = React.useMemo(() => ({ year: monday.getFullYear(), month: monday.getMonth() }), [monday]);

  // En hämtning som täcker BÅDE veckan och dess månad: en vecka kan spänna över ett månadsskifte,
  // och då ska varken dagrutorna eller månadssumman tappa rader.
  const fetchRange = React.useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const monthStart = `${monthAnchor.year}-${pad(monthAnchor.month + 1)}-01`;
    const lastDay = new Date(Date.UTC(monthAnchor.year, monthAnchor.month + 1, 0)).getUTCDate();
    const monthEnd = `${monthAnchor.year}-${pad(monthAnchor.month + 1)}-${pad(lastDay)}`;
    const weekStart = weekDays[0].iso;
    const weekEnd = weekDays[6].iso;
    return {
      from: weekStart < monthStart ? weekStart : monthStart,
      to: weekEnd > monthEnd ? weekEnd : monthEnd,
      monthStart,
      monthEnd,
      // Attestperioden är alltid en kalendermånad — samma månad som summorna nedan.
      period: `${monthAnchor.year}-${pad(monthAnchor.month + 1)}`,
    };
  }, [monthAnchor, weekDays]);

  const [entries, setEntries] = React.useState<EntryRow[]>([]);
  const [compensations, setCompensations] = React.useState<CompensationItem[]>([]);
  const [approval, setApproval] = React.useState<TimeApprovalRow | null>(null);
  const [approvalStatus, setApprovalStatus] = React.useState<TimePeriodStatus>('open');
  const [reference, setReference] = React.useState<ReferenceData>({ time_code: [], internal_project: [], absence_type: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [modalDate, setModalDate] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<EditableEntry | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [pickedIso, setPickedIso] = React.useState(todayIso);

  // Kapplöpningsvakt: klickar man snabbt genom veckorna kan ett tidigare svar komma sist och rita
  // fel veckas rader. Bara den senaste hämtningen får skriva.
  const loadSeq = React.useRef(0);

  const load = React.useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(null);
    try {
      const [entriesRes, compsRes, refRes, approvalRes] = await Promise.all([
        fetch(`/api/time/entries?from=${fetchRange.from}&to=${fetchRange.to}`, { cache: 'no-store' }),
        fetch(`/api/time/compensations?from=${fetchRange.monthStart}&to=${fetchRange.monthEnd}`, { cache: 'no-store' }),
        fetch('/api/time/reference', { cache: 'no-store' }),
        fetch(`/api/time/approvals?period=${fetchRange.period}`, { cache: 'no-store' }),
      ]);
      const [entriesJson, compsJson, refJson, approvalJson] = await Promise.all([
        entriesRes.json().catch(() => ({})),
        compsRes.json().catch(() => ({})),
        refRes.json().catch(() => ({})),
        approvalRes.json().catch(() => ({})),
      ]);
      if (seq !== loadSeq.current) return;

      // Statusen sätts FÖRST, och alltid — före kastet nedan och oavsett hur det gick.
      //
      // Den styr vilka knappar som finns, och den hör till den månad vi just bytte TILL. Skrevs den
      // bara vid lyckad hämtning låg föregående månads värde kvar: bläddrade man från en attesterad
      // juli till en öppen augusti med ett fel i vägen, så påstod kortet att augusti var attesterad
      // och alla rapportknappar var borta. Fail open — databasen är garantin, och att tyst låsa
      // någon ute ur sin egen tidrapport på ett nätverksfel är värre än en knapp som svarar 409.
      const approvalOk = approvalRes.ok && approvalJson.ok;
      setApproval(approvalOk ? (approvalJson.data.approval || null) : null);
      setApprovalStatus(approvalOk ? (approvalJson.data.status || 'open') : 'open');

      if (!entriesRes.ok || !entriesJson.ok) throw new Error(entriesJson?.error || 'Kunde inte hämta tidrader');
      setEntries(entriesJson.data.items || []);
      if (compsRes.ok && compsJson.ok) setCompensations(compsJson.data.items || []);
      if (refRes.ok && refJson.ok) setReference(refJson.data);
    } catch (e) {
      if (seq === loadSeq.current) {
        setError((e as Error).message);
        // Nätverksfel kastar innan raderna ovan hann köras — samma resonemang, samma utfall.
        setApproval(null);
        setApprovalStatus('open');
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [fetchRange]);

  React.useEffect(() => { void load(); }, [load]);

  // Den valda dagen HÄRLEDS, den synkas inte i en effekt. Byts veckan pekar det valda datumet på en
  // dag som inte längre står i remsan, och rättelsen måste ske i samma rendering — en effekt kör
  // efter målningen, så en bildruta hade visat den nya veckans remsa under den gamla dagens rubrik,
  // rader och låsläge. Idag väljs när den ligger i veckan, annars måndagen: man bläddrar bakåt för
  // att titta på en vecka, och då är dess början rätt startpunkt.
  const weekIsos = React.useMemo(() => weekDays.map((day) => day.iso), [weekDays]);
  const selectedIso = weekIsos.includes(pickedIso)
    ? pickedIso
    : weekIsos.includes(todayIso) ? todayIso : weekIsos[0];

  const byDate = React.useMemo(() => {
    const map = new Map<string, EntryRow[]>();
    for (const entry of entries) {
      const list = map.get(entry.work_date) ?? [];
      list.push(entry);
      map.set(entry.work_date, list);
    }
    return map;
  }, [entries]);

  // Per dag i veckan: arbetad tid och frånvaro var för sig. Rutan i remsan visar den ena eller den
  // andra, och frånvaro ska aldrig läggas ihop med arbetstid.
  const dayTotals = React.useMemo(() => {
    const map = new Map<string, { worked: number; absent: number }>();
    for (const day of weekDays) map.set(day.iso, { worked: 0, absent: 0 });
    for (const entry of entries) {
      const total = map.get(entry.work_date);
      if (!total) continue;
      if (entry.kind === 'absence') total.absent += entryMinutes(entry);
      else total.worked += entryMinutes(entry);
    }
    return map;
  }, [entries, weekDays]);

  const weekTotal = React.useMemo(() => {
    const isoSet = new Set(weekDays.map((day) => day.iso));
    return entries
      .filter((entry) => isoSet.has(entry.work_date) && entry.kind !== 'absence')
      .reduce((sum, entry) => sum + entryMinutes(entry), 0);
  }, [entries, weekDays]);

  const monthTotals = React.useMemo(() => {
    let work = 0;
    let absence = 0;
    const byReason = new Map<string, number>();
    for (const entry of entries) {
      if (entry.work_date < fetchRange.monthStart || entry.work_date > fetchRange.monthEnd) continue;
      const minutes = entryMinutes(entry);
      if (entry.kind === 'absence') {
        absence += minutes;
        const reason = entry.absence_type?.name || '(orsak saknas)';
        byReason.set(reason, (byReason.get(reason) ?? 0) + minutes);
      } else {
        work += minutes;
      }
    }
    return { work, absence, byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'sv')) };
  }, [entries, fetchRange]);

  const compensationTotals = React.useMemo(() => summarizeCompensations(compensations), [compensations]);

  // Inlämnad eller attesterad → månaden är fryst. UI:t döljer knapparna, databasen är garantin:
  // policy + trigger nekar även om någon skickar anropet ändå.
  const locked = isPeriodLocked(approvalStatus);

  // Låset gäller en MÅNAD, men vyn visar en VECKA — och en vecka kan ligga i två månader. Bara den
  // status vi faktiskt hämtat får låsa något: en dag i grannmånaden lämnas öppen och servern får
  // svara, i stället för att gissa att den delar den här månadens tillstånd.
  const isDayLocked = React.useCallback(
    (iso: string) => locked && iso >= fetchRange.monthStart && iso <= fetchRange.monthEnd,
    [locked, fetchRange],
  );

  async function removeEntry(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/time/entries/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ta bort raden'); return; }
      await load();
    } catch {
      // Utan den här försvann ett nätverksfel tyst: raden låg kvar och användaren fick ingen
      // förklaring till varför "Ta bort" inte gjorde något.
      setError('Kunde inte ta bort raden — kontrollera uppkopplingen');
    } finally {
      setBusyId(null);
    }
  }

  function goToWeek(delta: number) {
    setWeekOffset((value) => value + delta);
    setLoading(true);
  }

  const selectedEntries = byDate.get(selectedIso) ?? [];
  const selectedLocked = isDayLocked(selectedIso);

  return (
    <PageShell className="max-w-[760px]">
      <section className={cn(crm.cardInner, 'grid gap-3')}>
        <div className="flex items-center justify-between gap-3">
          <h1 className={crm.pageTitle}>Tidrapport</h1>
          <span className={cn(crm.badge, 'border-solid', STATUS_TONE[approvalStatus])}>
            {MONTHS[monthAnchor.month]} · {TIME_PERIOD_STATUS_LABELS[approvalStatus]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <StepButton label="Föregående vecka" onClick={() => goToWeek(-1)}>←</StepButton>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-sm font-semibold text-slate-900">{weekRangeLabel(weekDays)}</div>
            <div className="text-xs text-slate-500">
              v.{isoWeek(monday)} · {loading ? '—' : <span className="tabular-nums">{formatHours(weekTotal)} h</span>}
            </div>
          </div>
          <StepButton label="Nästa vecka" onClick={() => goToWeek(1)}>→</StepButton>
        </div>

        {/* Remsan ÄR svaret på "har jag rapporterat?". En tom ruta säger det utan ett ord — därför
            bär varje ruta sina egna timmar i stället för att listan under gör det sju gånger. */}
        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((day) => (
            <DayTile
              key={day.iso}
              day={day}
              totals={dayTotals.get(day.iso) ?? { worked: 0, absent: 0 }}
              loading={loading}
              isToday={day.iso === todayIso}
              isSelected={day.iso === selectedIso}
              onSelect={() => setPickedIso(day.iso)}
            />
          ))}
        </div>

        {weekOffset !== 0 ? (
          <button
            type="button"
            onClick={() => { setWeekOffset(0); setLoading(true); }}
            className="!py-1.5 justify-self-center rounded-lg text-sm font-semibold text-slate-600 underline underline-offset-2"
          >
            Gå till denna vecka
          </button>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="!p-0 ml-3 underline">Stäng</button>
        </div>
      ) : null}

      {/* Dagen. En i taget, med sina rader och en knapp — inte sju kort med sju likadana knappar. */}
      <section className={cn(crm.cardInner, 'grid gap-3')}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="m-0 text-base font-bold capitalize text-slate-900">{longDayLabel(selectedIso)}</h2>
            {selectedIso === todayIso ? <Badge variant="accent">Idag</Badge> : null}
          </div>
          <DayTotals totals={dayTotals.get(selectedIso) ?? { worked: 0, absent: 0 }} />
        </div>

        {loading && selectedEntries.length === 0 ? (
          <p className="m-0 text-sm text-slate-400">Laddar…</p>
        ) : selectedEntries.length === 0 ? (
          <p className="m-0 text-sm text-slate-500">Inget rapporterat den här dagen.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {selectedEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                locked={selectedLocked}
                busy={busyId === entry.id}
                onEdit={() => { setEditing({ ...entry, work_order_label: entryLabel(entry) }); setModalDate(entry.work_date); }}
                onDelete={() => void removeEntry(entry.id)}
              />
            ))}
          </ul>
        )}

        {selectedLocked ? (
          <p className="m-0 text-sm text-slate-500">
            {MONTHS[monthAnchor.month]} är {TIME_PERIOD_STATUS_LABELS[approvalStatus].toLowerCase()} och går inte att ändra.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => { setEditing(null); setModalDate(selectedIso); }}
            className="!py-2.5 w-full rounded-xl text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            Rapportera tid
          </button>
        )}
      </section>

      <PeriodCard
        periodStart={fetchRange.monthStart}
        period={fetchRange.period}
        status={approvalStatus}
        approval={approval}
        workMinutes={monthTotals.work}
        absenceMinutes={monthTotals.absence}
        byReason={monthTotals.byReason}
        onChanged={load}
        onError={setError}
      />

      <CompensationSection
        items={compensations}
        totals={compensationTotals}
        monthLabel={`${MONTHS[monthAnchor.month]} ${monthAnchor.year}`}
        monthStart={fetchRange.monthStart}
        monthEnd={fetchRange.monthEnd}
        todayIso={todayIso}
        locked={locked}
        onChanged={load}
        onError={setError}
      />

      {modalDate ? (
        <TimeEntryModal
          reference={reference}
          defaultDate={modalDate}
          entry={editing}
          onClose={() => { setModalDate(null); setEditing(null); }}
          onSaved={() => { setModalDate(null); setEditing(null); void load(); }}
        />
      ) : null}
    </PageShell>
  );
}

// globals.css ger varje <button> `padding: 10px 14px` och centrering utan att ligga i ett lager, så
// Tailwind måste gå före med `!`. Samma sak överallt i den här filen där en knapp har egen form.
function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="!h-11 !w-11 !p-0 shrink-0 rounded-xl border border-solid border-[#d9e2d4] bg-white text-slate-600 transition hover:border-slate-400"
    >
      {children}
    </button>
  );
}

/**
 * En dag i veckoremsan.
 *
 * Fyllningen är informationen, inte dekoration: tom ruta = inget rapporterat, och det är precis den
 * fråga sidan finns för. Streckad kant på tomma dagar gör skillnaden läsbar även för den som inte
 * uppfattar färgskillnaden.
 *
 * Rutan är minst 60 px hög — den ska gå att träffa med en tumme i en handske.
 */
function DayTile({
  day, totals, loading, isToday, isSelected, onSelect,
}: {
  day: WeekDay;
  totals: { worked: number; absent: number };
  loading: boolean;
  isToday: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  // ⚠️ EN OLÄST RUTA FÅR INTE SE TOM UT. Under hämtningen är totalerna noll — vid ett veckobyte för
  // att raderna fortfarande hör till förra veckans datum — och en tom ruta betyder "inget
  // rapporterat". Utan det här läget svarar remsan alltså med självsäkerhet på sidans enda fråga
  // innan den vet svaret, och den som faktiskt rapporterat hela veckan ser sju tomma rutor.
  const hasWork = !loading && totals.worked > 0;
  const hasAbsence = !loading && totals.absent > 0;
  const hasAny = hasWork || hasAbsence;

  // Fyllningen bär informationen visuellt; aria-label bär samma sak för den som inte ser rutan.
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      aria-label={[
        `${day.weekday} ${day.date.getDate()}`,
        isToday ? 'idag' : null,
        loading ? 'läser in' : null,
        hasWork ? `${formatHours(totals.worked)} timmar` : null,
        hasAbsence ? `${formatHours(totals.absent)} timmar frånvaro` : null,
        loading || hasAny ? null : 'inget rapporterat',
      ].filter(Boolean).join(', ')}
      className={cn(
        '!min-h-[60px] !flex-col !justify-center !gap-0.5 !px-0.5 !py-1.5 rounded-xl border text-center transition',
        isSelected
          ? 'border-solid border-transparent text-white shadow-sm'
          : loading
            ? 'border-solid border-[#e4ebe0] bg-white text-slate-400'
            : hasAny
              ? 'border-solid border-[#cfdcc9] bg-white text-slate-900 hover:border-slate-400'
              : 'border-dashed border-[#d3ddce] bg-transparent text-slate-400 hover:border-slate-400',
        !isSelected && isToday ? 'ring-2 ring-emerald-300' : '',
      )}
      style={isSelected ? { backgroundColor: 'var(--crm-primary)' } : undefined}
    >
      <span className={cn('text-[10px] font-semibold uppercase tracking-wide', isSelected ? 'text-white/70' : 'text-slate-400')}>
        {day.weekday}
      </span>
      <span className="text-sm font-bold tabular-nums leading-none">{day.date.getDate()}</span>
      {loading ? (
        // Ett streck, inte en prick: pricken är "inget rapporterat" och får inte betyda två saker.
        <span className={cn('h-[11px] w-4 animate-pulse rounded-full', isSelected ? 'bg-white/40' : 'bg-slate-200')} aria-hidden />
      ) : hasWork ? (
        <span className={cn('text-[11px] font-semibold tabular-nums leading-none', isSelected ? 'text-white' : 'text-slate-700')}>
          {compactHours(totals.worked)}
        </span>
      ) : hasAbsence ? (
        <span className={cn('text-[11px] font-semibold tabular-nums leading-none', isSelected ? 'text-white' : 'text-amber-700')}>
          {compactHours(totals.absent)}
        </span>
      ) : (
        // En prick, inte ett tomrum: utan den hoppar rutans höjd mellan tomma och fyllda dagar.
        <span className={cn('text-[11px] leading-none', isSelected ? 'text-white/50' : 'text-slate-300')} aria-hidden>·</span>
      )}
    </button>
  );
}

function DayTotals({ totals }: { totals: { worked: number; absent: number } }) {
  if (totals.worked === 0 && totals.absent === 0) return null;
  return (
    <span className="flex items-baseline gap-2 text-sm">
      {totals.worked > 0 ? <strong className="tabular-nums text-slate-900">{formatHours(totals.worked)} h</strong> : null}
      {totals.absent > 0 ? <span className="tabular-nums text-amber-700">{formatHours(totals.absent)} h frånvaro</span> : null}
    </span>
  );
}

/**
 * En tidrad.
 *
 * Radad i stället för radbruten: klockslaget ankrar till vänster och timmarna till höger, med
 * beskrivningen på egen rad under. Den förra versionen la sex uppgifter i ett `flex-wrap` som blev
 * tre till fyra ojämna rader på en telefon, med Ändra/Ta bort flytande i slutet.
 */
function EntryCard({
  entry, locked, busy, onEdit, onDelete,
}: {
  entry: EntryRow;
  locked: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const minutes = entryMinutes(entry);
  const isAbsence = entry.kind === 'absence';
  const clock = entry.start_time ? `${entry.start_time.slice(0, 5)}–${(entry.end_time || '').slice(0, 5)}` : null;

  return (
    <li className="grid gap-1 rounded-xl border border-solid border-[#e4ebe0] bg-white px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold tabular-nums text-slate-900">{clock ?? (isAbsence ? 'Frånvaro' : `${formatHours(minutes)} h`)}</span>
        <span className={cn('shrink-0 text-sm font-semibold tabular-nums', isAbsence ? 'text-amber-700' : 'text-slate-700')}>
          {formatHours(minutes)} h
        </span>
      </div>

      <div className="text-sm text-slate-600">
        {entryLabel(entry)}
        {entry.break_minutes > 0 ? <span className="text-slate-400"> · rast {entry.break_minutes} min</span> : null}
      </div>

      {entry.note ? <div className="text-sm text-slate-400">{entry.note}</div> : null}

      {!locked ? (
        <div className="flex justify-end gap-1 pt-0.5">
          <button type="button" onClick={onEdit} className="!px-2 !py-1 rounded-lg text-sm font-medium text-slate-600 underline underline-offset-2">
            Ändra
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="!px-2 !py-1 rounded-lg text-sm font-medium text-rose-600 underline underline-offset-2 disabled:opacity-50"
          >
            Ta bort
          </button>
        </div>
      ) : null}
    </li>
  );
}

// Månadens inlämning. Kortet finns för EN fråga — "är den här månaden klar?" — och den ska gå att
// besvara utan att räkna ihop något själv, därför står summorna här.
//
// Ligger LÄNGST NER av samma skäl: det är en syssla en gång i månaden, och den ska inte konkurrera
// med dagens knapp om uppmärksamheten. Månadssiffrorna följer med hit av samma anledning — de är
// underlaget för just det här beslutet.
//
// `submitted` låser skrivningen men den anställde kan ta tillbaka den själv ända fram till attest
// (Williams beslut 2026-08-12). Efter `approved` krävs en attestansvarig, och kortet säger det rakt
// ut i stället för att bara sakna knapp — annars läser folk låset som en bugg.
function PeriodCard({
  periodStart, period, status, approval, workMinutes, absenceMinutes, byReason, onChanged, onError,
}: {
  periodStart: string;
  period: string;
  status: TimePeriodStatus;
  approval: TimeApprovalRow | null;
  workMinutes: number;
  absenceMinutes: number;
  byReason: Array<[string, number]>;
  onChanged: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const label = periodLabel(periodStart);

  async function setStatus(next: TimePeriodStatus) {
    setBusy(true);
    try {
      const res = await fetch('/api/time/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, status: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { onError(json?.error || 'Kunde inte ändra periodens status'); return; }
      await onChanged();
    } catch {
      onError('Kunde inte ändra periodens status — kontrollera uppkopplingen');
    } finally {
      setBusy(false);
    }
  }

  const tone =
    status === 'approved' ? 'border-emerald-200 bg-emerald-50'
    : status === 'submitted' ? 'border-amber-200 bg-amber-50'
    : 'border-[#e0e8dc] bg-[#f9fbf7]';

  return (
    <section className={cn('grid gap-3 rounded-2xl border border-solid px-3.5 py-3', tone)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <strong className="text-sm capitalize text-slate-900">{label}</strong>
        <span className="text-sm text-slate-600">
          Arbetat <strong className="tabular-nums text-slate-900">{formatHours(workMinutes)} h</strong>
          {absenceMinutes > 0 ? <> · frånvaro <strong className="tabular-nums text-amber-800">{formatHours(absenceMinutes)} h</strong></> : null}
        </span>
      </div>

      {/* Vilken ledighet, inte bara hur mycket — orsakerna har olika lönesort. Först här, vid
          inlämningen: det är då man kontrollerar dem, inte när man för in dagens pass. */}
      {byReason.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {byReason.map(([reason, minutes]) => (
            <span key={reason} className="rounded-lg bg-white/70 px-2 py-1 text-xs text-slate-600">
              {reason} <span className="tabular-nums">{formatHours(minutes)} h</span>
            </span>
          ))}
        </div>
      ) : null}

      <p className="m-0 text-sm text-slate-600">
        {status === 'open'
          ? 'Lämna in när månaden är färdigrapporterad.'
          : status === 'submitted'
            ? `Inlämnad ${formatStamp(approval?.submitted_at ?? null)}. Månaden är låst — ångra inlämningen om du behöver ändra något.`
            : `Attesterad ${formatStamp(approval?.approved_at ?? null)}. Månaden är låst; kontakta en attestansvarig om något behöver rättas.`}
      </p>

      {approval?.note && status === 'open' ? (
        // Anledningen admin skrev när perioden öppnades igen — det är själva uppmaningen att göra
        // något, och den ska inte bara finnas i adminvyn.
        <p className="m-0 text-sm font-medium text-amber-800">Öppnad igen: {approval.note}</p>
      ) : null}

      {status === 'open' ? (
        <button
          type="button"
          onClick={() => void setStatus('submitted')}
          disabled={busy}
          className="!py-2.5 w-full rounded-xl border border-solid border-[#cfdcc9] bg-white text-sm font-semibold text-slate-800 transition hover:border-slate-400 disabled:opacity-60"
        >
          Lämna in {label}
        </button>
      ) : status === 'submitted' ? (
        <button
          type="button"
          onClick={() => void setStatus('open')}
          disabled={busy}
          className="!py-2.5 w-full rounded-xl border border-solid border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
        >
          Ångra inlämning
        </button>
      ) : null}
    </section>
  );
}

// Traktamenten, utlägg och milersättning. Egen lista med flit: de har eget datum och hör inte till
// ett arbetspass — ett utlägg kan finnas en dag man inte jobbat. Visas per MÅNAD, till skillnad från
// tiden ovan: de är enstaka poster man går igenom när perioden ska lämnas in, inte en daglig syssla.
//
// HOPFÄLLD som standard, med summorna i rubriken. Just för att den är en månadssyssla ska den inte
// ligga utfälld under varje dagligt besök — men summan är det man vill se i förbifarten, så den
// står kvar när innehållet är dolt. Tabellen är borta: 620 px minsta bredd på en telefon blev
// vågrät skrollning, och en post har fem fält som ryms på två rader i ett kort.
function CompensationSection({
  items, totals, monthLabel, monthStart, monthEnd, todayIso, locked, onChanged, onError,
}: {
  items: CompensationItem[];
  totals: ReturnType<typeof summarizeCompensations>;
  monthLabel: string;
  monthStart: string;
  monthEnd: string;
  todayIso: string;
  locked: boolean;
  onChanged: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<CompensationKind>('travel');
  // Förifyllt datum måste ligga i den månad listan visar, annars sparas posten och FÖRSVINNER
  // direkt ur vyn — vilket bjuder in till att lägga in den en gång till. Står man i en annan månad
  // än dagens (vilket sker av sig självt när veckan börjar i föregående månad) används månadens
  // första dag. fmtISO och inte toISOString: den senare är UTC och ger fel dag efter midnatt.
  const defaultDate = todayIso >= monthStart && todayIso <= monthEnd ? todayIso : monthStart;
  const [date, setDate] = React.useState(defaultDate);
  React.useEffect(() => { setDate(defaultDate); }, [defaultDate]);

  const [quantity, setQuantity] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const unit = COMPENSATION_UNITS[kind];
  // parseDecimal (lib/shared/number.ts) tål både "1 250" och "1250,50". Number(x.replace(',','.'))
  // ger NaN på tusentalsmellanslag, och med `|| 0` hade det tyst sparats som 0 kr.
  const parsedAmount = parseDecimal(amount, NaN);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const grandTotal = totals.reduce((sum, total) => sum + total.amount, 0);

  async function add() {
    if (!amountValid) { onError('Ange ett belopp i kronor'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/time/compensations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_date: date,
          kind,
          quantity: unit ? (parseDecimal(quantity, NaN) || null) : null,
          amount: parsedAmount,
          note: note.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { onError(json?.error || 'Kunde inte spara posten'); return; }
      setQuantity(''); setAmount(''); setNote('');
      await onChanged();
    } catch {
      onError('Kunde inte spara posten — kontrollera uppkopplingen');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/time/compensations/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { onError(json?.error || 'Kunde inte ta bort posten'); return; }
      await onChanged();
    } catch {
      onError('Kunde inte ta bort posten — kontrollera uppkopplingen');
    }
  }

  return (
    <section className={cn(crm.cardInner, 'grid gap-3')}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="!flex-row !justify-between !gap-3 !p-0 !text-left w-full"
      >
        <span className="grid gap-0.5">
          <span className="text-sm font-bold text-slate-900">Utlägg och ersättning</span>
          <span className="text-xs text-slate-500">
            {items.length === 0
              ? `Inget inlagt i ${monthLabel.toLowerCase()}`
              : `${items.length} ${items.length === 1 ? 'post' : 'poster'} · ${formatAmount(grandTotal)} kr`}
          </span>
        </span>
        <span className="shrink-0 text-sm text-slate-400" aria-hidden>{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <>
          {totals.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {totals.map((total) => (
                <Badge key={total.kind}>
                  {COMPENSATION_LABELS[total.kind]} {formatAmount(total.amount)} kr
                  {COMPENSATION_UNITS[total.kind] ? ` · ${total.quantity} ${COMPENSATION_UNITS[total.kind]}` : ''}
                </Badge>
              ))}
            </div>
          ) : null}

          {items.length > 0 ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {items.map((item) => (
                <li key={item.id} className="grid gap-1 rounded-xl border border-solid border-[#e4ebe0] bg-white px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900">{COMPENSATION_LABELS[item.kind]}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">{formatAmount(Number(item.amount))} kr</span>
                  </div>
                  <div className="text-sm text-slate-500">
                    <span className="tabular-nums">{shortDate(item.entry_date)}</span>
                    {item.quantity != null ? <> · <span className="tabular-nums">{item.quantity}</span> {COMPENSATION_UNITS[item.kind] ?? ''}</> : null}
                    {item.note ? ` · ${item.note}` : ''}
                  </div>
                  {!locked ? (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => void remove(item.id)} className="!px-2 !py-1 rounded-lg text-sm font-medium text-rose-600 underline underline-offset-2">
                        Ta bort
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {/* Inmatningen försvinner när månaden är inlämnad — ersättningar är löneunderlag och fryser
              med perioden, precis som timmarna. Villkorlig rendering och inte `hidden`: preflight är
              av, så `hidden` och `flex` bråkar om display på samma element. */}
          {locked ? null : (
            <div className="grid gap-2 rounded-xl bg-[#f1f5ee] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className={crm.sectionTitle}>Typ</span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as CompensationKind)}
                    className="w-full rounded-lg border border-solid border-slate-200 bg-white px-2.5 py-2 text-sm"
                  >
                    {COMPENSATION_KINDS.map((option) => (
                      <option key={option} value={option}>{COMPENSATION_LABELS[option]}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className={crm.sectionTitle}>Datum</span>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                {unit ? (
                  <label className="grid gap-1">
                    <span className={crm.sectionTitle}>Antal ({unit})</span>
                    <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  </label>
                ) : null}
                <label className="grid gap-1">
                  <span className={crm.sectionTitle}>Belopp (kr)</span>
                  <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
              </div>
              <label className="grid gap-1">
                <span className={crm.sectionTitle}>Anteckning</span>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="T.ex. parkering Uppsala" />
              </label>
              <button
                type="button"
                onClick={() => void add()}
                disabled={saving || !amountValid}
                className="!py-2.5 w-full rounded-xl border border-solid border-[#cfdcc9] bg-white text-sm font-semibold text-slate-800 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Lägg till
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
