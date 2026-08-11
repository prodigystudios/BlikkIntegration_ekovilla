"use client";
import React from 'react';
import PageShell from '@/components/ui/PageShell';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { minutesToHours } from '@/lib/domains/time/hours';
import { COMPENSATION_KINDS, COMPENSATION_LABELS, COMPENSATION_UNITS, summarizeCompensations, type CompensationItem, type CompensationKind } from '@/lib/domains/time/compensations';
import TimeEntryModal, { type EditableEntry, type ReferenceData } from './TimeEntryModal';

// Tidrapporten, CRM-versionen. Ligger på /tid bredvid gamla /tidrapport (som fortsätter mot Blikk)
// tills cutovern i fas 4.6 — två levande vägar, precis som "Planering" och "Planering (äldre)".
//
// MÅNADSVY, inte veckovy som den gamla sidan. Löneperioden är en kalendermånad och byrån vill ha
// "en summering totalt arbetad tid och frånvaro för månaden" — då är det månaden man ska kunna se i
// ett svep, och det är också vad man vill granska innan man lämnar in den.

type EntryRow = EditableEntry & {
  hours: number;
  work_order?: { order_number: string | null; fortnox_order_number: string | null; project_name: string | null; client_name: string | null } | null;
  internal_project?: { name: string } | null;
  absence_type?: { name: string } | null;
};

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

function monthRange(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(last)}` };
}

function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2).replace('.', ',');
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
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
  const today = React.useMemo(() => new Date(), []);
  const [year, setYear] = React.useState(today.getFullYear());
  const [month, setMonth] = React.useState(today.getMonth());

  const [entries, setEntries] = React.useState<EntryRow[]>([]);
  const [compensations, setCompensations] = React.useState<CompensationItem[]>([]);
  const [reference, setReference] = React.useState<ReferenceData>({ time_code: [], internal_project: [], absence_type: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EditableEntry | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const range = React.useMemo(() => monthRange(year, month), [year, month]);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [entriesRes, compsRes, refRes] = await Promise.all([
        fetch(`/api/time/entries?from=${range.from}&to=${range.to}`, { cache: 'no-store' }),
        fetch(`/api/time/compensations?from=${range.from}&to=${range.to}`, { cache: 'no-store' }),
        fetch('/api/time/reference', { cache: 'no-store' }),
      ]);
      const [entriesJson, compsJson, refJson] = await Promise.all([
        entriesRes.json().catch(() => ({})),
        compsRes.json().catch(() => ({})),
        refRes.json().catch(() => ({})),
      ]);
      if (!entriesRes.ok || !entriesJson.ok) throw new Error(entriesJson?.error || 'Kunde inte hämta tidrader');
      setEntries(entriesJson.data.items || []);
      if (compsRes.ok && compsJson.ok) setCompensations(compsJson.data.items || []);
      if (refRes.ok && refJson.ok) setReference(refJson.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  React.useEffect(() => { void load(); }, [load]);

  const totals = React.useMemo(() => {
    let work = 0;
    let absence = 0;
    const byReason = new Map<string, number>();
    for (const entry of entries) {
      const minutes = entry.minutes_worked ?? Math.round(Number(entry.hours || 0) * 60);
      if (entry.kind === 'absence') {
        absence += minutes;
        const reason = entry.absence_type?.name || '(orsak saknas)';
        byReason.set(reason, (byReason.get(reason) ?? 0) + minutes);
      } else {
        work += minutes;
      }
    }
    return {
      work,
      absence,
      byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'sv')),
    };
  }, [entries]);

  const compensationTotals = React.useMemo(() => summarizeCompensations(compensations), [compensations]);

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, month + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
    setLoading(true);
  }

  async function removeEntry(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/time/entries/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ta bort raden'); return; }
      await load();
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
            <p className={crm.pageSubtitle}>Din arbetade tid, frånvaro och ersättningar — månad för månad.</p>
          </div>
          <button
            type="button"
            onClick={() => { setEditing(null); setModalOpen(true); }}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            Rapportera tid
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => shiftMonth(-1)} className="rounded-lg border border-solid border-slate-200 bg-white px-3 py-1.5 text-sm">←</button>
          <span className="min-w-[150px] text-center text-sm font-semibold text-slate-900">{MONTHS[month]} {year}</span>
          <button type="button" onClick={() => shiftMonth(1)} className="rounded-lg border border-solid border-slate-200 bg-white px-3 py-1.5 text-sm">→</button>
          <button
            type="button"
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setLoading(true); }}
            className="rounded-lg border border-solid border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600"
          >
            Denna månad
          </button>
        </div>

        {/* Summeringen byrån bad om: total arbetad tid och frånvaro för månaden. */}
        <div className="flex flex-wrap gap-2">
          <span className="rounded-xl border border-solid border-slate-200 bg-white px-3 py-2 text-sm">
            Arbetad tid <strong className="text-base">{formatHours(totals.work)} h</strong>
          </span>
          <span className="rounded-xl border border-solid border-slate-200 bg-white px-3 py-2 text-sm">
            Frånvaro <strong className="text-base">{formatHours(totals.absence)} h</strong>
          </span>
          {totals.byReason.map(([reason, minutes]) => (
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

      <section className={crm.card}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-solid border-slate-200 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Datum</th>
                <th className="px-3 py-2">Start–slut</th>
                <th className="px-3 py-2">Arbetad tid</th>
                <th className="px-3 py-2">Frånvaro</th>
                <th className="px-3 py-2">Vad</th>
                <th className="px-3 py-2">Anteckning</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-6 text-slate-500">Laddar…</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-slate-500">Inget rapporterat den här månaden.</td></tr>
              ) : null}
              {entries.map((entry) => {
                const minutes = entry.minutes_worked ?? Math.round(Number(entry.hours || 0) * 60);
                const isAbsence = entry.kind === 'absence';
                return (
                  <tr key={entry.id} className="border-b border-solid border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">{entry.work_date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                      {entry.start_time ? `${entry.start_time.slice(0, 5)}–${(entry.end_time || '').slice(0, 5)}` : '—'}
                      {entry.break_minutes > 0 ? <span className="ml-1 text-xs text-slate-400">rast {entry.break_minutes}m</span> : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{isAbsence ? '—' : `${formatHours(minutes)} h`}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{isAbsence ? `${formatHours(minutes)} h` : '—'}</td>
                    <td className="px-3 py-2">{entryLabel(entry)}</td>
                    <td className="px-3 py-2 text-slate-500">{entry.note || ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => { setEditing(entry); setModalOpen(true); }}
                        className="px-2 py-1 text-sm text-slate-500 underline"
                      >
                        Ändra
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeEntry(entry.id)}
                        disabled={busyId === entry.id}
                        className="px-2 py-1 text-sm text-rose-600 underline disabled:opacity-50"
                      >
                        Ta bort
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <CompensationSection
        items={compensations}
        totals={compensationTotals}
        range={range}
        onChanged={load}
        onError={setError}
      />

      {modalOpen ? (
        <TimeEntryModal
          reference={reference}
          defaultDate={new Date().toISOString().slice(0, 10)}
          entry={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); void load(); }}
        />
      ) : null}
    </PageShell>
  );
}

// Traktamenten, utlägg och milersättning. Egen lista med flit: de har eget datum och hör inte till
// ett arbetspass — ett utlägg kan finnas en dag man inte jobbat.
function CompensationSection({
  items, totals, range, onChanged, onError,
}: {
  items: CompensationItem[];
  totals: ReturnType<typeof summarizeCompensations>;
  range: { from: string; to: string };
  onChanged: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = React.useState<CompensationKind>('travel');
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const unit = COMPENSATION_UNITS[kind];

  async function add() {
    setSaving(true);
    try {
      const res = await fetch('/api/time/compensations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_date: date,
          kind,
          // Svenskt decimalkomma är vad folk skriver — parsas här så servern får en punkt.
          quantity: unit ? Number(quantity.replace(',', '.')) || null : null,
          amount: Number(amount.replace(',', '.')) || 0,
          note: note.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { onError(json?.error || 'Kunde inte spara posten'); return; }
      setQuantity(''); setAmount(''); setNote('');
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/time/compensations/${id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { onError(json?.error || 'Kunde inte ta bort posten'); return; }
    await onChanged();
  }

  return (
    <section className={cn(crm.card, 'grid gap-3')}>
      <div className="flex flex-wrap items-baseline gap-2 px-1">
        <h2 className="m-0 text-base font-bold text-slate-900">Traktamente, utlägg och milersättning</h2>
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
        <p className="m-0 px-1 text-sm text-slate-500">Inget inlagt för {range.from.slice(0, 7)}.</p>
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
          disabled={saving || !amount.trim()}
          className="rounded-lg border border-solid border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Lägg till
        </button>
      </div>
    </section>
  );
}
