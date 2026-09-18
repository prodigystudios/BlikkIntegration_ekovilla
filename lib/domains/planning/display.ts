import { inferMaterialFromArticle, totalSacks } from '@/lib/domains/crm/materials';
import { lineItemRowTotal, type PricingLineItem } from '@/lib/domains/crm/pricing';
import {
  scopeLineItems,
  type StageLineItem,
  type StageScope,
  type WorkOrderStage,
} from '@/lib/domains/crm/workOrderStages';

// A work order's revenue (omsättning) = sum of its line-item row totals, ex VAT — the same row math
// the quote/order/Fortnox use, so the figure can't drift.
function lineItemsRevenue(items: unknown[] | null | undefined): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce<number>((sum, it) => sum + lineItemRowTotal(it as PricingLineItem), 0);
}

// Shared, pure display mapping for a CRM work order shown in the planning board — used by both
// the backlog read model and the scheduled-segment read model so a job looks identical wherever
// it appears (same reference, address, sacks, material).

// The raw crm_work_orders columns the planning board reads.
export type WorkOrderJobRow = {
  order_number: string;
  fortnox_order_number?: string | null;
  project_name: string;
  client_name: string;
  status: string;
  customer_snapshot?: Record<string, unknown> | null;
  work_address?: Record<string, unknown> | null;
  line_items?: unknown[] | null;
};

export type JobDisplay = {
  // Reference shown on cards: the Fortnox order number when synced (e.g. "#5418"), else the
  // internal order number. The number the business follows is the Fortnox one.
  ref: string;
  is_fortnox_ref: boolean;
  project_name: string;
  client_name: string;
  status: string;
  address: string | null;
  total_sacks: number;
  material: string | null;
  // Order value ex VAT (omsättning), summed from the line items.
  revenue: number;
  /** Etappen kortet visar, när ordern är uppdelad. null = hela ordern eller resten av den. */
  stage: { id: string; number: number; title: string } | null;
  /**
   * Sant när kortet visar RESTEN av en uppdelad order — alltså allt ingen etapp tagit.
   *
   * 🧨 Skiljer "resten av en uppdelad order" från "en order utan etapper". Båda har `stage: null`,
   * men bara den första behöver säga vad den bär: säckbadgen visar HELA orderns tal (säckboken är
   * per arbetsorder), så utan ett eget chip var 797 det enda synliga talet på ett kort som i
   * själva verket bar 447. Etappkortet hade sitt chip och gick fritt; rest-kortet log.
   */
  is_rest: boolean;
  /** Hela arbetsorderns säckar, oavsett scope — se kommentaren vid mapWorkOrderJob. */
  order_total_sacks: number;
};

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function joinAddress(parts: unknown[]): string | null {
  const cleaned = parts.map(str).filter(Boolean);
  return cleaned.length ? cleaned.join(', ') : null;
}

// Lead with the Fortnox order number when present (the reference the business follows), else fall
// back to the internal order number. Mirrors documentRef used across the CRM.
export function workOrderRef(fortnoxOrderNumber: string | null | undefined, orderNumber: string): { ref: string; isFortnox: boolean } {
  const fx = str(fortnoxOrderNumber);
  return fx ? { ref: `#${fx}`, isFortnox: true } : { ref: orderNumber, isFortnox: false };
}

// The job-site address: a separate work address when stored (only persisted when it differs from
// the customer address), else a separate delivery address on the snapshot, else the customer's
// card address. Mirrors how the order itself resolves the work address.
export function resolveJobAddress(
  workAddress: Record<string, unknown> | null | undefined,
  snapshot: Record<string, unknown> | null | undefined,
): string | null {
  const wa = workAddress ?? {};
  if (str(wa.street_address)) return joinAddress([wa.street_address, wa.postal_code, wa.city]);
  const snap = snapshot ?? {};
  if (str(snap.delivery_address)) return joinAddress([snap.delivery_address, snap.delivery_postal_code, snap.delivery_city]);
  return joinAddress([snap.street_address, snap.postal_code, snap.city]);
}

// Best-effort material label from the line items (the insulation the job uses, e.g. "Ekovilla"),
// derived from the article names. Returns null when no known material is recognised. An explicit
// per-segment job type (Leverans/Utsugning/…) is a later slice.
export function materialLabelFromLineItems(lineItems: unknown[] | null | undefined): string | null {
  if (!Array.isArray(lineItems)) return null;
  for (const it of lineItems) {
    const name = (it as { article_name?: string | null })?.article_name;
    const m = inferMaterialFromArticle(name);
    if (m) return m.short.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

// Free-text match over the fields a planning card actually shows. Shared by the board's search box
// and the backlog's, so the same term hits the same way in both places — the two boxes are separate
// on purpose (searching for a job to place must not blank out the schedule you're placing it into),
// but they should never disagree about what counts as a match.
//
// An empty query matches everything: a blank box is "no filter", not "nothing found".
export function matchesJobSearch(
  job: Pick<JobDisplay, 'ref' | 'client_name' | 'project_name' | 'address'>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [job.ref, job.client_name, job.project_name, job.address].some((v) => (v ?? '').toLowerCase().includes(q));
}

/**
 * Map a crm_work_orders row to the shared display fields shown on a planning card.
 *
 * `scope` avgör VAD kortet visar: hela ordern (standard), en etapp, eller resten som ingen etapp
 * tagit. Beskärningen sker i lib/domains/crm/workOrderStages.ts och returnerar vanliga radobjekt,
 * så de tre uträkningarna nedan är oförändrade och känner inte till etapper.
 *
 * 🧨 `{ kind: 'whole' }` RETURNERAR RADERNA ORÖRDA. En order utan etapper räknas därför bit för bit
 * som före etappbegreppet — det är bakåtkompatibilitetens gångjärn, och ett test låser det.
 *
 * ⚠️ MATERIALET MÅSTE LÄSAS UR DEN BESKURNA ARRAYEN. Läses det ur hela ordern visar etapp 2
 * (snedtaket, kanske Knauf) etapp 1:s material, och planeraren beställer fel säckar till fel vecka.
 */
export function mapWorkOrderJob(row: WorkOrderJobRow, scope: StageScope = { kind: 'whole' }): JobDisplay {
  const { ref, isFortnox } = workOrderRef(row.fortnox_order_number, row.order_number);
  const items = scopeLineItems((row.line_items ?? []) as StageLineItem[], scope);
  return {
    ref,
    is_fortnox_ref: isFortnox,
    project_name: row.project_name,
    client_name: row.client_name,
    status: row.status,
    address: resolveJobAddress(row.work_address, row.customer_snapshot),
    total_sacks: totalSacks(items as never),
    material: materialLabelFromLineItems(items),
    revenue: lineItemsRevenue(items),
    stage:
      scope.kind === 'stage'
        ? { id: scope.stage.id, number: scope.stage.stage_number, title: scope.stage.title }
        : null,
    // Bara när ordern FAKTISKT är uppdelad. En order utan etapper är inte "resten" av något.
    is_rest: scope.kind === 'rest' && scope.stages.length > 0,
    // ⛔ Helorderns säckar, ALLTID — även på ett etappkort. Säckrapporteringen är per ARBETSORDER
    // (en egenkontroll är totalen för hela jobbet, se sackLedger), så en nedräkning mot etappens
    // tal hade sagt "kvar 0 / 120" på etapp 2 så fort etapp 1 var färdigblåst. Kortet visar
    // etappens tal som sitt eget och mäter framdriften mot jobbet.
    order_total_sacks: totalSacks((row.line_items ?? []) as never),
  };
}

/**
 * Bygg ett scope ur en placerings `stage_id` och orderns etapper.
 *
 * Okänd etapp (raderad mellan läsningarna) behandlas som resten i stället för att kasta — kortet
 * ska rita något, och resten är det ärligaste svaret när etappen är borta.
 */
export function scopeForSegment(stageId: string | null | undefined, stages: WorkOrderStage[] | null | undefined): StageScope {
  const all = stages ?? [];
  if (all.length === 0) return { kind: 'whole' };
  const stage = stageId ? all.find((s) => s.id === stageId) : undefined;
  return stage ? { kind: 'stage', stage, siblings: all } : { kind: 'rest', stages: all };
}
