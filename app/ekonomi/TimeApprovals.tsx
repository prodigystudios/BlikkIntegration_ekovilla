"use client";
import React from 'react';
import CrmModal from '@/app/crm/components/CrmModal';
import TimeCorrectionModal, { type CorrectionReference } from './TimeCorrectionModal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { crm } from '@/app/crm/lib/crmTokens';
import { ADMIN_ERROR_BOX, ADMIN_NOTICE_BOX, AdminFilterChip } from '@/app/admin/components/adminUi';
import { cn } from '@/lib/shared/cn';
import { minutesToHours } from '@/lib/domains/time/hours';
import {
  COMPENSATION_LABELS,
  COMPENSATION_UNITS,
  countMissingReceipts,
  formatQuantity,
  hasReceipt,
  isReceiptMissing,
  summarizeCompensations,
  type CompensationItem,
} from '@/lib/domains/time/compensations';
import {
  isPeriodLocked,
  periodLabel,
  periodStartOf,
  TIME_PERIOD_STATUS_LABELS,
  type TimeApprovalOverviewRow,
  type TimePeriodStatus,
} from '@/lib/domains/time/approvals';
import { reminderReasonFor, remindableUsers, smsReachSentence } from '@/lib/domains/time/reminders';
import { breakWasDeducted, reasonOrJobLabel, type PersonPeriodSummary } from '@/lib/domains/time/summary';
import {
  auditActionLabel,
  auditWorkDate,
  describeAuditChange,
  type TimeEntryAuditRow,
} from '@/lib/domains/time/audit';

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
// Att ändra någon annans timmar KRÄVER att perioden är öppen och nyckeln `time.entry.write.all`
// (20260814_time_admin_corrections.sql — den filen äger numera write-policyerna, INTE
// 20260811_time_entries_rls.sql). Låstriggern prövar radens ägare, så attesterad tid är orörbar
// även härifrån, och varje rättelse av någon annans rad skrivs till crm_time_entry_audit av en
// databastrigger.
//
// OBS <input> är 100 % brett som default (globals.css). Regeln ligger i `:where()` sedan
// 2026-08-16, så en breddklass på fältet vinner utan `!`.

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
  audit: TimeEntryAuditRow[];
  auditFailed: boolean;
};

const EMPTY_DETAIL: PersonDetail = {
  loading: true, error: null, summary: null, compensations: [], audit: [], auditFailed: false,
};

export default function TimeApprovals() {
  const [period, setPeriod] = React.useState(currentPeriod);
  const [people, setPeople] = React.useState<TimeApprovalOverviewRow[]>([]);
  // Får den HÄR användaren rätta någon ANNANS timmar (`time.entry.write.all`)? Följer med
  // översikten, eftersom en klient inte kan fråga efter sina egna behörigheter.
  //
  // ⚠️ Inte samma sak som att få attestera. Lönebyrån (rollen `ekonomi`) har time.approve men
  // aldrig write.all: hon rapporterar avvikelser, den anställde rättar själv. Defaulten är false
  // — fail-closed, så en misslyckad hämtning aldrig kan rita fram knapparna.
  const [canCorrectOthers, setCanCorrectOthers] = React.useState(false);
  // Får den här användaren skicka påminnelsen som SMS (`time.reminder.sms`)? Egen nyckel, admin-only
  // i seeden: lönebyrån påminner i appen men sms:ar inte personalens privata mobiler på företagets
  // bekostnad. Fail-closed som can_correct — en misslyckad hämtning får aldrig rita fram rutan.
  const [canSms, setCanSms] = React.useState(false);
  // Skelettet härleds ur VILKEN PERIOD som faktiskt är hämtad, det sätts inte för hand.
  //
  // Förut satte varje load() `loading = true`, även omladdningen efter en rättelse. Då byttes hela
  // listan mot "Laddar…", sidan blev kort, och webbläsaren tappade scrollpositionen — man kastades
  // till toppen efter varje sparning. Datan måste hämtas om (timmar, radantal och gruppens
  // stapelskala kommer ur RPC:n), men vyn behöver inte rivas ner för det.
  const [loadedPeriod, setLoadedPeriod] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [sort, setSort] = React.useState<Sort>('name');
  const [confirmBulk, setConfirmBulk] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [reopening, setReopening] = React.useState<TimeApprovalOverviewRow | null>(null);
  // Påminnelser. `reminders` = senaste påminnelsen per person för DEN HÄR månaden, `hasPhone` = om
  // det finns ett nummer att sms:a till.
  //
  // ⚠️ `remindersOk` skiljer "ingen är påmind" från "vi vet inte". Går adminläsningen fel (den
  // kringgår RLS med flit — notiser är bara läsbara för sin mottagare) ska vyn TIGA om både
  // historik och telefonnummer i stället för att rita frånvaron som ett faktum. En trasig
  // servicenyckel skulle annars se ut som att hela personalen saknar telefonnummer.
  const [reminders, setReminders] = React.useState<Record<string, string>>({});
  const [hasPhone, setHasPhone] = React.useState<Record<string, boolean>>({});
  const [remindersOk, setRemindersOk] = React.useState(false);
  const [reminding, setReminding] = React.useState<TimeApprovalOverviewRow[] | null>(null);
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
    setError(null);
    try {
      const res = await fetch(`/api/admin/time/approvals?period=${period}`, { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (seq !== loadSeq.current) return;
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      setPeople(body.data.people || []);
      setCanCorrectOthers(body.data.can_correct === true);
      setCanSms(body.data.can_sms === true);
      setReminders(body.data.reminders || {});
      setHasPhone(body.data.has_phone || {});
      setRemindersOk(body.data.reminders_ok === true);
    } catch (e) {
      if (seq === loadSeq.current) {
        setError((e as Error).message);
        // Töm listan. Står föregående månads rader kvar under felrutan attesterar "Attestera"
        // den NYA perioden utifrån den GAMLA månadens siffror — och setStatus rensar felrutan
        // först, så det sista som varnade försvinner i samma klick.
        setPeople([]);
        // Samma regel som statusen: ett tillstånd som styr knappar måste skrivas i FELGRENEN
        // också. Annars låg föregående lyckade hämtnings `true` kvar och ritade rättaknappar
        // ovanpå en tom lista. Gäller påminnelserna med — en kvarliggande "Påmind 3 sep" från
        // förra månaden hade fått någon att avstå från att påminna.
        setCanCorrectOthers(false);
        setCanSms(false);
        setReminders({});
        setHasPhone({});
        setRemindersOk(false);
      }
    } finally {
      // Även efter ett fel: felrutan förklarar vad som hände, ett evigt skelett gör det inte.
      if (seq === loadSeq.current) setLoadedPeriod(period);
    }
  }, [period]);

  const loading = loadedPeriod !== period;

  React.useEffect(() => { void load(); }, [load]);

  // En öppen dagvy hör till den månad den hämtades för. Bläddrar man vidare måste den stängas —
  // annars ligger juli-dagarna kvar under augusti-raden och ser ut som augusti. Sekvensnumret
  // räknas upp så ett svar som redan är på väg inte kan rita upp den igen.
  React.useEffect(() => {
    detailSeq.current++;
    setExpandedId(null);
    setDetail(null);
    setConfirmBulk(false);
    // Även påminnelsemodalen: den håller de personer som var värda att påminna i FÖRRA månaden, men
    // utskicket postar den period som är vald NU. Kvar öppen hade den skickat julis lista märkt
    // "augusti".
    setReminding(null);
  }, [period]);

  const loadDetail = React.useCallback(async (userId: string, opts?: { keepVisible?: boolean }) => {
    const seq = ++detailSeq.current;
    // `keepVisible` vid omladdning efter en rättelse: raderna byts ut när svaret kommer i stället
    // för att ersättas av "Laddar dagar…" och tillbaka igen. En rad som blinkar bort och kommer
    // åter flyttar allt under sig — och blicken med.
    if (!opts?.keepVisible) setDetail(EMPTY_DETAIL);
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
        audit: (body.data.audit || []) as TimeEntryAuditRow[],
        auditFailed: !!body.data.audit_failed,
      });
    } catch (e) {
      // Hela tillståndet skrivs om, inte bara felet: lämnas summary kvar visas föregående persons
      // dagar under felrutan. Samma fälla som redan kostat en gång i den här vyn.
      if (seq === detailSeq.current) {
        setDetail({ loading: false, error: (e as Error).message, summary: null, compensations: [], audit: [], auditFailed: false });
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
      if (expandedId) await loadDetail(expandedId, { keepVisible: true });
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

  /**
   * Skicka påminnelsen. Notisen går alltid; SMS är ett tillval.
   *
   * Servern avgör vem som FAKTISKT påminns och varför — listan här kan ha hunnit bli inaktuell
   * medan modalen stod öppen, och svaret säger hur många som hoppades över. Det rapporteras rakt
   * ut i stället för att en lägre siffra tyst ska se ut som ett fel.
   */
  const sendReminders = React.useCallback(
    async (rows: TimeApprovalOverviewRow[], message: string | null, sendSms: boolean): Promise<string | null> => {
      try {
        const res = await fetch('/api/admin/time/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ period, user_ids: rows.map((row) => row.user_id), message, send_sms: sendSms }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) return body?.error || `Fel (${res.status})`;

        const d = body.data;
        const parts = [d.notified === 1 ? '1 påminnelse skickad' : `${d.notified} påminnelser skickade`];
        // ⚠️ "Kunde inte läsa numren" är INTE samma sak som "ingen har nummer". Utan den här grenen
        // hade beskedet sagt att hela personalen saknar telefonnummer, och någon börjat leta i
        // profilerna efter ett fel som inte finns.
        if (sendSms && d.sms_lookup_failed) parts.push('men SMS kunde inte skickas — telefonnumren gick inte att läsa');
        else if (sendSms) {
          parts.push(`${d.sms_sent} som SMS`);
          if (d.sms_missing_phone > 0) parts.push(`${d.sms_missing_phone} saknar telefonnummer`);
          if (d.sms_failed?.length) parts.push(`SMS misslyckades för ${d.sms_failed.join(', ')}`);
        }
        if (d.skipped > 0) parts.push(`${d.skipped} behövde inte påminnas längre`);
        // ⚠️ LADDA OM FÖRST, SKRIV BESKEDET SEN — samma ordning och samma skäl som massattesten:
        // `load()` nollställer felrutan som sitt första steg, och ett besked satt före anropet
        // riskerar att hamna under ett fel som skrivs efteråt. Omladdningen får dessutom
        // "Påmind i dag" att synas direkt på raderna man just skickade till.
        await load();
        setNotice(`${parts.join(' · ')}.`);
        return null;
      } catch {
        return 'Kunde inte skicka påminnelsen — kontrollera uppkopplingen';
      }
    },
    [period, load],
  );

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

  // Massutskicket följer det AKTIVA FILTRET, inte hela listan: står du på "Ej inlämnade" påminner
  // knappen just dem. Att alltid skicka till alla hade gjort filtren till dekoration — och den som
  // filtrerat fram fyra personer förväntar sig fyra påminnelser, inte tjugo.
  const remindableVisible = React.useMemo(() => remindableUsers(visible), [visible]);

  /**
   * Pågår månaden fortfarande?
   *
   * Varje pågående månad står `open` för alla, så den andra september är hela personalen tekniskt
   * "ej inlämnad" — fast ingen lämnar in mitt i en månad. Massutskicket är därför inte SPÄRRAT
   * (ni kan behöva jaga in tiden före ett lönestopp den 25:e), men modalen säger rakt ut att
   * månaden inte är slut, så en ovanlig åtgärd inte ser ut som en vardaglig.
   *
   * ⚠️ Var tidigare en spärr som DOLDE knappen. Den regeln var rimlig men tyst, och en knapp som
   * bara uteblir är en gåta, inte en regel — William hittade den inte när han testade.
   *
   * Strängjämförelse duger: 'ÅÅÅÅ-MM' sorterar som det ska.
   */
  const periodOngoing = period >= currentPeriod();

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
        {/* Sista meningen gäller bara den som HAR `time.entry.write.all`. Lönebyrån attesterar men
            rättar aldrig — hade texten stått kvar för henne hade den lovat en knapp som inte finns,
            och skickat henne att leta efter den. */}
        <p className="m-0 text-sm text-slate-600">
          Lås en kalendermånad per person. Inlämnad och attesterad tid går inte att ändra — öppna
          perioden med en anledning först, så kan den anställde rätta själv.
          {canCorrectOthers
            ? ' Du kan också rätta raderna härifrån när perioden är öppen; varje sådan ändring loggas med ditt namn.'
            : ' Hittar du ett fel: öppna perioden med en anledning, så rättar den anställde själv.'}
        </p>
      </div>

      {/* Periodhuvud. Två frågor, åtskilda med flit: hur långt har jag kommit (framstegen) och hur
          stora är summorna (underlaget). Förut låg båda som sex likadana badges i rad. */}
      {/* En rad, tre kolumner — inte tre fullbreddsblock under varandra. På en 1200 px-yta blir
          staplade block bara innehåll som klistras mot ytterkanterna med luft i mitten. */}
      <section className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-3.5">
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
        <div role="alert" className={ADMIN_ERROR_BOX}>{error}</div>
      ) : null}
      {notice ? (
        <div role="status" className={ADMIN_NOTICE_BOX}>{notice}</div>
      ) : null}

      {/* Filtren är granskningens arbetsredskap: de tar en rakt till dem som inte lämnat in eller
          inte rapporterat något. Ett filter utan träffar visas ändå, med sin nolla — att listan är
          tom är svaret man letade efter. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Husets chip, inte en egen. Den här raden var handkodad med `bg-slate-900` i aktivt läge —
            Tailwinds slate-skala är blåviolett (#0f172a), så mot skalets varma sage läste den som
            LILA bredvid en app som annars är grön. AdminFilterChip bär redan var(--ek-green) och
            används av fyra systerytor (användare, behörigheter, Blikk-koppling, ärenden). */}
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
            <AdminFilterChip
              key={key}
              active={filter === key}
              onClick={() => setFilter(key)}
              count={filterCount[key]}
              // "Inget rapporterat" gulmarkeras när den har träffar: en tom rad är precis det man
              // öppnar attesten för, och signalen ska synas utan att man klickar på filtret.
              tone={key === 'empty' && filterCount.empty > 0 ? 'attention' : 'default'}
            >
              {FILTER_LABELS[key]}
            </AdminFilterChip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className={LABEL}>Sortera</span>
            {/* 🧨 `min-w-*` är inte kosmetik. En `<select>` bredder sig efter sitt LÄNGSTA alternativ
                och står därför stilla; vår knapp visar bara det VALDA, så utan spärren krympte
                kontrollen från "Timmar, lägst först" till "Namn" och hela verktygsraden till höger
                hoppade i sidled när man bytte sortering. Måttet är satt efter det LÄNGSTA
                alternativet ("Timmar, lägst först") vid 16 px — den storlek iOS tvingar fram via
                `button[role='combobox']` — plus padding, mellanrum och chevron. Räknat på 14 px
                hade det kapats på telefon. Ändras alternativen: kontrollera måttet.
                📐 Höjden skrivs `min-h-0`, ALDRIG `h-*`: basen sätter `min-h-11` och `h-*` hamnar i
                en annan tailwind-merge-grupp, så båda hade överlevt och 44 px vunnit tyst. */}
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sortera"
              className="min-h-0 min-w-[210px] px-2.5 py-1.5"
            >
              <option value="name">Namn</option>
              <option value="hours_asc">Timmar, lägst först</option>
              <option value="hours_desc">Timmar, högst först</option>
            </Select>
          </label>

          {/* Påminn dem filtret visar. Samma laddningsvillkor som massattesten nedan och av samma
              skäl: under en månadsväxling ligger föregående månads rader kvar, och knappen hade
              annars skickat påminnelser om FEL månad. */}
          {!loading && remindableVisible.length > 0 ? (
            <button
              type="button"
              onClick={() => setReminding(remindableVisible)}
              disabled={bulkBusy}
              className="px-3 py-1.5 rounded-lg border border-[#dbe4d6] bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
            >
              {remindableVisible.length === 1
                ? 'Påminn 1 person'
                : `Påminn ${remindableVisible.length} personer`}
            </button>
          ) : null}

          {/* ⚠️ Bara när periodens data faktiskt är hämtad. `people` töms inte vid månadsbyte, så
              under laddningen låg föregående månads inlämnade kvar — och knappen hade attesterat
              DEM under den NYA perioden. */}
          {!loading && submitted.length > 0 ? (
            confirmBulk ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">Attestera {submitted.length}?</span>
                <button
                  type="button"
                  onClick={() => void approveAllSubmitted()}
                  className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800"
                >
                  Ja, attestera
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBulk(false)}
                  className="px-2 py-1.5 rounded-lg text-sm font-semibold text-slate-500"
                >
                  Avbryt
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmBulk(true)}
                disabled={bulkBusy}
                className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800 transition hover:border-emerald-400 disabled:opacity-60"
              >
                {bulkBusy ? 'Attesterar…' : `Attestera alla inlämnade (${submitted.length})`}
              </button>
            )
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="m-0 text-sm text-slate-500">Laddar…</p>
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
              canCorrectOthers={canCorrectOthers}
              remindedAt={remindersOk ? reminders[row.user_id] ?? null : null}
              onToggle={() => toggleDetail(row.user_id)}
              onApprove={() => void setStatus(row, 'approved')}
              onReopen={() => setReopening(row)}
              onRemind={() => setReminding([row])}
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
        <TimeCorrectionModal
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

      {reminding ? (
        <ReminderModal
          rows={reminding}
          periodStart={periodStartOf(period)}
          hasPhone={hasPhone}
          phoneKnown={remindersOk}
          canSms={canSms}
          periodOngoing={periodOngoing}
          onClose={() => setReminding(null)}
          onSubmit={async (chosen, message, sendSms) => {
            // Stänger FÖRST när anropet lyckats — samma skäl som återöppningen: ett 409 eller
            // nätverksfel får inte radera det man skrivit.
            const failure = await sendReminders(chosen, message, sendSms);
            if (failure) return failure;
            setReminding(null);
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
  row, scaleMinutes, expanded, detail, busy, canCorrectOthers, remindedAt, onToggle, onApprove, onReopen, onRemind, onEdit, onDelete,
}: {
  row: TimeApprovalOverviewRow;
  scaleMinutes: number;
  expanded: boolean;
  detail: PersonDetail | null;
  busy: boolean;
  /** `time.entry.write.all` — se kommentaren vid tillståndet i TimeApprovals. */
  canCorrectOthers: boolean;
  /** När personen senast påmindes om den här månaden. null = aldrig, ELLER att vi inte vet. */
  remindedAt: string | null;
  onToggle: () => void;
  onApprove: () => void;
  onReopen: () => void;
  onRemind: () => void;
  onEdit: (day: PersonPeriodSummary['rows'][number]) => void;
  onDelete: (entryId: string) => Promise<boolean>;
}) {
  const locked = isPeriodLocked(row.status);
  // Knappen visas bara där den kan göra något: en öppen månad. `submitted` betyder att personen
  // gjort sitt och väntar på OSS — att knuffa henne då är att be om något hon redan lämnat.
  const remindable = reminderReasonFor(row) !== null;
  const workPercent = Math.round((row.work_minutes / scaleMinutes) * 100);
  const absencePercent = Math.round((row.absence_minutes / scaleMinutes) * 100);

  return (
    // Vit fyllning, inte sage. Fliken renderas i en `crm.card` som REDAN är #f9fbf7 — ett kort i
    // samma ton på samma ton skiljs bara av en hårlinje i #e0e8dc, och då läser raderna som en enda
    // yta. Samma grepp som tidraderna i /tid: vitt kort på sage-underlag.
    <li className="overflow-hidden rounded-2xl border border-[#e0e8dc] bg-white">
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
            className="inline-flex items-baseline justify-start gap-2 p-0 text-left min-w-[180px] flex-1"
          >
            <span aria-hidden className={cn('shrink-0 text-slate-500 transition-transform', expanded ? 'rotate-90' : '')}>›</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-slate-900 underline-offset-2 hover:underline">
                {row.full_name || '(namn saknas)'}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {row.role}
                {row.status === 'submitted' && row.submitted_at ? ` · Inlämnad ${formatStamp(row.submitted_at)}` : null}
                {row.status === 'approved' && row.approved_at
                  ? ` · Attesterad ${formatStamp(row.approved_at)}${row.approved_by_name ? ` av ${row.approved_by_name}` : ''}`
                  : null}
                {row.status === 'open' && row.note ? ` · Öppnad igen: ${row.note}` : null}
                {/* Vad som redan gjorts åt den här raden. Utan den skickar man en andra påminnelse
                    samma dag utan att veta om det — särskilt lätt hänt via massutskicket. */}
                {remindedAt ? ` · Påmind ${formatStamp(remindedAt)}` : null}
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
              {/* ⚠️ ANTALET POSTER FÖRST, kronorna bara när det finns några.
                  Kolumnen visade rakt av `compensation_amount` kr. Sedan traktamente och
                  milersättning ersätts med fasta satser bär de inget belopp, så en person med bara
                  resor och traktamenten hade stått som "0,00 kr" — vilket läser som att hon inte
                  ska ha någon ersättning alls. Summan är fortfarande sann (den är kronorna på
                  posterna, i praktiken utläggen); det som saknades var att posterna finns.
                  Mil och dagar står per post i detaljpanelen, som är där satserna tillämpas. */}
              {row.compensation_count > 0 ? (
                <span className="whitespace-nowrap text-slate-500">
                  <span className="tabular-nums">{row.compensation_count}</span>{' '}
                  {row.compensation_count === 1 ? 'ersättning' : 'ersättningar'}
                  {row.compensation_amount > 0 ? <> · <span className="tabular-nums">{formatAmount(row.compensation_amount)}</span> kr</> : null}
                </span>
              ) : null}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Noll rader på en person som ska ha rapporterat är det attesten finns för att
                upptäcka — därför en egen flagga och inte bara en siffra i en kolumn. */}
            {row.entry_count === 0 ? (
              <span className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                Inget rapporterat
              </span>
            ) : null}
            <span className={cn('whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[row.status])}>
              {TIME_PERIOD_STATUS_LABELS[row.status]}
            </span>
          </div>

          <div className="flex shrink-0 gap-2">
            {remindable ? (
              <button
                type="button"
                onClick={onRemind}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg border border-[#dbe4d6] bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
              >
                Påminn
              </button>
            ) : null}
            {row.status !== 'approved' ? (
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800 transition hover:border-emerald-400 disabled:opacity-60"
              >
                Attestera
              </button>
            ) : null}
            {locked ? (
              <button
                type="button"
                onClick={onReopen}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg border border-[#dbe4d6] bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
              >
                Öppna igen
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="border-x-0 border-b-0 border-t border-[#e4ebe0] bg-[#f9fbf7] px-4 py-3">
          {/* TVÅ villkor, och båda är "be ingen trycka på något som inte går":
              1. Perioden måste vara ÖPPEN — låstriggern avvisar annars ändringen ändå.
              2. Användaren måste ha `time.entry.write.all`. Sedan rollen `ekonomi` finns är det
                 inte längre samma personer som får attestera: lönebyrån låser månaden men ändrar
                 aldrig någons timmar. Utan villkoret fick hon knappar vars enda utfall är 403. */}
          <PersonDays
            detail={detail}
            name={row.full_name}
            canCorrect={!locked && canCorrectOthers}
            onEdit={onEdit}
            onDelete={onDelete}
          />
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
            className={cn(crm.ghostButton, 'h-auto flex-1 py-2.5 sm:flex-none sm:px-5')}
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
            className={cn(crm.formButton, 'h-auto flex-1 py-2.5 sm:ml-auto sm:flex-none sm:px-5')}
            style={{ backgroundColor: 'var(--ek-green)' }}
          >
            {busy ? 'Öppnar…' : 'Öppna igen'}
          </button>
        </>
      }
    >
      {failure ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{failure}</div>
      ) : null}

      <label className="grid gap-1">
        <span className={LABEL}>Anledning (valfri)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          className="w-full rounded-xl border border-[#dbe4d6] bg-white px-3 py-2 text-sm text-slate-900"
          placeholder="T.ex. Onsdag 12/8 saknar klockslag — fyll i och lämna in igen."
        />
        <span className="text-xs text-slate-500">Syns för {row.full_name || 'personen'} i Tidrapport.</span>
      </label>
    </CrmModal>
  );
}

/**
 * Påminnelsen: "fyll i tiden som saknas".
 *
 * Samma modal för en person och för ett helt filter — skillnaden är bara hur många som står i
 * listan, och den listan visas alltid. Ett massutskick där mottagarna är osynliga är ett utskick
 * man inte kan granska innan det går.
 *
 * ⚠️ Modalen skriver inte texten om vad som saknas. Den byggs på servern ur samma underlag som
 * listan (lib/domains/time/reminders.ts) och säger bara det appen faktiskt vet: att månaden inte
 * är inlämnad, eller att ingen tid är rapporterad. Aldrig ett antal dagar — systemet känner varken
 * tjänstgöringsgrad eller schema.
 */
function ReminderModal({
  rows, periodStart, hasPhone, phoneKnown, canSms, periodOngoing, onClose, onSubmit,
}: {
  rows: TimeApprovalOverviewRow[];
  periodStart: string;
  hasPhone: Record<string, boolean>;
  /** Falskt när telefonuppgiften inte gick att läsa — då säger modalen inget om nummer alls. */
  phoneKnown: boolean;
  /** `time.reminder.sms`. Utan den ritas ingen SMS-ruta — dess enda utfall vore ett 403. */
  canSms: boolean;
  /** Månaden är inte slut. Gör inte utskicket fel, men värt att säga innan man skickar till många. */
  periodOngoing: boolean;
  onClose: () => void;
  /** Får de FAKTISKT valda raderna, inte hela listan — mottagare kan bockas av här inne. */
  onSubmit: (chosen: TimeApprovalOverviewRow[], message: string | null, sendSms: boolean) => Promise<string | null>;
}) {
  const [message, setMessage] = React.useState('');
  const [sendSms, setSendSms] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  // Alla förkryssade, men avbockningsbara. Utan det var listan ren dekoration: attestlistan
  // innehåller varje anställd utom konsult och lönebyrån, så ett massutskick på "Ej inlämnade" tar
  // med säljare och kontor lika gärna som installatörerna — och den som ser en som inte borde stå
  // där hade bara kunnat avbryta och skicka en i taget.
  const [excluded, setExcluded] = React.useState<Set<string>>(() => new Set());
  const chosen = rows.filter((row) => !excluded.has(row.user_id));

  // Hur många som faktiskt kan nås med SMS. Siffran står FÖRE utskicket, inte i kvittot efteråt:
  // upptäcker man där att halva personalen saknar nummer har pengarna redan gått åt, och det man
  // trodde var en påminnelse till alla nådde hälften.
  const reachable = phoneKnown ? chosen.filter((row) => hasPhone[row.user_id]).length : chosen.length;

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Skicka påminnelse"
      maxWidth="sm:max-w-[520px]"
      header={
        <>
          <h2 className="text-lg font-bold text-slate-900">
            Påminn om {periodLabel(periodStart)}
          </h2>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {chosen.length === 1
              ? `${chosen[0].full_name || 'Personen'} får en notis i appen.`
              : `${chosen.length} personer får en notis i appen.`}
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
            onClick={async () => {
              setBusy(true);
              setFailure(null);
              // `&& canSms` är hängslen: rutan renderas inte utan nyckeln, men tillståndet lever
              // kvar om behörigheten skulle försvinna under tiden modalen står öppen, och
              // routen svarar då 403 på hela utskicket i stället för att skicka notiserna.
              const result = await onSubmit(chosen, message.trim() || null, sendSms && canSms);
              if (result) { setFailure(result); setBusy(false); }
            }}
            disabled={busy || chosen.length === 0}
            className={cn(crm.formButton, 'h-auto flex-1 py-2.5 sm:ml-auto sm:flex-none sm:px-5')}
            style={{ backgroundColor: 'var(--ek-green)' }}
          >
            {busy ? 'Skickar…' : 'Skicka påminnelse'}
          </button>
        </>
      }
    >
      {failure ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{failure}</div>
      ) : null}

      <div className="grid gap-3">
        {/* Bara vid ETT MASSUTSKICK i en månad som fortfarande pågår. Att påminna en enskild mitt i
            månaden är normalt — att påminna tjugo är ovanligt, och då ska det synas att det är
            ovanligt. Ingen spärr: ett lönestopp mitt i månaden är ett giltigt skäl. */}
        {periodOngoing && rows.length > 1 ? (
          <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
            {periodLabel(periodStart)} pågår fortfarande. De flesta lämnar in först när månaden är
            slut — påminnelsen säger bara att tiden inte är inlämnad.
          </p>
        ) : null}

        {/* Mottagarna, utskrivna. Vid ett massutskick är det här enda tillfället att se att någon
            står med som inte borde. */}
        <div className="grid gap-1">
          <span className={LABEL}>Får påminnelsen ({chosen.length} av {rows.length})</span>
          <div className="max-h-32 overflow-y-auto rounded-xl border border-[#dbe4d6] bg-white px-3 py-2 text-sm text-slate-700">
            {rows.map((row) => (
              <label key={row.user_id} className="flex items-center justify-between gap-3 py-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  {/* h-4 w-4 accent-* — `border-*` ritar ingenting på en kryssruta, se
                      FRONTEND_SYSTEM.md. */}
                  <input
                    type="checkbox"
                    checked={!excluded.has(row.user_id)}
                    onChange={(e) =>
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(row.user_id);
                        else next.add(row.user_id);
                        return next;
                      })
                    }
                    className="h-4 w-4 shrink-0 accent-emerald-600"
                  />
                  <span className="truncate">{row.full_name || '(namn saknas)'}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {row.entry_count === 0 ? 'inget rapporterat' : 'ej inlämnad'}
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="grid gap-1">
          <span className={LABEL}>Eget meddelande (valfritt)</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 200))}
            rows={3}
            autoFocus
            className="w-full rounded-xl border border-[#dbe4d6] bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="T.ex. Lönen körs på fredag, så vi behöver augusti klart innan dess."
          />
          {/* Räknaren finns för att texten kan gå ut som SMS: varje påbörjat segment om 160 tecken
              kostar per mottagare, och mallen tar redan en bit av det första. */}
          <span className="text-xs text-slate-500">
            Läggs till i notisen{sendSms ? ' och i SMS:et' : ''}. {message.length}/200 tecken.
          </span>
        </label>

        {/* Ingen SMS-ruta utan nyckeln. Notisen i appen går ändå, och den är påminnelsen —
            SMS:et är tillvalet. Att visa en ruta vars enda utfall är 403 hade fått den som
            trycker att tro att systemet är trasigt, inte att hon saknar behörighet. */}
        {canSms ? (
        <label className="flex items-start gap-2.5 rounded-xl border border-[#dbe4d6] bg-white px-3 py-2.5">
          {/* h-4 w-4 accent-emerald-600 — INTE `border-*`. globals.css nollar kanter för allt utom
              knappar, så en `border-slate-300` här hade sett komplett ut men inte ritat något.
              Se FRONTEND_SYSTEM.md. */}
          <input
            type="checkbox"
            checked={sendSms}
            onChange={(e) => setSendSms(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-semibold text-slate-800">Skicka även som SMS</span>
            <span className="text-xs text-slate-500">
              {smsReachSentence({ known: phoneKnown, total: chosen.length, reachable })}
            </span>
          </span>
        </label>
        ) : null}
      </div>
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
  if (!detail || detail.loading) return <p className="m-0 text-sm text-slate-500">Laddar dagar…</p>;
  if (detail.error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        {detail.error}
      </div>
    );
  }

  const summary = detail.summary;
  if (!summary) return null;

  // Vanlig const och ingen useMemo: komponenten har tidiga returer ovanför, och en hook efter dem
  // hade brutit rules-of-hooks (npm run lint fångar det). Summeringen är en reduce över en handfull
  // poster och kostar ingenting.
  const missingReceipts = countMissingReceipts(detail.compensations);
  // Summa per sort. Byrån tillämpar de fasta satserna på ANTALEN (mil, dagar) och ska slippa lägga
  // ihop enskilda rader för hand — det var den räkningen som gjorde beloppsfältet frestande att
  // fylla i från början.
  const compensationTotals = summarizeCompensations(detail.compensations);

  if (summary.rows.length === 0 && detail.compensations.length === 0) {
    // ⚠️ Loggen renderas ÄVEN här. Har en admin raderat personens alla rader ser månaden tom ut, och
    // då är raderingsraderna det enda som visar att det funnits något — att returnera tidigt hade
    // gömt just det bevis man öppnar loggen för.
    return (
      <div className="grid gap-3">
        <p className="m-0 text-sm text-slate-500">
          {name || 'Personen'} har inte rapporterat något den här månaden.
        </p>
        <AuditTrail rows={detail.audit} failed={detail.auditFailed} />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {summary.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                <th className="px-2 py-1.5">Datum</th>
                <th className="px-2 py-1.5">Klockslag</th>
                <th className="px-2 py-1.5 text-right">Rast</th>
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
              <tr className="border-x-0 border-b-0 border-t-2 border-slate-300 font-semibold text-slate-900">
                <td className="px-2 py-2" colSpan={2}>Totalt</td>
                {/* Timmar här, minuter i kolumnen ovanför. Med flit: fältet matas in i minuter, men
                    månadsraden läses vågrätt mot Arbetat och Frånvaro — "1260 min" bredvid
                    "168,00 h" gör kontrollen (brutto − rast = arbetat) till en huvudräkning. */}
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600">
                  {summary.breakMinutes > 0 ? `${formatHours(summary.breakMinutes)} h` : '—'}
                </td>
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
            <span key={item.reason} className="rounded-lg border border-slate-200 bg-white px-2 py-1">
              {item.reason}: {formatHours(item.minutes)} h
            </span>
          ))}
        </div>
      ) : null}

      <AuditTrail rows={detail.audit} failed={detail.auditFailed} />

      {detail.compensations.length > 0 ? (
        <div className="grid gap-1">
          <p className={cn(LABEL, 'm-0')}>Ersättningar</p>
          {/* ⚠️ SAKNADE KVITTON STÅR FÖRE LISTAN, inte bara som en märkning inne i den.
              Detaljpanelen är det sista den attestansvariga läser innan hen låser månaden, och efter
              låsningen kan den anställde inte längre koppla kvittot själv (periodlåset gäller
              kvittokolumnerna precis som timmarna). Ett saknat papper som upptäcks efteråt kostar
              alltså en återöppning — därför ska det synas innan, och inte behöva letas fram. */}
          {missingReceipts > 0 ? (
            <p className="m-0 text-sm font-semibold text-amber-800">
              {missingReceipts === 1 ? '1 utlägg saknar kvitto' : `${missingReceipts} utlägg saknar kvitto`} — be om det innan du attesterar.
            </p>
          ) : null}
          {/* Summan per sort, före listan: mil och dagar är det satserna räknas på, kronorna är
              utläggen. Samma form som /tid visar för den anställde, så båda läser samma siffror. */}
          <p className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-slate-600">
            {compensationTotals.map((total) => {
              const totalUnit = COMPENSATION_UNITS[total.kind];
              const parts = [
                totalUnit ? `${formatQuantity(total.quantity)} ${totalUnit}` : null,
                total.amount > 0 ? `${formatAmount(total.amount)} kr` : null,
              ].filter(Boolean);
              return (
                <span key={total.kind} className="whitespace-nowrap">
                  {COMPENSATION_LABELS[total.kind]}{' '}
                  <strong className="tabular-nums text-slate-900">{parts.join(' · ')}</strong>
                </span>
              );
            })}
          </p>
          <ul className="m-0 grid list-none gap-1 p-0 text-sm text-slate-700">
            {detail.compensations.map((item) => {
              const unit = COMPENSATION_UNITS[item.kind];
              const vatAmount = item.vat_amount == null ? null : Number(item.vat_amount);
              return (
                <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-slate-500">{formatDay(item.entry_date)}</span>
                  <span className="font-medium">{COMPENSATION_LABELS[item.kind] || item.kind}</span>
                  {unit && item.quantity != null ? (
                    <span className="text-slate-500">{formatQuantity(item.quantity)} {unit}</span>
                  ) : null}
                  {/* ⚠️ Kronor bara när posten bär några. Traktamente och milersättning ersätts med
                      FASTA SATSER som byrån äger — "0,00 kr" här hade sett ut som ett påstående om
                      att resan är gratis, mitt i det underlag satsen ska tillämpas på.
                      `> 0` och inte sorten: rader från före 2026-09-01 kan bära ett riktigt belopp. */}
                  {Number(item.amount) > 0 ? (
                    <span className="font-medium">{formatAmount(item.amount)} kr</span>
                  ) : null}
                  {/* Bokföringen behöver momsen utbruten. `!= null` och inte en sanningsprövning:
                      0 kr moms är ett svar (utlandsköp, vidarefakturerat) och ska inte se ut som
                      ett ouppgivet fält. */}
                  {vatAmount != null ? (
                    <span className="text-slate-500">varav moms {formatAmount(vatAmount)} kr</span>
                  ) : null}
                  {item.note ? <span className="text-slate-500">· {item.note}</span> : null}
                  {hasReceipt(item) ? (
                    // Länk till routen och inte till en signerad URL: åtkomsten prövas om vid varje
                    // klick, så länken inte dör i en panel som stått öppen halva förmiddagen.
                    <a
                      href={`/api/time/compensations/${item.id}/receipt?redirect=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-emerald-800 underline underline-offset-2"
                    >
                      Kvitto
                    </a>
                  ) : isReceiptMissing(item) ? (
                    <span className="font-semibold text-amber-800">Kvitto saknas</span>
                  ) : null}
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
  // Sorten, inte siffran: en frånvarorad som råkar gå ihop till noll minuter hade annars fått
  // klockslagens gula "saknas" — en åtgärdsflagga rest mot en rad som med rätta inte har några.
  // Samma härledning som summary.ts uttryckligen varnar för.
  const isAbsence = day.kind === 'absence';
  // Visa rasten bara där den faktiskt drogs av. Gamla kontorsrader saknar klockslag, och deras
  // lagrade rast påverkade aldrig timmarna bredvid.
  const showBreak = breakWasDeducted(day) && day.breakMinutes > 0;

  // Bär "Orsak / jobb" ett riktigt namn, eller den neutrala sortmarkören? Se reasonOrJobLabel:
  // en läsare utan åtkomst till arbetsordern får aldrig jobbets namn, och skillnaden ska synas.
  const hasResolvedLabel = day.absenceReasons.length > 0 || !!day.label;

  // Rättelse kräver att raden går att peka ut. Saknas id:t är den läsbar men inte ändringsbar —
  // hellre ingen knapp än en som svarar 404.
  const editable = canCorrect && !!day.entryId;

  return (
    <tr className="border-x-0 border-b-0 border-t border-slate-200 align-top">
      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{formatDay(day.date)}</td>
      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">
        {start && end ? (
          `${start}–${end}`
        ) : isAbsence ? (
          <span className="text-slate-500">—</span>
        ) : (
          <span className="font-semibold text-amber-700">saknas</span>
        )}
      </td>
      {/* Minuter, inte timmar: rasten skrivs in i minuter i bägge formulären och loggas så i
          ändringsloggen. Ett "0,50 h" här hade varit samma siffra i en annan valuta. */}
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">
        {showBreak ? `${day.breakMinutes} min` : '—'}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-900">
        {day.workMinutes > 0 ? `${formatHours(day.workMinutes)} h` : '—'}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">
        {day.absenceMinutes > 0 ? `${formatHours(day.absenceMinutes)} h` : '—'}
      </td>
      {/* "Orsak / jobb". Kursivt när namnet inte gick att hämta: markören säger vilken SORT raden är
          ("Arbetsorder"), och kursiven säger att det inte är jobbets namn. Utan den skillnaden hade
          en läsare med full åtkomst kunnat tro att ordern faktiskt HETER så. Se reasonOrJobLabel. */}
      <td className={cn('px-2 py-1.5 text-slate-600', !hasResolvedLabel && 'italic text-slate-400')}>
        {reasonOrJobLabel(day)}
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
                className="p-0 font-semibold text-rose-600 disabled:opacity-50"
              >
                Ja
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="p-0 text-slate-500">Nej</button>
            </span>
          ) : (
            <span className="flex items-center justify-end gap-3 text-sm">
              <button
                type="button"
                onClick={() => onEdit(day)}
                className="p-0 font-medium text-slate-600 underline underline-offset-2"
              >
                Rätta
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="p-0 font-medium text-slate-500 hover:text-rose-600">
                Ta bort
              </button>
            </span>
          )}
        </td>
      ) : null}
    </tr>
  );
}

/**
 * Vem som rört månaden, och vad de gjorde.
 *
 * Det här är andra halvan av att låta en admin rätta någon annans timmar. Utan en läsbar logg är
 * skrivrätten bara en försäkran; med den är den granskbar. Raderna skrivs av en databastrigger som
 * ingen väg går förbi.
 *
 * ⚠️ TOM LOGG BETYDER "INGEN ANNAN HAR RÖRT MÅNADEN", inte "ingenting har hänt". Triggern hoppar
 * över personens egna sparningar med flit — annars hade varje inmatning i /tid dränkt de rader man
 * öppnar loggen för att hitta. Därför visas sektionen bara när det finns något att visa.
 */
function AuditTrail({ rows, failed }: { rows: TimeEntryAuditRow[]; failed: boolean }) {
  if (failed) {
    return (
      <p className="m-0 text-sm text-amber-800">
        Ändringsloggen kunde inte läsas. Dagarna ovan är oberoende av den.
      </p>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="grid gap-1.5">
      <p className={cn(LABEL, 'm-0')}>Ändrat av någon annan</p>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {rows.map((row) => {
          const changes = describeAuditChange(row);
          // Dagen först: utan den går raden inte att koppla till något i tabellen ovanför.
          const day = auditWorkDate(row);
          return (
            <li key={row.id} className="rounded-xl border border-[#e4ebe0] bg-white px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 text-slate-700">
                <span className="font-semibold">{day ? formatDay(day) : 'Okänd dag'}</span>
                <span>{auditActionLabel(row.action).toLowerCase()}</span>
                <span className="text-slate-500">
                  {row.changed_by_profile?.full_name || 'okänd användare'} · {formatStamp(row.created_at)}
                </span>
              </div>
              {changes.length === 0 && row.action === 'update' ? (
                <p className="m-0 mt-1 text-slate-500">Inga värden ändrades.</p>
              ) : null}
              {changes.length > 0 ? (
                <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-slate-600">
                  {changes.map((change) => (
                    <li key={change.label}>
                      {change.label}: <span className="tabular-nums">{change.from ?? '—'}</span>
                      {' → '}
                      <span className="font-medium tabular-nums text-slate-900">{change.to ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
