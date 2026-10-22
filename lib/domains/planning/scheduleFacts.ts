import type { SupabaseClient } from '@supabase/supabase-js';
import { listSegmentsByIds } from './schedule';
import type { OpsSegment } from './types';
import { loadCrewSources, resolveWorkOrderCrew, type CrewSources } from './workOrderCrew';
import { scheduleFactKey, type StopFacts } from './scheduleStops';

// Fakta för startsidans arbetsschema: säckar, material, rapporterat, team och om jobbet är klart —
// per placering och dag, för CRM-jobben. Den gamla planeringens rader har sina egna (DashboardSchedule
// hämtar dem ur planning_*), de här fanns inte alls för CRM förrän nu (fas 3 i
// ARBETSSCHEMA_KORT_REDESIGN_PLAN).
//
// ⚠️ INGEN EGEN REGEL HÄR. Varje tal kommer från samma ställe som planeringstavlan läser:
//   • säckar och material: mapSegment → mapWorkOrderJob, beskuret till placeringens etapp
//   • rapporterat och slutrapport: säckboken (sackTotalsForWorkOrders — egenkontrollen är sanningen)
//   • team: resolveWorkOrderCrew, samma tre grenar som feedens is_user_on_segment_between
// Modulen äger bara sammanställningen per (placering, dag).

/**
 * Kortets fakta, i samma form som de gamla radernas (StopFacts i scheduleStops.ts) — kortet ska inte
 * behöva veta vilken källa ett tal kom ifrån. Säckboken är per arbetsorder, så `reported` är hela
 * orderns; `staged` säger när det skiljer sig från placeringens säckar.
 */
export type ScheduleFact = StopFacts;

// Statusarna där jobbet är gjort. ⚠️ INTE `partially_invoiced`: delfakturering används på stora jobb
// som pågår (lib/domains/fortnox/partialInvoices), så en delfakturerad order kan ha dagar kvar.
const DONE_STATUSES = new Set(['completed', 'invoiced']);

/**
 * Är jobbet klart? Williams beslut 2026-10-22: när arbetsordern har status Klar eller Fakturerad,
 * ELLER när slutrapporten (egenkontrollen) är inskickad. Gäller hela jobbet, alltså alla dess dagar.
 *
 * Slutrapporten räknas med för att den kommer FÖRST: besättningen skickar den när de blåst klart,
 * medan kontoret sätter Klar senare. Utan den hade dagens sista stopp stått kvar som ogjort tills
 * någon på kontoret hann ikapp.
 *
 * 🧨 Anroparen skickar `hasFinalReport: false` för en placering på en UPPDELAD order — se
 * buildScheduleFacts.
 */
export function isScheduleJobDone(status: string | null | undefined, hasFinalReport: boolean): boolean {
  return hasFinalReport || DONE_STATUSES.has((status || '').trim());
}

type FeedRow = { segment_id: string; job_day: string | null };

/**
 * Ren: feedens rader → fakta per (placering, dag). Placeringar som inte gick att läsa saknas i
 * svaret, och rader utan dag likaså — kortet visar då inga fakta, vilket är rätt svar på "vet inte".
 */
export function buildScheduleFacts(rows: FeedRow[], segments: OpsSegment[], crewSources: CrewSources | null): Record<string, ScheduleFact> {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const facts: Record<string, ScheduleFact> = {};
  for (const row of rows) {
    const segment = byId.get(row.segment_id);
    if (!segment || !row.job_day) continue;
    const job = segment.job;
    const staged = !!job && (job.stage != null || job.is_rest);
    // 🧨 Teamet PER PLACERING OCH DAG: placeringen avgränsad till den här dagen, så veckobesättningen
    // som räknas är dagens veckas — precis som feeden frågar is_user_on_segment_between dag för dag.
    // Hela placeringens spann hade lagt in nästa veckas folk på ett fredag–måndag-jobb. Aldrig
    // is_user_on_work_order: den gav förra veckans lag nästa veckas jobb (myCrmJobsFeedSql.test.ts).
    const crew = crewSources
      ? resolveWorkOrderCrew({
        segments: [{ id: segment.id, truck_id: segment.truck_id, start_day: row.job_day, end_day: row.job_day }],
        ...crewSources,
      }).map((person) => person.member_name).filter(Boolean)
      : [];
    facts[scheduleFactKey(row.segment_id, row.job_day)] = {
      plannedSacks: job && job.total_sacks > 0 ? job.total_sacks : null,
      orderSacks: staged && job && job.order_total_sacks > 0 ? job.order_total_sacks : null,
      staged,
      material: job?.material ?? null,
      reported: segment.sacks_reported,
      // 🧨 Slutrapporten gäller HELA ORDERN (säckboken är per arbetsorder). På en uppdelad order hade
      // etapp 1:s egenkontroll annars gjort nästa veckas etapp 2 "Klart" — ett jobb besättningen
      // har kvar, med bock och utan fylld siffra. Där räknas bara orderns status.
      done: !!job && isScheduleJobDone(job.status, staged ? false : segment.sacks_final),
      crew,
    };
  }
  return facts;
}

/**
 * Laddar fakta för feedens rader. ADMIN-klienten — montörerna får inte läsa ops_* själva — och
 * därför BARA med rader ur anroparens egen feed (get_my_crm_jobs körd med sessionen), aldrig med
 * id:n en klient skickat. Se rutten /api/crm/planering/my-jobs/facts.
 *
 * Kan teamet inte läsas svarar resten ändå, utan team, och felet följer med i `error`. Kan
 * placeringarna inte läsas finns inget att svara med.
 */
export async function loadScheduleFacts(admin: SupabaseClient, rows: FeedRow[]) {
  const ids = [...new Set(rows.map((r) => r.segment_id).filter(Boolean))];
  const { data: segments, error } = await listSegmentsByIds(admin, ids);
  if (error) return { data: null, error };

  const byId = new Map(segments.map((s) => [s.id, s]));
  // En placering per DAG, så veckorna som läses är de dagar feeden faktiskt visar.
  const daySegments = rows
    .filter((r) => r.job_day && byId.has(r.segment_id))
    .map((r) => ({ id: r.segment_id, truck_id: byId.get(r.segment_id)!.truck_id, start_day: r.job_day!, end_day: r.job_day! }));
  const crew = await loadCrewSources(admin, daySegments);

  return { data: buildScheduleFacts(rows, segments, crew.data), error: crew.error };
}
