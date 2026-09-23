import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkIds, readAllPages } from './pagedRead';
import type {
  ProductionRange,
  ProductionReportRow,
  ProductionSegmentRow,
  ProductionTruckRow,
} from './production';

// I/O-halvan av produktionsutfallet. Räkningen bor i production.ts och är ren; den här modulen gör
// bara läsningarna. Samma delning som afterCalculation.ts / afterCalculationLoader.ts.

export type ProductionData = {
  reports: ProductionReportRow[];
  segments: ProductionSegmentRow[];
  trucks: ProductionTruckRow[];
};

const REPORT_SELECT = 'id, work_order_id, segment_id, report_day, sacks_blown, kind, material';
const SEGMENT_SELECT = 'id, truck_id, start_day, end_day';

/**
 * Underlaget för periodens produktionsutfall.
 *
 * ⚠️ TVÅ LÄSNINGAR AV RAPPORTERNA, INTE EN. Den första hämtar periodens rader bara för att veta
 * VILKA ARBETSORDRAR som berörs; den andra hämtar ALLA rader för de arbetsordrarna, oavsett datum.
 * Skälet är supersede-regeln: en egenkontroll som skrevs efter periodens slut ersätter
 * delrapporterna inuti perioden, och hämtas bara periodens rader ser de delrapporterna olevande ut.
 * Då räknas samma säckar en gång här och en gång i den period där egenkontrollen ligger.
 * `buildProduction` filtrerar ner till perioden EFTER supersede — men bara om den fått hela bilden.
 *
 * ⚠️ SEGMENTEN HÄMTAS FRÅN TVÅ HÅLL. Beläggningsgraden behöver alla segment som ÖVERLAPPAR
 * perioden; attributionen av säckar till bil behöver de segment rapporterna PEKAR PÅ. De två
 * mängderna är nästan men inte helt desamma — en rapport skriven dagen efter att segmentet slutade
 * kan peka utanför fönstret. Unionen tas här så ingen av de två frågorna tappar sitt underlag.
 */
export async function fetchProductionData(
  supabase: SupabaseClient,
  range: ProductionRange,
): Promise<{ data: ProductionData; error: { message: string } | null }> {
  const empty: ProductionData = { reports: [], segments: [], trucks: [] };

  // 1) Vilka arbetsordrar rapporterades i perioden?
  const seed = await readAllPages<{ work_order_id: string | null }>((from, to) =>
    supabase
      .from('ops_segment_reports')
      .select('work_order_id')
      .gte('report_day', range.from)
      .lte('report_day', range.to)
      // Unik och stabil ordning — utan den är sidindelningen odefinierad.
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (seed.error) return { data: empty, error: seed.error };

  const workOrderIds = [...new Set(seed.rows.map((r) => r.work_order_id).filter((id): id is string => Boolean(id)))];

  // 2) ALLA rader för de arbetsordrarna — hela supersede-bilden.
  const reports: ProductionReportRow[] = [];
  for (const chunk of chunkIds(workOrderIds)) {
    const page = await readAllPages<ProductionReportRow>((from, to) =>
      supabase
        .from('ops_segment_reports')
        .select(REPORT_SELECT)
        .in('work_order_id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (page.error) return { data: empty, error: page.error };
    reports.push(...page.rows);
  }

  // 3a) Segment som överlappar perioden — nämnaren i beläggningsgraden.
  const overlapping = await readAllPages<ProductionSegmentRow>((from, to) =>
    supabase
      .from('ops_segments')
      .select(SEGMENT_SELECT)
      .lte('start_day', range.to)
      .gte('end_day', range.from)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (overlapping.error) return { data: empty, error: overlapping.error };

  // 3b) Segment som rapporterna pekar på och som inte redan kommit med.
  const seen = new Set(overlapping.rows.map((s) => s.id));
  const missing = [...new Set(
    reports.map((r) => r.segment_id).filter((id): id is string => Boolean(id) && !seen.has(id as string)),
  )];

  const segments = [...overlapping.rows];
  for (const chunk of chunkIds(missing)) {
    const page = await readAllPages<ProductionSegmentRow>((from, to) =>
      supabase
        .from('ops_segments')
        .select(SEGMENT_SELECT)
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (page.error) return { data: empty, error: page.error };
    segments.push(...page.rows);
  }

  // 4) Bilnamnen. Inaktiva bilar tas MED — en bil som pensionerats i september har ändå kört i
  //    juni, och att filtrera på `active` hade tyst tömt dess stapel i en historisk period.
  const { data: truckRows, error: truckError } = await supabase
    .from('ops_trucks')
    .select('id, name')
    .order('name', { ascending: true });
  if (truckError) return { data: empty, error: truckError };

  return {
    data: { reports, segments, trucks: (truckRows as ProductionTruckRow[]) || [] },
    error: null,
  };
}
