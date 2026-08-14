import type { SupabaseClient } from '@supabase/supabase-js';
import { workedMinutes } from './hours';
import type { SummarizableEntry, TimeEntryKind } from './summary';

// Tidrader — läsning, skrivning och den regel som gör underlaget trovärdigt:
// SERVERN RÄKNAR MINUTERNA, aldrig klienten.
//
// Så fungerar det inte i dag. components/dashboard/TimeReportModal.tsx räknar `totalHours` i
// webbläsaren och app/api/blikk/time-reports/route.ts skickar den vidare till Blikk som sanning. En
// bugg i klientens uträkning, eller någon som ändrar värdet på vägen, blir någons lön. Här kommer
// klockslagen in och minuterna räknas om — `hours` skrivs dessutom av en databastrigger, så inte ens
// en direkt insert kan sätta en timsumma som inte hör ihop med klockslagen.

export const timeEntrySelect = `
  id,
  user_id,
  kind,
  work_order_id,
  internal_project_id,
  absence_type_id,
  work_date,
  start_time,
  end_time,
  break_minutes,
  minutes_worked,
  hours,
  time_code_id,
  note,
  source,
  created_at,
  updated_at,
  work_order:crm_work_orders(id, order_number, fortnox_order_number, project_name, client_name),
  internal_project:crm_internal_projects(id, name),
  absence_type:crm_absence_types(id, name, payroll_code),
  time_code:crm_time_codes(id, name, code)
`;

export type TimeEntryRow = {
  id: string;
  user_id: string;
  kind: TimeEntryKind;
  work_order_id: string | null;
  internal_project_id: string | null;
  absence_type_id: string | null;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  minutes_worked: number | null;
  hours: number;
  time_code_id: string | null;
  note: string | null;
  source: string;
  work_order?: { id: string; order_number: string | null; fortnox_order_number: string | null; project_name: string | null; client_name: string | null } | null;
  internal_project?: { id: string; name: string } | null;
  absence_type?: { id: string; name: string; payroll_code: string | null } | null;
  time_code?: { id: string; name: string; code: string | null } | null;
};

export type TimeEntryInput = {
  kind: TimeEntryKind;
  work_date: string;
  work_order_id?: string | null;
  internal_project_id?: string | null;
  absence_type_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  break_minutes?: number;
  /** Bara för frånvaro: byrån vill ha den i timmar, inte som ett pass med start och slut. */
  hours?: number | null;
  time_code_id?: string | null;
  note?: string | null;
};

export type BuiltTimeEntry = { row: Record<string, unknown>; error: null } | { row: null; error: string };

// Bygger raden som ska skrivas. Ren funktion så regeln går att testa utan databas — och det är här
// minuterna avgörs, inte i formuläret.
export function buildTimeEntryRow(input: TimeEntryInput, userId: string): BuiltTimeEntry {
  const kind = input.kind;

  // Samma regel som CHECK:en i databasen (crm_time_entries_target_check). Den finns på båda ställena
  // med flit: databasen är garantin, men ett fel härifrån ska bli ett läsbart meddelande och inte ett
  // rått constraint-fel.
  const targets = [
    kind === 'work_order' ? input.work_order_id : null,
    kind === 'internal' ? input.internal_project_id : null,
    kind === 'absence' ? input.absence_type_id : null,
  ];
  if (!targets.some(Boolean)) {
    const what = kind === 'work_order' ? 'arbetsorder' : kind === 'internal' ? 'internprojekt' : 'frånvaroorsak';
    return { row: null, error: `Välj ${what}` };
  }

  let minutes: number;
  if (kind === 'absence') {
    // Frånvaro anges i timmar och har inga klockslag — "Frånvarotimmar" i byråns underlag. En halv
    // dag VAB är fyra timmar, inte 08:00–12:00.
    const hours = Number(input.hours ?? 0);
    if (!Number.isFinite(hours) || hours <= 0) return { row: null, error: 'Ange antal frånvarotimmar' };
    minutes = Math.round(hours * 60);
    // Ett positivt timtal kan ändå avrunda till noll minuter (0,004 h). Databasens CHECK
    // (minutes_worked > 0) skulle avvisa det som ett rått 500 — säg det begripligt i stället.
    if (minutes <= 0) return { row: null, error: 'Frånvaron måste vara minst en minut' };
  } else {
    if (!input.start_time || !input.end_time) return { row: null, error: 'Start- och sluttid krävs' };
    minutes = workedMinutes({
      workDate: input.work_date,
      startTime: input.start_time,
      endTime: input.end_time,
      breakMinutes: input.break_minutes ?? 0,
    });
    if (minutes <= 0) return { row: null, error: 'Rasten kan inte vara längre än arbetstiden' };
  }

  if (minutes > 1440) return { row: null, error: 'En rad kan inte vara längre än ett dygn' };

  return {
    row: {
      user_id: userId,
      kind,
      work_date: input.work_date,
      work_order_id: kind === 'work_order' ? input.work_order_id : null,
      internal_project_id: kind === 'internal' ? input.internal_project_id : null,
      absence_type_id: kind === 'absence' ? input.absence_type_id : null,
      start_time: kind === 'absence' ? null : input.start_time,
      end_time: kind === 'absence' ? null : input.end_time,
      break_minutes: kind === 'absence' ? 0 : (input.break_minutes ?? 0),
      minutes_worked: minutes,
      time_code_id: input.time_code_id ?? null,
      note: input.note?.trim() || null,
      // `hours` skickas INTE med: databastriggern räknar den ur minuterna. Skulle den skickas med
      // skrivs den ändå över — det är hela poängen.
    },
    error: null,
  };
}

/**
 * Databasrad → löneunderlagets form (lib/domains/time/summary.ts).
 *
 * Enda stället där kolumnnamn möter summeringen. `summarizePerson` känner inte till PostgREST och
 * `listTimeEntries` känner inte till byråns kolumner — den här funktionen är fogen, och den är ren
 * så den går att testa utan databas.
 *
 * `minutesWorked` skickas med för raderna som saknar klockslag, och `hours` är fallbacken för den.
 *
 * ⚠️ `minutes_worked` ÄR NULL PÅ DE GAMLA KONTORSRADERNA. Kolumnen lades till nullbar utan backfill
 * (20260811_time_entries_reshape.sql), CHECK:en tillåter null, och triggern härleder `hours` UR
 * minuterna — aldrig tvärtom. Kontorets Tid-flik skriver fortfarande bara datum + timmar, så de
 * raderna har timmar men inga minuter. Utan fallbacken blir de noll timmar i dagvyn, tyst, och
 * summan längst ner motsäger aggregatet i raden ovanför. Samma coalesce finns i RPC:n
 * time_approval_overview (20260812_time_approvals.sql) — ändras den ena måste den andra följa med.
 */
export function toSummarizableEntry(row: TimeEntryRow): SummarizableEntry {
  const workOrder = row.work_order;
  // Ordernumret först: det är vad kontoret känner igen ett jobb på. Projekt- eller kundnamn läggs
  // till när det finns, så en rad går att placera utan att slå upp ordern.
  const workOrderLabel = workOrder
    ? [workOrder.order_number || workOrder.fortnox_order_number, workOrder.project_name || workOrder.client_name]
        .filter(Boolean)
        .join(' · ') || null
    : null;

  return {
    workDate: row.work_date,
    startTime: row.start_time,
    endTime: row.end_time,
    breakMinutes: row.break_minutes ?? 0,
    minutesWorked: row.minutes_worked ?? (row.hours != null ? Math.round(row.hours * 60) : null),
    kind: row.kind,
    userId: row.user_id,
    absenceReason: row.absence_type?.name ?? null,
    // Frånvaroorsakens lönesort. Arbetstidens (tidkodens) hämtas inte: ingen läser den i dag, och
    // en kolumn i timEntrySelect kostar payload på varje läsning av /tid utan att någon ser den.
    payrollCode: row.absence_type?.payroll_code ?? null,
    note: row.note,
    label: row.kind === 'internal' ? row.internal_project?.name ?? null : workOrderLabel,
  };
}

export async function listTimeEntries(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  opts?: { userId?: string },
) {
  let query = supabase
    .from('crm_time_entries')
    .select(timeEntrySelect)
    .gte('work_date', range.from)
    .lte('work_date', range.to)
    .order('work_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true });

  // Utan userId begränsar RLS till den egna raden, om man inte har time.entry.read.all.
  if (opts?.userId) query = query.eq('user_id', opts.userId);

  return query;
}

export async function createTimeEntry(supabase: SupabaseClient, row: Record<string, unknown>) {
  return supabase.from('crm_time_entries').insert(row).select(timeEntrySelect).single();
}

// Ägarskopad, som resten av tidytan: en icke-ägares id matchar helt enkelt ingen rad, och RLS säger
// samma sak. Från fas 4.4 stoppas dessutom ändringar i en attesterad period av en trigger.
export async function updateTimeEntry(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  row: Record<string, unknown>,
) {
  // user_id ska aldrig gå att flytta med en uppdatering.
  const { user_id: _ignored, ...patch } = row;
  return supabase
    .from('crm_time_entries')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select(timeEntrySelect)
    .maybeSingle();
}

export async function deleteTimeEntry(supabase: SupabaseClient, id: string, userId: string) {
  return supabase
    .from('crm_time_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
}
