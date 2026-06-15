import { inferMaterialFromArticle, totalSacks } from '@/lib/domains/crm/materials';
import { lineItemRowTotal, type PricingLineItem } from '@/lib/domains/crm/pricing';

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

// Map a crm_work_orders row to the shared display fields shown on a planning card.
export function mapWorkOrderJob(row: WorkOrderJobRow): JobDisplay {
  const { ref, isFortnox } = workOrderRef(row.fortnox_order_number, row.order_number);
  return {
    ref,
    is_fortnox_ref: isFortnox,
    project_name: row.project_name,
    client_name: row.client_name,
    status: row.status,
    address: resolveJobAddress(row.work_address, row.customer_snapshot),
    total_sacks: totalSacks((row.line_items ?? []) as never),
    material: materialLabelFromLineItems(row.line_items),
    revenue: lineItemsRevenue(row.line_items),
  };
}
