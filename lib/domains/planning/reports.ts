import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sackTotalsByWorkOrder,
  sumSacksByWorkOrder,
  type ResolvableSegment,
  type SackLedgerRow,
  type SackReportKind,
  type SackTotal,
} from './sackLedger';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Pure validation for a sack report.
export function validateReport(reportDay: string, sacksBlown: number): 'invalid_date' | 'invalid_amount' | null {
  if (!ISO_DATE_RE.test(reportDay)) return 'invalid_date';
  if (!Number.isFinite(sacksBlown) || sacksBlown < 0) return 'invalid_amount';
  return null;
}

// Sacks remaining for a job: planned (from line items) minus blown, floored at 0.
export function sacksRemaining(planned: number, blown: number): number {
  return Math.max(0, planned - blown);
}

// Sacks blown beyond plan (overrun), floored at 0. Drives the "över N" warning when installers
// report more sacks than the quote planned.
export function sacksOverrun(planned: number, blown: number): number {
  return Math.max(0, blown - planned);
}

/** Vilket läge planeringskortets säckbadge ska rita. */
export type SackProgressState =
  /** Ingenting att säga — inget planerat, inget rapporterat, ingen egenkontroll. */
  | 'hidden'
  /** Bara planen finns. */
  | 'planned'
  /** Delrapporterat, jobbet pågår. */
  | 'remaining'
  /** Delrapporterat och redan över planen. */
  | 'overrun'
  /** Egenkontrollen inlämnad — talet är jobbets slutsumma. */
  | 'final'
  /** Egenkontrollen inlämnad, och den går över planen. */
  | 'final-overrun';

/**
 * Badgens läge, som ren funktion. Bor här och inte i komponenten för att EN av grenarna är en
 * regel och inte en stilfråga:
 *
 * 🧨 `final` MÅSTE prövas före `reported > 0`. En ifylld NOLLA i egenkontrollen är ett svar — "vi
 * var här, inget gick åt" — och finalSackEntriesFromEtappRows behåller den med flit (en TOM ruta
 * hoppas över, en nolla behålls). Ligger final-prövningen inuti `reported > 0` faller det fallet
 * ut som 'planned' och ser exakt likadant ut som ett jobb ingen rapporterat något på. Då raderar
 * kortet skillnaden mellan "inget gick åt" och "vi vet inte". Granskningen fångade det en gång;
 * testet finns för att det inte ska gå att återinföra.
 *
 * Överdraget behåller sitt eget läge även med egenkontroll: att jobbet är avräknat gör inte
 * överförbrukningen mindre sann.
 */
export function sackProgressState(planned: number, reported: number, final: boolean): SackProgressState {
  if (!(planned > 0) && !(reported > 0) && !final) return 'hidden';
  if (final) return sacksOverrun(planned, reported) > 0 ? 'final-overrun' : 'final';
  if (reported > 0) return sacksOverrun(planned, reported) > 0 ? 'overrun' : 'remaining';
  return 'planned';
}

// En rad i huvudboken, som den läses tillbaka.
export type SackReportRow = {
  id: string;
  segment_id: string;
  work_order_id: string;
  report_day: string;
  sacks_blown: number | string;
  kind: string | null;
  material: string | null;
  construction: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

// En rad som klienten ser den: tal i stället för PostgREST-strängar, namnet aldrig tomt, och
// supersede redan avgjort av servern så två ytor inte kan räkna olika.
export type SackReportView = {
  id: string;
  report_day: string;
  sacks_blown: number;
  kind: SackReportKind;
  material: string | null;
  construction: string | null;
  note: string | null;
  created_by_name: string;
  created_at: string;
  superseded: boolean;
  /**
   * Får DEN HÄR användaren ta bort raden?
   *
   * ⚠️ Avgörs av SERVERN, aldrig av klienten — av exakt samma skäl som `has_final`. Regeln bor i
   * RLS (kontoret via planning.schedule.write, rapportören via ops_segment_reports_delete_own_
   * partial), och en klient som räknade ut den själv hade fått en andra kopia som glider isär:
   * knappen syns, DELETE:n träffar noll rader, och användaren står med ett 403 på en rad hen
   * redan sett försvinna ur listan.
   *
   * `created_by` skickas MEDVETET inte med i stället. Kortet skulle bara ha jämfört det med sitt
   * eget id och gissat resten av regeln (kind, behörighet) — det är den kopian vi undviker.
   */
  can_delete: boolean;
};

const SACK_REPORT_SELECT =
  'id, segment_id, work_order_id, report_day, sacks_blown, kind, material, construction, note, created_by, created_by_name, created_at';

/**
 * Jobbets segment, för att avgöra vilket segment en rapporterad dag hör till.
 *
 * ⚠️ KRÄVER ADMIN-KLIENTEN. ops_segments SELECT kräver planning.schedule.read, som installatören
 * INTE har (20260611_planning_permissions.sql delar ut den till admin/sales/konsult). Skickas
 * sessionsklienten hit får besättningen noll segment, upplösningen ger null, och rapporten avvisas
 * med "jobbet har ingen planerad dag" — ett fel som ser ut som ett planeringsproblem men är ett
 * behörighetsproblem.
 *
 * Elevationen är smal med flit: bara id och dagarna, bara för EN order, och anropsstället har redan
 * avgjort att användaren når ordern.
 */
export async function listWorkOrderSegments(
  admin: SupabaseClient,
  workOrderId: string,
): Promise<ResolvableSegment[]> {
  const { data } = await admin
    .from('ops_segments')
    .select('id, start_day, end_day')
    .eq('work_order_id', workOrderId);
  return (data ?? []) as ResolvableSegment[];
}

// Jobbets rapportrader, nyaste först. Går genom sessionsklienten: RLS avgör vem som ser vad
// (kontoret via planning.schedule.read, besättningen via is_user_on_work_order).
export async function listSackReports(supabase: SupabaseClient, workOrderId: string) {
  return supabase
    .from('ops_segment_reports')
    .select(SACK_REPORT_SELECT)
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false });
}

export type NewSackReport = {
  segment_id: string;
  work_order_id: string;
  report_day: string;
  sacks_blown: number;
  kind: SackReportKind;
  material: string | null;
  construction: string | null;
  note: string | null;
  created_by: string;
  created_by_name: string;
};

/**
 * Skriver rapportrader i huvudboken.
 *
 * ⚠️ MÅSTE GÅ GENOM SESSIONSKLIENTEN, aldrig admin. Det är RLS som auktoriserar skrivningen —
 * insert-policyn kräver `created_by = auth.uid()` OCH att användaren är besättning på jobbet (eller
 * har planning.schedule.write). Med admin-klienten hade vilken inloggad användare som helst kunnat
 * skriva säckar på vilket jobb som helst, och den enda kontrollen hade varit den vi råkat skriva i
 * routen.
 *
 * ⚠️ `work_order_id` sätts server-side ur rutt-parametern och `segment_id` ur upplösningen — inget
 * av dem får komma från klienten. RLS gatar på work_order_id, så en klient som fick välja det själv
 * hade valt ett jobb hen är besättning på och skrivit säckar där.
 *
 * En insert med flera rader är EN sats: antingen landar dagens alla placeringar eller ingen. Rad
 * för rad hade en avvisad tredje rad lämnat två halva rader i en append-only bok som inte kan
 * städas från fältet.
 */
export async function createSackReports(supabase: SupabaseClient, rows: NewSackReport[]) {
  return supabase.from('ops_segment_reports').insert(rows).select(SACK_REPORT_SELECT);
}

/**
 * Tar bort de final-rader som en ny egenkontroll ersätter.
 *
 * ⚠️ KRÄVER ADMIN-KLIENTEN. Boken är append-only FRÅN FÄLTET — besättningen har varken UPDATE- eller
 * DELETE-policy (20260820_ops_segment_reports_sack_reporting.sql), med flit. Det här är inte en
 * användaråtgärd utan ett serverstyrt ersättningssteg.
 *
 * ⚠️ ANROPAS EFTER att den nya uppsättningen skrivits genom SESSIONSKLIENTEN. Då har RLS redan
 * avgjort att användaren får skriva finaler på ordern, och elevationen ärver det beslutet i stället
 * för att kringgå det. Körs den före är den ett odokumenterat hål: vem som helst som når routen
 * kunde radera vilket jobbs egenkontroll som helst.
 *
 * ⚠️ PÅ ID, INTE PÅ `work_order_id AND kind = 'final'`. Id:na fångas FÖRE insert:en, så satsen kan
 * omöjligt råka radera de rader som just skrevs — och inte heller en tredje uppsättning som en
 * parallell sparning hann lägga emellan.
 */
export async function deleteSackReportsByIds(admin: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return { error: null };
  const { error } = await admin.from('ops_segment_reports').delete().in('id', ids);
  return { error };
}

// Blåsta säckar per arbetsorder, plus om summan är egenkontrollens. Betjänar BÅDE
// planeringstavlan (som ritar skillnaden) och arbetsorderns snabböversikt (som bara vill ha talet,
// via reportedSacksByWorkOrder nedan). ENDA frågan mot ops_segment_reports i den här modulen.
//
// ⚠️ `kind` MÅSTE med i select:en. Utan den läser sumSacksByWorkOrder varje rad som 'partial'
// och adderar delrapporterna ovanpå egenkontrollen — 30 + 25 + 91 = 146 där svaret är 91.
// Felet syns inte som ett fel, bara som ett för högt tal. Kolumnen bär dessutom `hasFinal`, så en
// borttagning härifrån släcker två saker samtidigt.
//
// Ett jobb utan rapportrader SAKNAS i kartan i stället för att stå som 0 — anropsstället måste
// skilja "ej rapporterat" från "noll säckar".
export async function sackTotalsForWorkOrders(
  supabase: SupabaseClient,
  workOrderIds: string[],
): Promise<Map<string, SackTotal>> {
  if (workOrderIds.length === 0) return new Map<string, SackTotal>();
  const { data } = await supabase
    .from('ops_segment_reports')
    .select('work_order_id, sacks_blown, kind')
    .in('work_order_id', workOrderIds);
  return sackTotalsByWorkOrder((data ?? []) as SackLedgerRow[]);
}

/**
 * Bara summorna — för anropare som inte bryr sig om varifrån talet kommer (arbetsorderns
 * snabböversikt).
 *
 * ⚠️ HÄRLEDD, INTE EN EGEN FRÅGA. Frågan ovan är den enda mot ops_segment_reports i den här
 * modulen, och det är med flit: `kind`-kravet i kommentaren är lastbärande, och en andra kopia av
 * select:en hade kunnat tappa kolumnen utan att den varningen stod bredvid. Då läser
 * sumSacksByWorkOrder varje rad som 'partial' och adderar delrapporterna ovanpå egenkontrollen —
 * 30 + 25 + 91 = 146 där svaret är 91, och felet syns bara som ett för högt tal.
 */
export async function reportedSacksByWorkOrder(
  supabase: SupabaseClient,
  workOrderIds: string[],
): Promise<Map<string, number>> {
  const totals = await sackTotalsForWorkOrders(supabase, workOrderIds);
  const map = new Map<string, number>();
  for (const [workOrderId, total] of totals) map.set(workOrderId, total.sacks);
  return map;
}

/**
 * EN rapportrad på ordern, läst för sig.
 *
 * Finns för borttagningen, som måste kunna skilja "raden finns inte" från "raden är en
 * egenkontroll". Ett DELETE som inte träffar något svarar `error: null` från PostgREST — utan den
 * här läsningen hade båda fallen sett likadana ut och användaren fått fel besked om det ena.
 *
 * ⚠️ `work_order_id` är inte överflödigt trots att id:t är unikt: utan det kan en rad på en ANNAN
 * order läsas (och raderas) genom den här orderns adress. Samma skäl som i deleteCrmWorkOrderFile.
 */
export async function getSackReport(supabase: SupabaseClient, id: string, workOrderId: string) {
  return supabase
    .from('ops_segment_reports')
    .select(SACK_REPORT_SELECT)
    .eq('id', id)
    .eq('work_order_id', workOrderId)
    .maybeSingle();
}

/**
 * Tar bort EN delrapport — kontorets rättning av en dag som rapporterats två gånger.
 *
 * Boken är append-only FRÅN FÄLTET, inte från kontoret: ops_segment_reports_delete (20260611)
 * finns sedan tabellen skapades och gatar på planning.schedule.write. Den här funktionen är därför
 * en ny väg till en rättighet som redan är utdelad — ingen ny policy, ingen migrering.
 *
 * ⚠️ `kind = 'partial'` står i SATSEN, inte bara i routens kontroll. Regeln är "finns en final är
 * den jobbets sanning; annars summan av partial" — raderas orderns enda final SLÄPPS alltså
 * delrapporterna fram som total igen, och en borttagning som skulle sänka siffran HÖJER den i
 * stället. Filtret gör den felmoden omöjlig även om routen någon gång slutar kontrollera.
 *
 * ⚠️ Går genom SESSIONSKLIENTEN, aldrig admin. Det är RLS som auktoriserar, precis som på
 * skrivvägen — med admin-klienten hade routens egen kontroll varit den enda spärren.
 *
 * ⚠️ `.select().maybeSingle()`: en DELETE som inte träffar någon rad svarar `error: null`. Utan
 * raden tillbaka hade en RLS-nekad borttagning sett ut som en lyckad, och kortet hade tagit bort
 * en rad ur listan som ligger kvar i databasen.
 */
export async function deleteSackReport(supabase: SupabaseClient, id: string, workOrderId: string) {
  return supabase
    .from('ops_segment_reports')
    .delete()
    .eq('id', id)
    .eq('work_order_id', workOrderId)
    .eq('kind', 'partial')
    .select('id')
    .maybeSingle();
}
