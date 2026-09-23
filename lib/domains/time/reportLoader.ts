import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllPages, chunkIds } from '@/lib/domains/planning/pagedRead';
import type { TimePersonRow, TimeReportEntryRow, TimeReportRange } from './report';

// I/O-halvan av rapporteringens tidsdel. Räkningen bor i report.ts och är ren. Samma delning som
// production.ts / productionLoader.ts.

export type TimeReportData = {
  entries: TimeReportEntryRow[];
  people: TimePersonRow[];
};

type RawEntry = {
  user_id: string | null;
  work_date: string;
  kind: string | null;
  minutes_worked: number | null;
  hours: number | string | null;
  internal_project: { name: string | null } | Array<{ name: string | null }> | null;
  absence_type: { name: string | null } | Array<{ name: string | null }> | null;
};

/** PostgREST ger en inbäddad relation som objekt ELLER array beroende på hur den härleds. */
function embedded(value: RawEntry['internal_project']): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name ?? null;
}

/**
 * Tidrader och namn för perioden.
 *
 * ⚠️ SIDINDELAD. PostgREST kapar vid max-rows (1000) UTAN att fela, och en tolvmånadersperiod
 * växer med bemanningen: 231 rader i dag, men elva personer som rapporterar varje arbetsdag ger
 * ~2 800 rader om året. En kapad läsning hade tyst sänkt rapporterade timmar.
 *
 * ⚠️ NAMNEN LÄSES SEPARAT, inte via en join. `profiles` SELECT-RLS är self-only, så en inbäddad
 * relation hade gett null för alla utom den inloggade — rapporten hade visat "Okänd användare" på
 * tio av elva. Rutten kör med admin-klienten av just det skälet (samma som målen och säljarna).
 */
export async function fetchTimeReportData(
  supabase: SupabaseClient,
  range: TimeReportRange,
): Promise<{ data: TimeReportData; error: { message: string } | null }> {
  const empty: TimeReportData = { entries: [], people: [] };

  const { rows, error } = await readAllPages<RawEntry>((from, to) =>
    supabase
      .from('crm_time_entries')
      .select('user_id, work_date, kind, minutes_worked, hours, internal_project:crm_internal_projects(name), absence_type:crm_absence_types(name)')
      .gte('work_date', range.from)
      .lte('work_date', range.to)
      // Unik och stabil ordning — utan den är sidindelningen odefinierad.
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (error) return { data: empty, error };

  const entries: TimeReportEntryRow[] = rows.map((row) => ({
    user_id: row.user_id,
    work_date: row.work_date,
    kind: row.kind,
    minutes_worked: row.minutes_worked,
    hours: row.hours,
    internal_project_name: embedded(row.internal_project),
    absence_reason: embedded(row.absence_type),
  }));

  const userIds = [...new Set(entries.map((e) => e.user_id).filter((id): id is string => Boolean(id)))];
  const people: TimePersonRow[] = [];
  for (const chunk of chunkIds(userIds)) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', chunk);
    if (profileError) return { data: empty, error: profileError };
    people.push(...((profiles as TimePersonRow[]) || []));
  }

  return { data: { entries, people }, error: null };
}
