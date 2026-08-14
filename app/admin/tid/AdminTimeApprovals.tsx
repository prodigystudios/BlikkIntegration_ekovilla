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
import {
  COMPENSATION_LABELS,
  COMPENSATION_UNITS,
  type CompensationItem,
} from '../../../lib/domains/time/compensations';
import type { PersonPeriodSummary } from '../../../lib/domains/time/summary';

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

/** '2026-08-14' → 'fre 14 aug'. Fälten plockas ur strängen och formateras i UTC, så ingen
 *  tidszon kan flytta datumet en dag — samma skäl som periodStartOf räknar på strängar. */
function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

/** Postgres `time` serialiseras som 'HH:MM:SS'. Sekunderna är alltid noll här och bara brus. */
function formatClock(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

type PersonDetail = {
  loading: boolean;
  error: string | null;
  summary: PersonPeriodSummary | null;
  compensations: CompensationItem[];
};

const EMPTY_DETAIL: PersonDetail = { loading: true, error: null, summary: null, compensations: [] };

export default function AdminTimeApprovals() {
  const [period, setPeriod] = React.useState(currentPeriod);
  const [people, setPeople] = React.useState<TimeApprovalOverviewRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // En person i taget öppen. Fler samtidiga hade betytt fler tillstånd att hålla i takt med
  // perioden, och dagvyn läses en person åt gången ändå.
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<PersonDetail | null>(null);

  // Samma kapplöpningsvakt som i /tid: bläddrar man snabbt mellan månader kan ett tidigare svar
  // komma sist och rita fel månads status — på en attestyta vore det ett dyrt misstag.
  const loadSeq = React.useRef(0);
  const detailSeq = React.useRef(0);

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

  // En öppen dagvy hör till den månad den hämtades för. Bläddrar man vidare måste den stängas —
  // annars ligger juli-dagarna kvar under augusti-raden och ser ut som augusti. Sekvensnumret
  // räknas upp så ett svar som redan är på väg inte kan rita upp den igen.
  React.useEffect(() => {
    detailSeq.current++;
    setExpandedId(null);
    setDetail(null);
  }, [period]);

  const loadDetail = React.useCallback(async (userId: string) => {
    const seq = ++detailSeq.current;
    setDetail(EMPTY_DETAIL);
    try {
      const res = await fetch(`/api/admin/time/entries?period=${period}&user_id=${userId}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => null);
      if (seq !== detailSeq.current) return;
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      setDetail({
        loading: false,
        error: null,
        summary: body.data as PersonPeriodSummary,
        compensations: (body.data.compensations || []) as CompensationItem[],
      });
    } catch (e) {
      // Hela tillståndet skrivs om, inte bara felet: lämnas summary kvar visas föregående persons
      // dagar under felrutan. Samma fälla som redan kostat en gång i den här vyn.
      if (seq === detailSeq.current) {
        setDetail({ loading: false, error: (e as Error).message, summary: null, compensations: [] });
      }
    }
  }, [period]);

  function toggleDetail(userId: string) {
    if (expandedId === userId) {
      detailSeq.current++;
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(userId);
    void loadDetail(userId);
  }

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
                const isExpanded = expandedId === row.user_id;
                return (
                  <React.Fragment key={row.user_id}>
                  <tr className="border-b border-solid border-slate-100 align-top">
                    <td className="px-3 py-2">
                      {/* Ikonknapp: globals.css ger varje <button> padding och centrering utan att
                          ligga i ett lager, så Tailwind måste gå före med `!`. */}
                      <button
                        type="button"
                        onClick={() => toggleDetail(row.user_id)}
                        aria-expanded={isExpanded}
                        className="!inline-flex !items-start !justify-start !p-0 !text-left"
                      >
                        <span aria-hidden className={`mt-0.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>›</span>
                        <span>
                          <span className="block font-medium text-slate-900 underline-offset-2 hover:underline">
                            {row.full_name || '(namn saknas)'}
                          </span>
                          <span className="block text-xs text-slate-400">{row.role}</span>
                        </span>
                      </button>
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
                  {isExpanded ? (
                    <tr className="border-b border-solid border-slate-100">
                      <td colSpan={7} className="bg-slate-50 px-3 py-3">
                        <PersonDays detail={detail} name={row.full_name} />
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * En persons månad, dag för dag.
 *
 * Lönepersonens enda uttryckliga krav (William 2026-08-14): hon vill se **starttid, sluttid och
 * total arbetad tid** när hon kontrollerar någons arbetstider. Aggregatet i tabellen ovanför går
 * inte att kontrollera — det ÄR summan av det man vill titta på.
 *
 * Kolumnerna följer byråns underlag (se TIME_AND_PAYROLL.md): datum, klockslag, arbetade timmar,
 * frånvarotimmar med orsak, anteckning. "Orsak / jobb" bär dessutom arbetsordern, vilket byrån inte
 * bett om — det är för kontorets egen granskning, som sedan piloten blåstes av är den enda
 * kontrollen som finns.
 *
 * Rader utan klockslag flaggas i stället för att visa ett tankstreck: de är kvar från kontorets
 * Tid-flik och ska bort innan klockslagen blir obligatoriska. En tom ruta hade sett ut som en
 * detalj; "saknas" är en uppgift.
 */
function PersonDays({ detail, name }: { detail: PersonDetail | null; name: string | null }) {
  if (!detail || detail.loading) return <p className="m-0 text-sm text-slate-400">Laddar dagar…</p>;
  if (detail.error) {
    return (
      <div className="rounded-lg border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        {detail.error}
      </div>
    );
  }

  const summary = detail.summary;
  if (!summary) return null;

  if (summary.rows.length === 0 && detail.compensations.length === 0) {
    return (
      <p className="m-0 text-sm text-slate-500">
        {name || 'Personen'} har inte rapporterat något den här månaden.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {summary.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                <th className="px-2 py-1.5">Datum</th>
                <th className="px-2 py-1.5">Klockslag</th>
                <th className="px-2 py-1.5 text-right">Arbetat</th>
                <th className="px-2 py-1.5 text-right">Frånvaro</th>
                <th className="px-2 py-1.5">Orsak / jobb</th>
                <th className="px-2 py-1.5">Anteckning</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((day, index) => {
                const start = formatClock(day.startTime);
                const end = formatClock(day.endTime);
                const isAbsence = day.absenceMinutes > 0;
                return (
                  <tr key={`${day.date}-${index}`} className="border-t border-solid border-slate-200 align-top">
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{formatDay(day.date)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">
                      {start && end ? (
                        `${start}–${end}`
                      ) : isAbsence ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className="font-semibold text-amber-700">saknas</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-900">
                      {day.workMinutes > 0 ? `${formatHours(day.workMinutes)} h` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">
                      {day.absenceMinutes > 0 ? `${formatHours(day.absenceMinutes)} h` : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {day.absenceReasons.length > 0 ? day.absenceReasons.join(', ') : day.label || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{day.note || ''}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-solid border-slate-300 font-semibold text-slate-900">
                <td className="px-2 py-2" colSpan={2}>Totalt</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatHours(summary.workMinutes)} h</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                  {summary.absenceMinutes > 0 ? `${formatHours(summary.absenceMinutes)} h` : '—'}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {/* Byrån behöver veta VILKEN ledighet, inte bara hur mycket — orsakerna har olika lönesort. */}
      {summary.absenceByReason.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          {summary.absenceByReason.map((item) => (
            <span key={item.reason} className="rounded-lg border border-solid border-slate-200 bg-white px-2 py-1">
              {item.reason}: {formatHours(item.minutes)} h
            </span>
          ))}
        </div>
      ) : null}

      {detail.compensations.length > 0 ? (
        <div className="grid gap-1">
          <p className="m-0 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Ersättningar</p>
          <ul className="m-0 grid list-none gap-1 p-0 text-sm text-slate-700">
            {detail.compensations.map((item) => {
              const unit = COMPENSATION_UNITS[item.kind];
              return (
                <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-slate-500">{formatDay(item.entry_date)}</span>
                  <span className="font-medium">{COMPENSATION_LABELS[item.kind] || item.kind}</span>
                  {unit && item.quantity != null ? (
                    <span className="text-slate-500">{formatAmount(item.quantity)} {unit}</span>
                  ) : null}
                  <span className="font-medium">{formatAmount(item.amount)} kr</span>
                  {item.note ? <span className="text-slate-500">· {item.note}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
