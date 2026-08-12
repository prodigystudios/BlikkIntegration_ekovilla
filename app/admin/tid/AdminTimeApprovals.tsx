"use client";
import React from 'react';
import Badge from '../../../components/ui/Badge';
import Input from '../../../components/ui/Input';
import { minutesToHours } from '../../../lib/domains/time/hours';
import {
  isPeriodLocked,
  periodLabel,
  periodStartOf,
  TIME_PERIOD_STATUS_LABELS,
  type TimeApprovalOverviewRow,
  type TimePeriodStatus,
} from '../../../lib/domains/time/approvals';

// Admin → Attest. Fas 4.4: en kalendermånad per person, och knappen som fryser den.
//
// Vyn visar ALLA anställda, även de som inte rapporterat en enda timme — en tom rad är precis den
// information man öppnar attesten för. Siffrorna finns med av samma skäl: attest utan underlag är
// bara en knapp, och den som attesterar ska kunna se att 143 timmar är rimligt innan hen trycker.
//
// Ändra någon annans TIMMAR går inte, med flit (se RLS i 20260811_time_entries_rls.sql). Behöver en
// rad rättas öppnar man perioden med en anledning, och personen rättar själv. Det är den enda vägen,
// och den lämnar spår.
//
// OBS preflight är av (tailwind.config.js): `border` på en <div> ritar ingen linje utan
// `border-solid`, och <input> får `width: 100%` från globals.css.

const STATUS_TONE: Record<TimePeriodStatus, string> = {
  open: 'bg-slate-100 text-slate-600',
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
};

function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2).replace('.', ',');
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

function formatStamp(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short' }).format(date);
}

/** Innevarande månad som 'ÅÅÅÅ-MM'. Lokala getters, inte toISOString: den senare är UTC. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdminTimeApprovals() {
  const [period, setPeriod] = React.useState(currentPeriod);
  const [people, setPeople] = React.useState<TimeApprovalOverviewRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // Samma kapplöpningsvakt som i /tid: bläddrar man snabbt mellan månader kan ett tidigare svar
  // komma sist och rita fel månads status — på en attestyta vore det ett dyrt misstag.
  const loadSeq = React.useRef(0);

  const load = React.useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/time/approvals?period=${period}`, { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (seq !== loadSeq.current) return;
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      setPeople(body.data.people || []);
    } catch (e) {
      if (seq === loadSeq.current) {
        setError((e as Error).message);
        // Töm tabellen. Står föregående månads rader kvar under felrutan attesterar "Attestera"
        // den NYA perioden utifrån den GAMLA månadens siffror — och setStatus rensar felrutan
        // först, så det sista som varnade försvinner i samma klick.
        setPeople([]);
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [period]);

  React.useEffect(() => { void load(); }, [load]);

  async function setStatus(row: TimeApprovalOverviewRow, status: TimePeriodStatus, note?: string) {
    setBusyId(row.user_id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/time/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ period, status, user_id: row.user_id, note: note ?? null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      setNotice(
        status === 'approved'
          ? `${row.full_name || 'Personen'} attesterad för ${periodLabel(periodStartOf(period))}.`
          : `${periodLabel(periodStartOf(period))} öppnad igen för ${row.full_name || 'personen'}.`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function reopen(row: TimeApprovalOverviewRow) {
    // Anledningen är inte byråkrati: den syns för den anställde i /tid och är hela beskedet om vad
    // som ska rättas. Tom sträng skickas som null — ingen anledning är bättre än "".
    const note = window.prompt(`Varför öppnas ${periodLabel(periodStartOf(period))} igen för ${row.full_name || 'personen'}?`, row.note || '');
    if (note === null) return;
    void setStatus(row, 'open', note.trim() || undefined);
  }

  const totals = React.useMemo(() => {
    return people.reduce(
      (acc, row) => ({
        work: acc.work + row.work_minutes,
        absence: acc.absence + row.absence_minutes,
        compensation: acc.compensation + row.compensation_amount,
        submitted: acc.submitted + (row.status === 'submitted' ? 1 : 0),
        approved: acc.approved + (row.status === 'approved' ? 1 : 0),
        open: acc.open + (row.status === 'open' ? 1 : 0),
      }),
      { work: 0, absence: 0, compensation: 0, submitted: 0, approved: 0, open: 0 },
    );
  }, [people]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Attest</h2>
        <p className="m-0 text-sm text-slate-600">
          Lås en kalendermånad per person. Inlämnad och attesterad tid går inte att ändra — varken av
          den anställde eller härifrån. Behöver något rättas: öppna perioden med en anledning, så
          rättar personen själv.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-xs font-semibold text-slate-600">Period</span>
          <span className="inline-block w-40">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value || currentPeriod())} />
          </span>
        </label>
        <div className="flex flex-wrap gap-2 pb-1">
          <Badge>{totals.open} öppna</Badge>
          <Badge variant="accent">{totals.submitted} inlämnade</Badge>
          <Badge>{totals.approved} attesterade</Badge>
          <Badge>Totalt {formatHours(totals.work)} h</Badge>
          {totals.absence > 0 ? <Badge>Frånvaro {formatHours(totals.absence)} h</Badge> : null}
          {totals.compensation > 0 ? <Badge>Ersättningar {formatAmount(totals.compensation)} kr</Badge> : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      ) : null}

      {loading ? (
        <p className="m-0 text-sm text-slate-400">Laddar…</p>
      ) : people.length === 0 ? (
        <p className="m-0 text-sm text-slate-500">Inga anställda att visa.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-solid border-slate-200 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Arbetat</th>
                <th className="px-3 py-2 text-right">Frånvaro</th>
                <th className="px-3 py-2 text-right">Rader</th>
                <th className="px-3 py-2 text-right">Ersättningar</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {people.map((row) => {
                const locked = isPeriodLocked(row.status);
                return (
                  <tr key={row.user_id} className="border-b border-solid border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{row.full_name || '(namn saknas)'}</div>
                      <div className="text-xs text-slate-400">{row.role}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-lg px-2 py-1 text-xs font-semibold ${STATUS_TONE[row.status]}`}>
                        {TIME_PERIOD_STATUS_LABELS[row.status]}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.status === 'submitted' && row.submitted_at ? `Inlämnad ${formatStamp(row.submitted_at)}` : null}
                        {row.status === 'approved' && row.approved_at
                          ? `Attesterad ${formatStamp(row.approved_at)}${row.approved_by_name ? ` av ${row.approved_by_name}` : ''}`
                          : null}
                        {row.status === 'open' && row.note ? `Öppnad igen: ${row.note}` : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{formatHours(row.work_minutes)} h</td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {row.absence_minutes > 0 ? `${formatHours(row.absence_minutes)} h` : '—'}
                    </td>
                    {/* Noll rader på en person som ska ha rapporterat är det attesten finns för att
                        upptäcka — därför en egen kolumn och inte bara timmarna. */}
                    <td className={`px-3 py-2 text-right ${row.entry_count === 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                      {row.entry_count}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {row.compensation_count > 0 ? `${formatAmount(row.compensation_amount)} kr` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {row.status !== 'approved' ? (
                        <button
                          type="button"
                          onClick={() => void setStatus(row, 'approved')}
                          disabled={busyId === row.user_id}
                          className="rounded-lg border border-solid border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:border-emerald-400 disabled:opacity-60"
                        >
                          Attestera
                        </button>
                      ) : null}
                      {locked ? (
                        <button
                          type="button"
                          onClick={() => reopen(row)}
                          disabled={busyId === row.user_id}
                          className="ml-2 rounded-lg border border-solid border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
                        >
                          Öppna igen
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
