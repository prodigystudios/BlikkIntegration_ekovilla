"use client";
import React from 'react';
import PageShell from '@/components/ui/PageShell';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { minutesToHours } from '@/lib/domains/time/hours';
import { parseDecimal } from '@/lib/shared/number';
import { addDays, buildWeekDays, fmtISO, isoWeek, startOfWeek } from '@/app/crm/planering/planningDates';
import { COMPENSATION_KINDS, COMPENSATION_LABELS, COMPENSATION_UNITS, summarizeCompensations, type CompensationItem, type CompensationKind } from '@/lib/domains/time/compensations';
import TimeEntryModal, { type EditableEntry, type ReferenceData } from './TimeEntryModal';

// Tidrapporten, CRM-versionen. Ligger på /tid bredvid gamla /tidrapport (som fortsätter mot Blikk)
// tills cutovern i fas 4.6 — två levande vägar, precis som "Planering" och "Planering (äldre)".
//
// ⚠️ VECKOVY MED DAGKORT, av samma skäl som gamla sidan har det. Det här är den anställdes yta, och
// den dagliga frågan är "har jag rapporterat idag?" — den ska besvaras på en blick, inte genom att
// skanna en lista. En första version visade månaden; det var rätt form för den som läser lönen och
// fel för den som gör jobbet. Månadsöversikt per person, attest och export är lön/admins yta och
// ligger i Admin (fas 4.4–4.5), inte här.
//
// Månadssumman finns ändå kvar överst, tydligt märkt: det är den siffran man vill se innan man
// lämnar in perioden, och den är gratis eftersom hela månaden ändå hämtas.

type EntryRow = EditableEntry & {
  hours: number;
  work_order?: { order_number: string | null; fortnox_order_number: string | null; project_name: string | null; client_name: string | null } | null;
  internal_project?: { name: string } | null;
  absence_type?: { name: string } | null;
};

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2).replace('.', ',');
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
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

export default function TidClient() {
  const [weekOffset, setWeekOffset] = React.useState(0);
  const monday = React.useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
  const weekDays = React.useMemo(() => buildWeekDays(monday), [monday]);
  const todayIso = React.useMemo(() => fmtISO(new Date()), []);

  // Månaden som veckans måndag ligger i — det är den perioden lönen räknar på.
  const monthAnchor = React.useMemo(() => ({ year: monday.getFullYear(), month: monday.getMonth() }), [monday]);

  // En hämtning som täcker BÅDE veckan och dess månad: en vecka kan spänna över ett månadsskifte,
  // och då ska varken dagkorten eller månadssumman tappa rader.
  const fetchRange = React.useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const monthStart = `${monthAnchor.year}-${pad(monthAnchor.month + 1)}-01`;
    const lastDay = new Date(Date.UTC(monthAnchor.year, monthAnchor.month + 1, 0)).getUTCDate();
    const monthEnd = `${monthAnchor.year}-${pad(monthAnchor.month + 1)}-${pad(lastDay)}`;
    const weekStart = weekDays[0].iso;
    const weekEnd = weekDays[6].iso;
    return { from: weekStart < monthStart ? weekStart : monthStart, to: weekEnd > monthEnd ? weekEnd : monthEnd, monthStart, monthEnd };
  }, [monthAnchor, weekDays]);

  const [entries, setEntries] = React.useState<EntryRow[]>([]);
  const [compensations, setCompensations] = React.useState<CompensationItem[]>([]);
  const [reference, setReference] = React.useState<ReferenceData>({ time_code: [], internal_project: [], absence_type: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [modalDate, setModalDate] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<EditableEntry | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // Kapplöpningsvakt: klickar man snabbt genom veckorna kan ett tidigare svar komma sist och rita
  // fel veckas rader. Bara den senaste hämtningen får skriva.
  const loadSeq = React.useRef(0);

  const load = React.useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(null);
    try {
      const [entriesRes, compsRes, refRes] = await Promise.all([
        fetch(`/api/time/entries?from=${fetchRange.from}&to=${fetchRange.to}`, { cache: 'no-store' }),
        fetch(`/api/time/compensations?from=${fetchRange.monthStart}&to=${fetchRange.monthEnd}`, { cache: 'no-store' }),
        fetch('/api/time/reference', { cache: 'no-store' }),
      ]);
      const [entriesJson, compsJson, refJson] = await Promise.all([
        entriesRes.json().catch(() => ({})),
        compsRes.json().catch(() => ({})),
        refRes.json().catch(() => ({})),
      ]);
      if (seq !== loadSeq.current) return;
      if (!entriesRes.ok || !entriesJson.ok) throw new Error(entriesJson?.error || 'Kunde inte hämta tidrader');
      setEntries(entriesJson.data.items || []);
      if (compsRes.ok && compsJson.ok) setCompensations(compsJson.data.items || []);
      if (refRes.ok && refJson.ok) setReference(refJson.data);
    } catch (e) {
      if (seq === loadSeq.current) setError((e as Error).message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [fetchRange]);

  React.useEffect(() => { void load(); }, [load]);

  const byDate = React.useMemo(() => {
    const map = new Map<string, EntryRow[]>();
    for (const entry of entries) {
      const list = map.get(entry.work_date) ?? [];
      list.push(entry);
      map.set(entry.work_date, list);
    }
    return map;
  }, [entries]);

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

  return (
    <PageShell className="max-w-[1100px]">
      <section className={cn(crm.cardInner, 'grid gap-3')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h1 className={crm.pageTitle}>Tidrapport</h1>
            <p className={crm.pageSubtitle}>Rapportera din tid dag för dag — arbete, intern tid eller frånvaro.</p>
          </div>
          <button
            type="button"
            onClick={() => { setEditing(null); setModalDate(todayIso); }}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            Rapportera idag
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setWeekOffset((v) => v - 1); setLoading(true); }} className="rounded-lg border border-solid border-slate-200 bg-white px-3 py-1.5 text-sm">←</button>
          <span className="min-w-[130px] text-center text-sm font-semibold text-slate-900">
            v.{isoWeek(monday)} · {MONTHS[monthAnchor.month]}
          </span>
          <button type="button" onClick={() => { setWeekOffset((v) => v + 1); setLoading(true); }} className="rounded-lg border border-solid border-slate-200 bg-white px-3 py-1.5 text-sm">→</button>
          {weekOffset !== 0 ? (
            <button type="button" onClick={() => { setWeekOffset(0); setLoading(true); }} className="rounded-lg border border-solid border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600">
              Denna vecka
            </button>
          ) : null}
        </div>

        {/* Veckan är arbetsytan; månadssiffrorna är det man vill se innan perioden lämnas in. */}
        <div className="flex flex-wrap gap-2">
          <span className="rounded-xl border border-solid border-slate-200 bg-white px-3 py-2 text-sm">
            Veckan <strong className="text-base">{formatHours(weekTotal)} h</strong>
          </span>
          <span className="rounded-xl border border-solid border-slate-200 bg-white px-3 py-2 text-sm">
            {MONTHS[monthAnchor.month]}: arbetat <strong className="text-base">{formatHours(monthTotals.work)} h</strong>
          </span>
          <span className="rounded-xl border border-solid border-slate-200 bg-white px-3 py-2 text-sm">
            {MONTHS[monthAnchor.month]}: frånvaro <strong className="text-base">{formatHours(monthTotals.absence)} h</strong>
          </span>
          {monthTotals.byReason.map(([reason, minutes]) => (
            <span key={reason} className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
              {reason} {formatHours(minutes)} h
            </span>
          ))}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 underline">Stäng</button>
        </div>
      ) : null}

      {/* Ett kort per dag, hela veckan — även tomma dagar. Att en dag saknar rader är information:
          det är så man ser att man glömt rapportera. */}
      <section className="grid gap-2">
        {weekDays.map((day) => {
          const dayEntries = byDate.get(day.iso) ?? [];
          const worked = dayEntries.filter((e) => e.kind !== 'absence').reduce((sum, e) => sum + entryMinutes(e), 0);
          const absent = dayEntries.filter((e) => e.kind === 'absence').reduce((sum, e) => sum + entryMinutes(e), 0);
          const isToday = day.iso === todayIso;
          return (
            <div
              key={day.iso}
              className={cn(
                crm.card,
                'grid gap-2',
                isToday ? 'ring-2 ring-emerald-200' : '',
                day.isWeekend && dayEntries.length === 0 ? 'opacity-60' : '',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong className="text-sm capitalize text-slate-900">{day.weekday} {day.dayLabel}</strong>
                  {isToday ? <Badge variant="accent">Idag</Badge> : null}
                  {worked > 0 ? <span className="text-sm text-slate-600">{formatHours(worked)} h</span> : null}
                  {absent > 0 ? <span className="text-sm text-amber-700">{formatHours(absent)} h frånvaro</span> : null}
                </div>
                <button
                  type="button"
                  onClick={() => { setEditing(null); setModalDate(day.iso); }}
                  className="rounded-lg border border-solid border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                >
                  Rapportera
                </button>
              </div>

              {loading && dayEntries.length === 0 ? (
                <p className="m-0 text-sm text-slate-400">Laddar…</p>
              ) : dayEntries.length === 0 ? (
                <p className="m-0 text-sm text-slate-400">Inget rapporterat.</p>
              ) : (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {dayEntries.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-900">
                        {entry.start_time
                          ? `${entry.start_time.slice(0, 5)}–${(entry.end_time || '').slice(0, 5)}`
                          : `${formatHours(entryMinutes(entry))} h`}
                      </span>
                      {entry.break_minutes > 0 ? <span className="text-xs text-slate-400">rast {entry.break_minutes}m</span> : null}
                      <span className="text-slate-600">{entryLabel(entry)}</span>
                      {entry.kind !== 'absence' ? (
                        <span className="text-slate-500">{formatHours(entryMinutes(entry))} h</span>
                      ) : null}
                      {entry.note ? <span className="text-slate-400">{entry.note}</span> : null}
                      <span className="ml-auto flex gap-1">
                        <button type="button" onClick={() => { setEditing({ ...entry, work_order_label: entryLabel(entry) }); setModalDate(entry.work_date); }} className="px-1 text-sm text-slate-500 underline">
                          Ändra
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeEntry(entry.id)}
                          disabled={busyId === entry.id}
                          className="px-1 text-sm text-rose-600 underline disabled:opacity-50"
                        >
                          Ta bort
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      <CompensationSection
        items={compensations}
        totals={compensationTotals}
        monthLabel={`${MONTHS[monthAnchor.month]} ${monthAnchor.year}`}
        monthStart={fetchRange.monthStart}
        monthEnd={fetchRange.monthEnd}
        todayIso={todayIso}
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

// Traktamenten, utlägg och milersättning. Egen lista med flit: de har eget datum och hör inte till
// ett arbetspass — ett utlägg kan finnas en dag man inte jobbat. Visas per MÅNAD, till skillnad från
// tiden ovan: de är enstaka poster man går igenom när perioden ska lämnas in, inte en daglig syssla.
function CompensationSection({
  items, totals, monthLabel, monthStart, monthEnd, todayIso, onChanged, onError,
}: {
  items: CompensationItem[];
  totals: ReturnType<typeof summarizeCompensations>;
  monthLabel: string;
  monthStart: string;
  monthEnd: string;
  todayIso: string;
  onChanged: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
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
    <section className={cn(crm.card, 'grid gap-3')}>
      <div className="flex flex-wrap items-baseline gap-2 px-1">
        <h2 className="m-0 text-base font-bold text-slate-900">Traktamente, utlägg och milersättning</h2>
        <span className="text-sm text-slate-500">{monthLabel}</span>
        {totals.map((total) => (
          <Badge key={total.kind}>
            {COMPENSATION_LABELS[total.kind]} {formatAmount(total.amount)} kr
            {COMPENSATION_UNITS[total.kind] ? ` · ${total.quantity} ${COMPENSATION_UNITS[total.kind]}` : ''}
          </Badge>
        ))}
      </div>

      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-solid border-slate-200 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Datum</th>
                <th className="px-3 py-2">Typ</th>
                <th className="px-3 py-2">Antal</th>
                <th className="px-3 py-2">Belopp</th>
                <th className="px-3 py-2">Anteckning</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-solid border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">{item.entry_date}</td>
                  <td className="px-3 py-2">{COMPENSATION_LABELS[item.kind]}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {item.quantity != null ? `${item.quantity} ${COMPENSATION_UNITS[item.kind] ?? ''}` : '—'}
                  </td>
                  <td className="px-3 py-2 font-medium">{formatAmount(Number(item.amount))} kr</td>
                  <td className="px-3 py-2 text-slate-500">{item.note || ''}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => void remove(item.id)} className="px-2 py-1 text-sm text-rose-600 underline">
                      Ta bort
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m-0 px-1 text-sm text-slate-500">Inget inlagt i {monthLabel.toLowerCase()}.</p>
      )}

      <div className="flex flex-wrap items-end gap-2 px-1">
        <label className="grid gap-1">
          <span className="text-xs font-semibold text-slate-600">Typ</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CompensationKind)}
            className="rounded-lg border border-solid border-slate-200 px-2.5 py-1.5 text-sm"
          >
            {COMPENSATION_KINDS.map((option) => (
              <option key={option} value={option}>{COMPENSATION_LABELS[option]}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-semibold text-slate-600">Datum</span>
          <span className="inline-block w-40"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></span>
        </label>
        {unit ? (
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">Antal ({unit})</span>
            <span className="inline-block w-24"><Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></span>
          </label>
        ) : null}
        <label className="grid gap-1">
          <span className="text-xs font-semibold text-slate-600">Belopp (kr)</span>
          <span className="inline-block w-28"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></span>
        </label>
        <label className="grid flex-1 gap-1" style={{ minWidth: 160 }}>
          <span className="text-xs font-semibold text-slate-600">Anteckning</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="T.ex. parkering Uppsala" />
        </label>
        <button
          type="button"
          onClick={() => void add()}
          disabled={saving || !amountValid}
          className="rounded-lg border border-solid border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Lägg till
        </button>
      </div>
    </section>
  );
}
