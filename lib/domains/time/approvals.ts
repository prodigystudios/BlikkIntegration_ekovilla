import type { SupabaseClient } from '@supabase/supabase-js';

// Attest — perioden som ett tillstånd, och låset som gör löneunderlaget trovärdigt.
//
// En månad går open → submitted → approved. Så länge den är `open` är den arbetsmaterial; från
// `submitted` är den fryst (se supabase/sql/20260812_time_approvals.sql — både RLS-policy och
// trigger). Det som står här är appsidans spegling: samma matris, så knappen kan vara rätt innan
// anropet görs. DATABASEN ÄR GARANTIN; det här är läsbarheten. Samma uppdelning som mellan
// buildTimeEntryRow och CHECK:en på crm_time_entries.

export const TIME_PERIOD_STATUSES = ['open', 'submitted', 'approved'] as const;
export type TimePeriodStatus = (typeof TIME_PERIOD_STATUSES)[number];

export const TIME_PERIOD_STATUS_LABELS: Record<TimePeriodStatus, string> = {
  open: 'Öppen',
  submitted: 'Inlämnad',
  approved: 'Attesterad',
};

export type TimeApprovalRow = {
  id: string;
  user_id: string;
  period_start: string;
  status: TimePeriodStatus;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  reopened_at: string | null;
  note: string | null;
};

export const timeApprovalSelect =
  'id, user_id, period_start, status, submitted_at, approved_at, approved_by, reopened_at, note';

// ── Perioden ─────────────────────────────────────────────────────────────────
// Kalendermånad, inget annat. Räknat på strängar och inte på Date: `new Date('2026-08-01')` tolkas
// som UTC-midnatt och blir 31 juli i svensk tid, vilket hade lagt en rad i fel period vid varje
// månadsskifte. Samma fälla som fmtISO redan löser i planeringen.

const PERIOD_RE = /^(\d{4})-(\d{2})$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** '2026-08' eller '2026-08-14' → '2026-08-01'. Kastar på skräp hellre än att gissa en period. */
export function periodStartOf(value: string): string {
  const period = PERIOD_RE.exec(value);
  if (period) return `${period[1]}-${period[2]}-01`;
  const date = ISO_DATE_RE.exec(value);
  if (date) return `${date[1]}-${date[2]}-01`;
  throw new Error(`Ogiltig period: ${value}`);
}

/** Månadens första och sista dag, inklusive. */
export function periodRange(periodStart: string): { from: string; to: string } {
  const match = ISO_DATE_RE.exec(periodStart);
  if (!match) throw new Error(`Ogiltig periodstart: ${periodStart}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  // Dag 0 i nästa månad = sista dagen i den här. Date.UTC för att undvika lokal tidszon helt.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${match[1]}-${match[2]}-01`, to: `${match[1]}-${match[2]}-${pad(lastDay)}` };
}

/** '2026-08-01' → 'augusti 2026'. Formuleringen som används i knappar och rubriker. */
const MONTH_NAMES = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
];

export function periodLabel(periodStart: string): string {
  const match = ISO_DATE_RE.exec(periodStart);
  if (!match) return periodStart;
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

/** Ligger datumet i perioden? Strängjämförelse duger — ISO-datum sorterar som de ska. */
export function isDateInPeriod(periodStart: string, date: string): boolean {
  const range = periodRange(periodStart);
  return date >= range.from && date <= range.to;
}

// ── Låset ────────────────────────────────────────────────────────────────────

/** `submitted` låser också, inte bara `approved` — annars ändras underlaget under granskningen. */
export function isPeriodLocked(status: TimePeriodStatus | null | undefined): boolean {
  return status === 'submitted' || status === 'approved';
}

// ── Övergångsmatrisen ────────────────────────────────────────────────────────
// Speglar set_time_period_status() i 20260812_time_approvals.sql exakt. Ändras den ena måste den
// andra följa med — testet tests/time/approvals.test.ts beskriver båda i ord.
//
//   open      → submitted   bara en själv
//   open      → approved    time.approve   (lönen får inte fastna på en glömd knapp)
//   submitted → approved    time.approve
//   submitted → open        en själv (ångra) ELLER time.approve (skicka tillbaka)
//   approved  → open        bara time.approve

export type TransitionActor = { isSelf: boolean; canApprove: boolean };

export type TransitionCheck = { allowed: true } | { allowed: false; reason: string };

export function canTransition(
  from: TimePeriodStatus,
  to: TimePeriodStatus,
  actor: TransitionActor,
): TransitionCheck {
  // Samma status igen är en no-op, inte ett fel: dubbelklick ska inte ge ett rött meddelande om
  // något som redan är sant.
  if (from === to) return { allowed: true };

  if (to === 'submitted') {
    if (!actor.isSelf) return { allowed: false, reason: 'Bara den anställde kan lämna in sin egen period' };
    if (from !== 'open') return { allowed: false, reason: 'Perioden är redan attesterad' };
    return { allowed: true };
  }

  if (to === 'approved') {
    if (!actor.canApprove) return { allowed: false, reason: 'Du har inte behörighet att attestera tid' };
    return { allowed: true };
  }

  // to === 'open'
  if (from === 'approved' && !actor.canApprove) {
    return { allowed: false, reason: 'Perioden är attesterad och kan bara öppnas av en attestansvarig' };
  }
  if (from === 'submitted' && !actor.isSelf && !actor.canApprove) {
    return { allowed: false, reason: 'Du kan bara ångra din egen inlämning' };
  }
  return { allowed: true };
}

// ── Läsning och skrivning ────────────────────────────────────────────────────

/**
 * Attestraden för en person och period, eller null när ingen finns.
 *
 * Ingen rad = `open`. Raden skapas först vid första övergången, så en person som aldrig lämnat in
 * har inga rader alls — vilket är rätt: ett tomt tillstånd ska inte kräva en post per anställd och
 * månad i all evighet.
 */
export async function getTimeApproval(
  supabase: SupabaseClient,
  userId: string,
  periodStart: string,
) {
  return supabase
    .from('crm_time_approvals')
    .select(timeApprovalSelect)
    .eq('user_id', userId)
    .eq('period_start', periodStart)
    .maybeSingle();
}

export function statusOf(row: Pick<TimeApprovalRow, 'status'> | null | undefined): TimePeriodStatus {
  return row?.status ?? 'open';
}

/**
 * Enda skrivvägen. Tabellen har inga insert/update-policyer — RPC:n är security definer och äger
 * övergångsmatrisen, så en PATCH mot PostgREST kan inte sätta status='approved' på egen hand.
 */
export async function setTimePeriodStatus(
  supabase: SupabaseClient,
  input: { userId: string; periodStart: string; status: TimePeriodStatus; note?: string | null },
) {
  return supabase.rpc('set_time_period_status', {
    p_user_id: input.userId,
    p_period_start: input.periodStart,
    p_status: input.status,
    p_note: input.note ?? null,
  });
}

// ── Adminöversikten ──────────────────────────────────────────────────────────

export type TimeApprovalOverviewRow = {
  user_id: string;
  full_name: string | null;
  role: string;
  status: TimePeriodStatus;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  note: string | null;
  work_minutes: number;
  absence_minutes: number;
  entry_count: number;
  compensation_amount: number;
  compensation_count: number;
};

/**
 * Alla anställda × en månad: status plus vad som faktiskt är rapporterat.
 *
 * RPC och inte en select: `profiles` har self-select-RLS, så vyn hade annars krävt service-role för
 * en ren läsning. Funktionen är security definer med `has_permission('time.approve')` som första
 * rad — urvalet ÄR säkerhetsgränsen, samma mönster som get_my_crm_jobs.
 */
export async function listTimeApprovalOverview(supabase: SupabaseClient, periodStart: string) {
  return supabase.rpc('time_approval_overview', { p_period_start: periodStart });
}

// Postgres numeric kommer tillbaka som sträng via PostgREST, och bigint likaså när värdet är stort.
// Vyn räknar på siffrorna direkt, så de normaliseras här i stället för på varje läsplats.
export function normalizeOverviewRow(row: Record<string, unknown>): TimeApprovalOverviewRow {
  return {
    user_id: String(row.user_id),
    full_name: (row.full_name as string | null) ?? null,
    role: String(row.role ?? ''),
    status: (row.status as TimePeriodStatus) ?? 'open',
    submitted_at: (row.submitted_at as string | null) ?? null,
    approved_at: (row.approved_at as string | null) ?? null,
    approved_by: (row.approved_by as string | null) ?? null,
    approved_by_name: (row.approved_by_name as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    work_minutes: Number(row.work_minutes ?? 0),
    absence_minutes: Number(row.absence_minutes ?? 0),
    entry_count: Number(row.entry_count ?? 0),
    compensation_amount: Number(row.compensation_amount ?? 0),
    compensation_count: Number(row.compensation_count ?? 0),
  };
}

// ── Felöversättning ──────────────────────────────────────────────────────────

/**
 * Låstriggern och övergångsmatrisen svarar med `raise exception`, alltså SQLSTATE P0001 med ett
 * färdigt svenskt meddelande. Utan den här mappningen blir en helt normal "perioden är stängd" ett
 * rått 500 med Postgres-text, och användaren får veta att något gick sönder i stället för varför.
 */
export function periodLockError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return null;
  if (error.code !== 'P0001') return null;
  return { status: 409 as const, code: 'time_period_locked', message: error.message || 'Perioden är låst' };
}

/**
 * Varför träffade en ägarskopad UPDATE/DELETE ingen rad?
 *
 * Låset ligger i policyns USING-klausul, och en rad som inte passerar USING blir helt enkelt inte
 * uppdaterad — noll rader, inget fel. Utan den här förklaringen svarar routen "Tidraden hittades
 * inte" på en rad som finns, syns i listan och står kvar när sidan laddas om. Det är den sortens
 * svar som får folk att trycka igen i stället för att förstå.
 *
 * Körs BARA på misslyckandevägen. SELECT-policyn bär inget lås, så raden går att läsa även när den
 * inte går att ändra — det är just den skillnaden som gör svaret möjligt att formulera.
 */
export async function explainWriteMiss(
  supabase: SupabaseClient,
  opts: {
    table: 'crm_time_entries' | 'crm_time_compensations';
    dateColumn: 'work_date' | 'entry_date';
    id: string;
    userId: string;
  },
): Promise<{ locked: false } | { locked: true; message: string }> {
  const { data } = await supabase
    .from(opts.table)
    .select(`id, ${opts.dateColumn}`)
    .eq('id', opts.id)
    .eq('user_id', opts.userId)
    .maybeSingle();

  const date = data ? (data as Record<string, string | null>)[opts.dateColumn] : null;
  if (!date) return { locked: false };

  const approval = await getTimeApproval(supabase, opts.userId, periodStartOf(date));
  const status = statusOf(approval.data as Pick<TimeApprovalRow, 'status'> | null);
  if (!isPeriodLocked(status)) return { locked: false };

  return {
    locked: true,
    // Skillnaden är inte kosmetisk: inlämnad kan personen själv ta tillbaka, attesterad kan bara
    // en attestansvarig öppna. Meddelandet ska säga vad man gör härnäst.
    message:
      status === 'approved'
        ? `${periodLabel(periodStartOf(date))} är attesterad och kan inte ändras. Be en attestansvarig öppna perioden.`
        : `${periodLabel(periodStartOf(date))} är inlämnad. Ångra inlämningen först om du behöver ändra.`,
  };
}
