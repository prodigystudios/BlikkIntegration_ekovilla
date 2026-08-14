"use client";
import React from 'react';
import CrmModal from '@/app/crm/components/CrmModal';
import AdminTimeCorrectionModal, { type CorrectionReference } from './AdminTimeCorrectionModal';
import Input from '../../../components/ui/Input';
import { cn } from '../../../lib/shared/cn';
import { minutesToHours } from '../../../lib/domains/time/hours';
import {
  COMPENSATION_LABELS,
  COMPENSATION_UNITS,
  type CompensationItem,
} from '../../../lib/domains/time/compensations';
import {
  isPeriodLocked,
  periodLabel,
  periodStartOf,
  TIME_PERIOD_STATUS_LABELS,
  type TimeApprovalOverviewRow,
  type TimePeriodStatus,
} from '../../../lib/domains/time/approvals';
import type { PersonPeriodSummary } from '../../../lib/domains/time/summary';

// Admin → Attest. En kalendermånad per person, och knappen som fryser den.
//
// ⚠️ DEN HÄR VYN ÄR ERSÄTTNINGEN FÖR PILOTEN.
//
// Planen var att en bil skulle dubbelrapportera i /tid *utöver* Blikk under en löneperiod, så att
// summorna kunde jämföras maskinellt innan någon lön hängde på dem. Den planen är avblåst (chefen
// avslutar Blikk-licenserna, 2026-08-14), och i stället granskar två personer siffrorna för hand.
//
// Därför är vyn byggd för att LETA FEL, inte bara för att visa siffror: staplarna gör en avvikande
// månad synlig utan att någon behöver räknas, filtren tar en rakt till dem som inte lämnat in, och
// den som inte rapporterat något alls flaggas — en tom rad är precis den information man öppnar
// attesten för.
//
// ⚠️ INGA TRÖSKLAR, INGA OMDÖMEN. Stapeln är skalad mot gruppens största månad och säger bara "den
// här är kortare än de andra". Att sätta en gräns för hur många timmar som är "för få" vore att
// uppfinna en regel: systemet känner varken tjänstgöringsgrad eller schema, och en deltidare hade
// flaggats varje månad tills flaggan slutade betyda något.
//
// Ändra någon annans TIMMAR går inte, med flit (se RLS i 20260811_time_entries_rls.sql). Behöver en
// rad rättas öppnar man perioden med en anledning, och personen rättar själv. Det lämnar spår.
//
// OBS preflight är av (tailwind.config.js): `border` på en <div> ritar ingen linje utan
// `border-solid`, och <input> får `width: 100%` från globals.css.

const STATUS_TONE: Record<TimePeriodStatus, string> = {
  open: 'bg-slate-100 text-slate-600',
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
};

// Färgskenan i radens vänsterkant. Samma avläsning som CRM:ets listrader: status på en blick.
const STATUS_RAIL: Record<TimePeriodStatus, string> = {
  open: 'bg-slate-300',
  submitted: 'bg-amber-400',
  approved: 'bg-emerald-500',
};

// Fältetikett. Medvetet inte `crm.sectionTitle` — den är en avdelningsrubrik i slate-400 om 10 px,
// runt 2,6:1 mot vitt och alltså under WCAG AA. Samma konstant och samma skäl som i /tid.
const LABEL = 'text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600';

type Filter = 'all' | 'awaiting' | 'not_submitted' | 'empty';
type Sort = 'name' | 'hours_asc' | 'hours_desc';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Alla',
  awaiting: 'Väntar på attest',
  not_submitted: 'Ej inlämnade',
  empty: 'Inget rapporterat',
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

/** '2026-08-14' → 'fre 14 aug'. UTC-formatering, så ingen tidszon flyttar dagen. */
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

/**
 * Innevarande månad som 'ÅÅÅÅ-MM', i svensk tid.
 *
 * Zonen pinnas för att sidan server-renderas innan den hydreras och servern går på UTC: lokala
 * getters ger olika månad på server och klient den första i månaden mellan 00:00 och 02:00, vilket
 * är ett hydreringsfel på precis den yta där periodval betyder något. Samma fälla som PR #69.
 */
const STOCKHOLM_MONTH = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
});

function currentPeriod(): string {
  const parts = STOCKHOLM_MONTH.formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}`;
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
  const [filter, setFilter] = React.useState<Filter>('all');
  const [sort, setSort] = React.useState<Sort>('name');
  const [confirmBulk, setConfirmBulk] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [reopening, setReopening] = React.useState<TimeApprovalOverviewRow | null>(null);
  const [correcting, setCorrecting] = React.useState<PersonPeriodSummary['rows'][number] | null>(null);
  // Referenslistorna behövs bara när en rättelse öppnas, men hämtas en gång: de ändras sällan och
  // ett anrop per modalöppning hade gjort knappen trög utan att ge något.
  const [reference, setReference] = React.useState<CorrectionReference>({ time_code: [], internal_project: [], absence_type: [] });

  React.useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch('/api/time/reference', { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (active && res.ok && body?.ok) setReference(body.data);
    })();
    return () => { active = false; };
  }, []);

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
        // Töm listan. Står föregående månads rader kvar under felrutan attesterar "Attestera"
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
    setConfirmBulk(false);
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

  /**
   * Rätta eller ta bort någon annans tidrad.
   *
   * Går bara i en ÖPPEN period — låstriggern prövar radens ägare, så en attesterad månad avvisas av
   * databasen även om knappen skulle råka visas. Varje ändring loggas av en databastrigger, inte
   * härifrån: en väg som glömmer logga ska inte kunna finnas.
   *
   * Både dagvyn och personens summor ändras av en rättelse, så båda laddas om.
   */
  const correctEntry = React.useCallback(async (entryId: string, patch: Record<string, unknown> | null): Promise<string | null> => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/time/entries/${entryId}`, {
        method: patch ? 'PATCH' : 'DELETE',
        credentials: 'same-origin',
        ...(patch ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) } : {}),
      });
      const body = await res.json().catch(() => null);
      // Felet RETURNERAS i stället för att bara skrivas i sidans felruta: rättelsen sker i en modal,
      // och ett meddelande bakom den är ett meddelande ingen ser.
      if (!res.ok || !body?.ok) return body?.error || `Fel (${res.status})`;
      setNotice(patch ? 'Tidraden rättad.' : 'Tidraden borttagen.');
      if (expandedId) await loadDetail(expandedId);
      await load();
      return null;
    } catch {
      return 'Kunde inte spara ändringen — kontrollera uppkopplingen';
    }
  }, [expandedId, loadDetail, load]);

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

  /** En statusövergång. Returnerar felmeddelandet, eller null när det gick bra. */
  const postStatus = React.useCallback(async (userId: string, status: TimePeriodStatus, note?: string) => {
    try {
      const res = await fetch('/api/time/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ period, status, user_id: userId, note: note ?? null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) return body?.error || `Fel (${res.status})`;
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [period]);

  async function setStatus(row: TimeApprovalOverviewRow, status: TimePeriodStatus, note?: string) {
    setBusyId(row.user_id);
    setError(null);
    setNotice(null);
    const failure = await postStatus(row.user_id, status, note);
    if (failure) setError(failure);
    else {
      setNotice(
        status === 'approved'
          ? `${row.full_name || 'Personen'} attesterad för ${periodLabel(periodStartOf(period))}.`
          : `${periodLabel(periodStartOf(period))} öppnad igen för ${row.full_name || 'personen'}.`,
      );
      await load();
    }
    setBusyId(null);
  }

  const submitted = React.useMemo(() => people.filter((row) => row.status === 'submitted'), [people]);

  /**
   * Attestera alla inlämnade i ett svep.
   *
   * Sekventiellt och inte parallellt: RPC:n tar ett advisory lock per person och period, och en
   * skur av samtidiga anrop hade bara köat på databassidan utan att gå fortare. Viktigare är att
   * ett DELVIS misslyckande måste gå att läsa — därför räknas felen och rapporteras rakt ut i
   * stället för att ett rött meddelande får det att se ut som att ingenting gick igenom.
   */
  async function approveAllSubmitted() {
    setConfirmBulk(false);
    setBulkBusy(true);
    setError(null);
    setNotice(null);

    const failures: string[] = [];
    for (const row of submitted) {
      const failure = await postStatus(row.user_id, 'approved');
      if (failure) failures.push(`${row.full_name || 'Okänd'}: ${failure}`);
    }

    // ⚠️ LADDA OM FÖRST, SKRIV BESKEDET SEN. `load()` nollställer felrutan som sitt första steg, så
    // ett besked satt före anropet hann aldrig synas — och misslyckades ALLA blev det varken notis
    // eller fel: massattesten såg ut att ha gått igenom fast ingen period rörde sig.
    await load();

    const done = submitted.length - failures.length;
    if (done > 0) setNotice(`${done} av ${submitted.length} attesterade för ${periodLabel(periodStartOf(period))}.`);
    if (failures.length > 0) setError(`Gick inte att attestera ${failures.length}: ${failures.join(' · ')}`);

    setBulkBusy(false);
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
        empty: acc.empty + (row.entry_count === 0 ? 1 : 0),
      }),
      { work: 0, absence: 0, compensation: 0, submitted: 0, approved: 0, open: 0, empty: 0 },
    );
  }, [people]);

  // Skalan för staplarna: gruppens största månad, arbete och frånvaro tillsammans. Ingen tröskel,
  // ingen norm — bara en gemensam linjal, så att en kort stapel syns utan att någon döms.
  const scaleMinutes = React.useMemo(
    () => Math.max(1, ...people.map((row) => row.work_minutes + row.absence_minutes)),
    [people],
  );

  const visible = React.useMemo(() => {
    const matches = people.filter((row) => {
      if (filter === 'awaiting') return row.status === 'submitted';
      if (filter === 'not_submitted') return row.status === 'open';
      if (filter === 'empty') return row.entry_count === 0;
      return true;
    });
    const sorted = [...matches];
    if (sort === 'hours_asc') sorted.sort((a, b) => a.work_minutes - b.work_minutes);
    else if (sort === 'hours_desc') sorted.sort((a, b) => b.work_minutes - a.work_minutes);
    else sorted.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'sv'));
    return sorted;
  }, [people, filter, sort]);

  const filterCount: Record<Filter, number> = {
    all: people.length,
    awaiting: totals.submitted,
    not_submitted: totals.open,
    empty: totals.empty,
  };

  return (
    // ⚠️ Padding hör hemma HÄR, inte i skalet. AdminTabsClient renderar flikinnehållet i en
    // `crm.card`, och den tokenen har medvetet ingen padding ("content controls its own padding")
    // — så utan p-5 ligger rubriken och korten klistrade mot kortkanten. Systerfliken
    // AdminTimeReference gör likadant, och de två ska se lika ut eftersom de sitter bredvid
    // varandra i samma flikrad.
    <div className="grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Attest</h2>
        <p className="m-0 text-sm text-slate-600">
          Lås en kalendermånad per person. Inlämnad och attesterad tid går inte att ändra — varken av
          den anställde eller härifrån. Behöver något rättas: öppna perioden med en anledning, så
          rättar personen själv.
        </p>
      </div>

      {/* Periodhuvud. Två frågor, åtskilda med flit: hur långt har jag kommit (framstegen) och hur
          stora är summorna (underlaget). Förut låg båda som sex likadana badges i rad. */}
      {/* En rad, tre kolumner — inte tre fullbreddsblock under varandra. På en 1200 px-yta blir
          staplade block bara innehåll som klistras mot ytterkanterna med luft i mitten. */}
      <section className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-solid border-[#e0e8dc] bg-[#f9fbf7] p-3.5">
        <label className="grid gap-1">
          <span className={LABEL}>Period</span>
          <span className="inline-block w-40">
            {/* Låst under massattesten. Loopen tar sekunder, och dess avslutande omladdning gäller
                den period den startade i: byter man månad mitt i vinner den sist startade
                hämtningen och målar föregående månads rader under den nya rubriken — varpå nästa
                "Attestera" postar fel månad på siffror som hör till en annan. */}
            <Input
              type="month"
              value={period}
              disabled={bulkBusy}
              onChange={(e) => setPeriod(e.target.value || currentPeriod())}
            />
          </span>
        </label>

        {people.length > 0 ? (
          <div className="grid min-w-[220px] max-w-[420px] flex-1 gap-1">
            <span className={LABEL}>Attesterade</span>
            <span className="flex items-center gap-3">
              <span className="whitespace-nowrap text-lg font-bold leading-none tabular-nums text-slate-900">
                {totals.approved} <span className="text-sm font-semibold text-slate-500">av {people.length}</span>
              </span>
              {/* Ett segment per person, färgat av status: månadens form på en blick. */}
              <span className="flex h-2 flex-1 gap-0.5 overflow-hidden rounded-full">
                {people.map((row) => (
                  <span key={row.user_id} className={cn('flex-1', STATUS_RAIL[row.status])} aria-hidden />
                ))}
              </span>
            </span>
          </div>
        ) : null}

        <div className="grid gap-1">
          <span className={LABEL}>Underlag</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm leading-none text-slate-600">
            <span>Arbetat <strong className="tabular-nums text-slate-900">{formatHours(totals.work)} h</strong></span>
            {totals.absence > 0 ? <span>Frånvaro <strong className="tabular-nums text-amber-800">{formatHours(totals.absence)} h</strong></span> : null}
            {totals.compensation > 0 ? <span>Ersättningar <strong className="tabular-nums text-slate-900">{formatAmount(totals.compensation)} kr</strong></span> : null}
          </span>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      ) : null}

      {/* Filtren är granskningens arbetsredskap: de tar en rakt till dem som inte lämnat in eller
          inte rapporterat något. Ett filter utan träffar visas ändå, med sin nolla — att listan är
          tom är svaret man letade efter. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                '!px-3 !py-1.5 rounded-full border border-solid text-sm font-semibold transition',
                filter === key
                  ? 'border-transparent bg-slate-900 text-white'
                  : 'border-[#dbe4d6] bg-white text-slate-600 hover:border-slate-400',
                key === 'empty' && filterCount.empty > 0 && filter !== key ? 'text-amber-800' : '',
              )}
            >
              {FILTER_LABELS[key]} <span className="tabular-nums opacity-70">{filterCount[key]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className={LABEL}>Sortera</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-lg border border-solid border-[#dbe4d6] bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="name">Namn</option>
              <option value="hours_asc">Timmar, lägst först</option>
              <option value="hours_desc">Timmar, högst först</option>
            </select>
          </label>

          {submitted.length > 0 ? (
            confirmBulk ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">Attestera {submitted.length}?</span>
                <button
                  type="button"
                  onClick={() => void approveAllSubmitted()}
                  className="!px-3 !py-1.5 rounded-lg border border-solid border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800"
                >
                  Ja, attestera
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBulk(false)}
                  className="!px-2 !py-1.5 rounded-lg text-sm font-semibold text-slate-500"
                >
                  Avbryt
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmBulk(true)}
                disabled={bulkBusy}
                className="!px-3 !py-1.5 rounded-lg border border-solid border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800 transition hover:border-emerald-400 disabled:opacity-60"
              >
                {bulkBusy ? 'Attesterar…' : `Attestera alla inlämnade (${submitted.length})`}
              </button>
            )
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="m-0 text-sm text-slate-400">Laddar…</p>
      ) : people.length === 0 ? (
        <p className="m-0 text-sm text-slate-500">Inga anställda att visa.</p>
      ) : visible.length === 0 ? (
        <p className="m-0 text-sm text-slate-500">Ingen matchar “{FILTER_LABELS[filter]}” i {periodLabel(periodStartOf(period))}.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {visible.map((row) => (
            <PersonRow
              key={row.user_id}
              row={row}
              scaleMinutes={scaleMinutes}
              expanded={expandedId === row.user_id}
              detail={expandedId === row.user_id ? detail : null}
              busy={busyId === row.user_id || bulkBusy}
              onToggle={() => toggleDetail(row.user_id)}
              onApprove={() => void setStatus(row, 'approved')}
              onReopen={() => setReopening(row)}
              onEdit={setCorrecting}
              onDelete={async (entryId) => {
                const failure = await correctEntry(entryId, null);
                if (failure) setError(failure);
                return !failure;
              }}
            />
          ))}
        </ul>
      )}

      {correcting ? (
        <AdminTimeCorrectionModal
          day={correcting}
          reference={reference}
          onClose={() => setCorrecting(null)}
          onSave={async (patch) => {
            const failure = await correctEntry(correcting.entryId!, patch);
            if (failure) return failure;
            setCorrecting(null);
            return null;
          }}
        />
      ) : null}

      {reopening ? (
        <ReopenModal
          row={reopening}
          periodStart={periodStartOf(period)}
          onClose={() => setReopening(null)}
          onSubmit={async (note) => {
            // Modalen stängs FÖRST när anropet lyckats. Stängdes den före anropet försvann den
            // skrivna anledningen vid ett 409 eller ett nätverksfel — och det är hela beskedet till
            // den anställde om vad som ska rättas, alltså det dyraste i rutan att tappa.
            const failure = await postStatus(reopening.user_id, 'open', note);
            if (failure) return failure;
            setNotice(`${periodLabel(periodStartOf(period))} öppnad igen för ${reopening.full_name || 'personen'}.`);
            setReopening(null);
            await load();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * En person i listan.
 *
 * Stapeln är radens signatur: alla skalas mot gruppens största månad, så en kort stapel syns direkt
 * utan att någon behöver jämföra tal. Frånvaron ligger som ett eget segment efter arbetstiden —
 * en månad med mycket frånvaro har kort arbetsstapel av ett skäl man ska kunna se, inte gissa.
 */
function PersonRow({
  row, scaleMinutes, expanded, detail, busy, onToggle, onApprove, onReopen, onEdit, onDelete,
}: {
  row: TimeApprovalOverviewRow;
  scaleMinutes: number;
  expanded: boolean;
  detail: PersonDetail | null;
  busy: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReopen: () => void;
  onEdit: (day: PersonPeriodSummary['rows'][number]) => void;
  onDelete: (entryId: string) => Promise<boolean>;
}) {
  const locked = isPeriodLocked(row.status);
  const workPercent = Math.round((row.work_minutes / scaleMinutes) * 100);
  const absencePercent = Math.round((row.absence_minutes / scaleMinutes) * 100);

  return (
    // Vit fyllning, inte sage. Fliken renderas i en `crm.card` som REDAN är #f9fbf7 — ett kort i
    // samma ton på samma ton skiljs bara av en hårlinje i #e0e8dc, och då läser raderna som en enda
    // yta. Samma grepp som tidraderna i /tid: vitt kort på sage-underlag.
    <li className="overflow-hidden rounded-2xl border border-solid border-[#e0e8dc] bg-white">
      {/* EN rad med kolumner, inte tre band under varandra. Staplade fullbreddsblock på en yta som
          är över tusen pixlar bred ger innehåll klistrat mot ytterkanterna och luft i mitten — och
          en stapel som spänner hela bredden läser som en trasig avdelare, inte som ett mått.
          Kolumnerna radbryts i stället på smala skärmar. */}
      <div className="flex">
        <span className={cn('w-1 shrink-0', STATUS_RAIL[row.status])} aria-hidden />

        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          {/* Namn + den lilla historiken. Roll och tidsstämpel på samma rad sparar ett band. */}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="!inline-flex !items-baseline !justify-start !gap-2 !p-0 !text-left min-w-[180px] flex-1"
          >
            <span aria-hidden className={cn('shrink-0 text-slate-400 transition-transform', expanded ? 'rotate-90' : '')}>›</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-slate-900 underline-offset-2 hover:underline">
                {row.full_name || '(namn saknas)'}
              </span>
              <span className="block truncate text-xs text-slate-400">
                {row.role}
                {row.status === 'submitted' && row.submitted_at ? ` · Inlämnad ${formatStamp(row.submitted_at)}` : null}
                {row.status === 'approved' && row.approved_at
                  ? ` · Attesterad ${formatStamp(row.approved_at)}${row.approved_by_name ? ` av ${row.approved_by_name}` : ''}`
                  : null}
                {row.status === 'open' && row.note ? ` · Öppnad igen: ${row.note}` : null}
              </span>
            </span>
          </button>

          {/* Måttet: stapeln är avgränsad och står bredvid talet den mäter, inte över hela raden. */}
          <div className="flex min-w-[210px] flex-1 items-center gap-3">
            <span className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[#e8eee4]">
              <span className="bg-[#4a7a58]" style={{ width: `${workPercent}%` }} aria-hidden />
              <span className="bg-amber-400" style={{ width: `${absencePercent}%` }} aria-hidden />
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-sm">
              <strong className="tabular-nums text-slate-900">{formatHours(row.work_minutes)} h</strong>
              {row.absence_minutes > 0 ? (
                <span className="whitespace-nowrap tabular-nums text-amber-800">{formatHours(row.absence_minutes)} h frånvaro</span>
              ) : null}
              <span className="whitespace-nowrap text-slate-500">
                <span className="tabular-nums">{row.entry_count}</span> {row.entry_count === 1 ? 'rad' : 'rader'}
              </span>
              {row.compensation_count > 0 ? (
                <span className="whitespace-nowrap text-slate-500"><span className="tabular-nums">{formatAmount(row.compensation_amount)}</span> kr</span>
              ) : null}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Noll rader på en person som ska ha rapporterat är det attesten finns för att
                upptäcka — därför en egen flagga och inte bara en siffra i en kolumn. */}
            {row.entry_count === 0 ? (
              <span className="whitespace-nowrap rounded-full border border-solid border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                Inget rapporterat
              </span>
            ) : null}
            <span className={cn('whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[row.status])}>
              {TIME_PERIOD_STATUS_LABELS[row.status]}
            </span>
          </div>

          <div className="flex shrink-0 gap-2">
            {row.status !== 'approved' ? (
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                className="!px-3 !py-1.5 rounded-lg border border-solid border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800 transition hover:border-emerald-400 disabled:opacity-60"
              >
                Attestera
              </button>
            ) : null}
            {locked ? (
              <button
                type="button"
                onClick={onReopen}
                disabled={busy}
                className="!px-3 !py-1.5 rounded-lg border border-solid border-[#dbe4d6] bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
              >
                Öppna igen
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="border-x-0 border-b-0 border-t border-solid border-[#e4ebe0] bg-[#f9fbf7] px-4 py-3">
          {/* Rättelse bara i en öppen period. Är månaden inlämnad eller attesterad avvisar databasen
              ändringen ändå — knappen döljs för att slippa be någon trycka på något som inte går. */}
          <PersonDays detail={detail} name={row.full_name} canCorrect={!locked} onEdit={onEdit} onDelete={onDelete} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Återöppning med en anledning.
 *
 * Ett riktigt fält, inte window.prompt: texten går rakt till den anställde i /tid och är hela
 * beskedet om vad som ska rättas. En rå webbläsardialog gav ingen plats att skriva mer än en rad,
 * ingen formatering och inget sätt att se vad som stod där sist.
 *
 * Anledningen är fortfarande VALFRI. Tom text skickas som null — ingen anledning är bättre än en
 * tom sträng, och att tvinga fram en mening hade gjort "." till standardsvaret.
 */
function ReopenModal({
  row, periodStart, onClose, onSubmit,
}: {
  row: TimeApprovalOverviewRow;
  periodStart: string;
  onClose: () => void;
  /** Felmeddelandet, eller null när det gick bra. Vid fel stannar modalen kvar med texten i behåll. */
  onSubmit: (note?: string) => Promise<string | null>;
}) {
  const [note, setNote] = React.useState(row.note || '');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Öppna perioden igen"
      maxWidth="sm:max-w-[460px]"
      header={
        <>
          <h2 className="text-lg font-bold text-slate-900">Öppna {periodLabel(periodStart)} igen</h2>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {row.full_name || 'Personen'} kan då rätta sin tid själv och lämna in på nytt.
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
            onClick={async () => {
              setBusy(true);
              setFailure(null);
              const result = await onSubmit(note.trim() || undefined);
              // Lyckades det avmonterar föräldern oss — då finns ingen state kvar att skriva till.
              if (result) { setFailure(result); setBusy(false); }
            }}
            disabled={busy}
            className="!py-2.5 flex-1 rounded-xl text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60 sm:ml-auto sm:flex-none sm:!px-5"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {busy ? 'Öppnar…' : 'Öppna igen'}
          </button>
        </>
      }
    >
      {failure ? (
        <div className="mb-3 rounded-xl border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{failure}</div>
      ) : null}

      <label className="grid gap-1">
        <span className={LABEL}>Anledning (valfri)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          className="w-full rounded-xl border border-solid border-[#dbe4d6] bg-white px-3 py-2 text-sm text-slate-900"
          placeholder="T.ex. Onsdag 12/8 saknar klockslag — fyll i och lämna in igen."
        />
        <span className="text-xs text-slate-500">Syns för {row.full_name || 'personen'} i Tidrapport.</span>
      </label>
    </CrmModal>
  );
}

/**
 * En persons månad, dag för dag.
 *
 * Lönepersonens enda uttryckliga krav (William 2026-08-14): hon vill se **starttid, sluttid och
 * total arbetad tid** när hon kontrollerar någons arbetstider. Aggregatet i raden ovanför går inte
 * att kontrollera — det ÄR summan av det man vill titta på.
 *
 * Kolumnerna följer byråns underlag (se TIME_AND_PAYROLL.md): datum, klockslag, arbetade timmar,
 * frånvarotimmar med orsak, anteckning. "Orsak / jobb" bär dessutom arbetsordern, vilket byrån inte
 * bett om — det är för kontorets egen granskning, som sedan piloten blåstes av är den enda
 * kontrollen som finns.
 *
 * Rader utan klockslag flaggas i stället för att visa ett tankstreck: en tom ruta hade sett ut som
 * en detalj, "saknas" är en uppgift.
 */
function PersonDays({
  detail, name, canCorrect, onEdit, onDelete,
}: {
  detail: PersonDetail | null;
  name: string | null;
  canCorrect: boolean;
  onEdit: (day: PersonPeriodSummary['rows'][number]) => void;
  onDelete: (entryId: string) => Promise<boolean>;
}) {
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
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                <th className="px-2 py-1.5">Datum</th>
                <th className="px-2 py-1.5">Klockslag</th>
                <th className="px-2 py-1.5 text-right">Arbetat</th>
                <th className="px-2 py-1.5 text-right">Frånvaro</th>
                <th className="px-2 py-1.5">Orsak / jobb</th>
                <th className="px-2 py-1.5">Anteckning</th>
                {canCorrect ? <th className="px-2 py-1.5" /> : null}
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((day, index) => (
                <DayRowCells
                  key={day.entryId || `${day.date}-${index}`}
                  day={day}
                  canCorrect={canCorrect}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-x-0 border-b-0 border-t-2 border-solid border-slate-300 font-semibold text-slate-900">
                <td className="px-2 py-2" colSpan={2}>Totalt</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatHours(summary.workMinutes)} h</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                  {summary.absenceMinutes > 0 ? `${formatHours(summary.absenceMinutes)} h` : '—'}
                </td>
                <td colSpan={canCorrect ? 3 : 2} />
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
          <p className={cn(LABEL, 'm-0')}>Ersättningar</p>
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

/**
 * En dag i underlaget — och, i en öppen period, raden man rättar.
 *
 * Rättelsen ändrar BARA klockslag, rast och frånvarotimmar. Vilket jobb raden hör till, vilken dag
 * den ligger på och om den är arbete eller frånvaro kommer alltid från raden själv (mergeCorrection
 * i lib/domains/time/entries.ts). Skillnaden är avsiktlig: att laga ett felskrivet klockslag är en
 * sak, att skriva om någons löneunderlag en annan.
 *
 * Frånvaro har inga klockslag — byrån vill ha den i timmar — så den får ett timfält i stället.
 */
function DayRowCells({
  day, canCorrect, onEdit, onDelete,
}: {
  day: PersonPeriodSummary['rows'][number];
  canCorrect: boolean;
  onEdit: (day: PersonPeriodSummary['rows'][number]) => void;
  onDelete: (entryId: string) => Promise<boolean>;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const start = formatClock(day.startTime);
  const end = formatClock(day.endTime);
  const isAbsence = day.absenceMinutes > 0;


  // Rättelse kräver att raden går att peka ut. Saknas id:t är den läsbar men inte ändringsbar —
  // hellre ingen knapp än en som svarar 404.
  const editable = canCorrect && !!day.entryId;

  return (
    <tr className="border-x-0 border-b-0 border-t border-solid border-slate-200 align-top">
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
      {canCorrect ? (
        <td className="whitespace-nowrap px-2 py-1.5 text-right">
          {!editable ? null : confirmDelete ? (
            <span className="flex items-center justify-end gap-2 text-sm">
              <span className="text-slate-500">Ta bort?</span>
              <button
                type="button"
                onClick={async () => { setBusy(true); await onDelete(day.entryId!); setBusy(false); setConfirmDelete(false); }}
                disabled={busy}
                className="!p-0 font-semibold text-rose-600 disabled:opacity-50"
              >
                Ja
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="!p-0 text-slate-400">Nej</button>
            </span>
          ) : (
            <span className="flex items-center justify-end gap-3 text-sm">
              <button
                type="button"
                onClick={() => onEdit(day)}
                className="!p-0 font-medium text-slate-600 underline underline-offset-2"
              >
                Rätta
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="!p-0 font-medium text-slate-400 hover:text-rose-600">
                Ta bort
              </button>
            </span>
          )}
        </td>
      ) : null}
    </tr>
  );
}
