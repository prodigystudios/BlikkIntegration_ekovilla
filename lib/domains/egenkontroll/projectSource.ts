import { lineItemSacks, type SackLineItem } from '@/lib/domains/crm/materials';
import type { EtappOpenRow, EtappClosedRow } from './calculations';

// Field cutover fas 2 — where an egenkontroll gets its job from.
//
// The form has always looked a job up by order number in Blikk. During the cutover a job may live
// in either world, so the lookup tries CRM first and falls back to Blikk, and both are normalised
// to one shape here. The form then reads a single set of fields regardless of origin, and only the
// reporting step (which system gets the comment) branches on `source`.
//
// Pure: no I/O. The fetching lives in the page; this module only maps.

export type EgenkontrollProjectSource = 'crm' | 'blikk';

export type EgenkontrollAddress = {
  streetAddress: string;
  postalCode: string;
  city: string;
};

export type EgenkontrollProject = {
  source: EgenkontrollProjectSource;
  // Where the finished report is reported back to. Exactly one is set, by source.
  workOrderId: string | null;
  blikkProjectId: string | null;
  orderNumber: string | null;
  customerName: string;
  address: EgenkontrollAddress;
  // YYYY-MM-DD, prefilled as the installation date.
  installationDate: string;
  // Human summary shown on the lookup card.
  description: string;
  // CRM only: the order's rows, which already carry area/thickness/density as structured data.
  lineItems: CrmEgenkontrollLineItem[] | null;
};

export type CrmEgenkontrollLineItem = SackLineItem & {
  construction?: string | null;
  line_note?: string | null;
};

export type CrmWorkOrderLookupRow = {
  id: string;
  order_number: string;
  fortnox_order_number?: string | null;
  project_name?: string | null;
  client_name?: string | null;
  // The day the job is actually scheduled for (ops_segments.start_day), resolved by the lookup
  // route. Takes precedence over desired_installation_date, which is what the customer ASKED for
  // when the order was written and is never updated when the planner moves the job. The egenkontroll
  // is a signed quality document — dating it from a stale wish rather than the day the work
  // happened would put the wrong date on a compliance artefact.
  scheduled_day?: string | null;
  desired_installation_date?: string | null;
  work_address?: Record<string, unknown> | null;
  customer_snapshot?: Record<string, unknown> | null;
  internal_handoff?: Record<string, unknown> | null;
  line_items?: CrmEgenkontrollLineItem[] | null;
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

// YYYY-MM-DD from either a plain date or a full timestamp; '' when unparseable.
const isoDay = (v: unknown): string => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

// ── CRM work order ──────────────────────────────────────────────────────────

export function mapCrmWorkOrderToEgenkontrollProject(row: CrmWorkOrderLookupRow): EgenkontrollProject {
  // Job-site address first, then a separate delivery address, then the customer's card address —
  // the same precedence as resolveJobAddress, kept as parts because the form has three fields.
  const work = (row.work_address ?? {}) as Record<string, unknown>;
  const snap = (row.customer_snapshot ?? {}) as Record<string, unknown>;
  const address: EgenkontrollAddress = str(work.street_address)
    ? { streetAddress: str(work.street_address), postalCode: str(work.postal_code), city: str(work.city) }
    : str(snap.delivery_address)
      ? { streetAddress: str(snap.delivery_address), postalCode: str(snap.delivery_postal_code), city: str(snap.delivery_city) }
      : { streetAddress: str(snap.street_address), postalCode: str(snap.postal_code), city: str(snap.city) };

  const handoff = (row.internal_handoff ?? {}) as Record<string, unknown>;

  return {
    source: 'crm',
    workOrderId: row.id,
    blikkProjectId: null,
    // The reference the business follows — Fortnox number once synced, else the internal one.
    orderNumber: str(row.fortnox_order_number) || str(row.order_number) || null,
    customerName: str(row.client_name),
    address,
    installationDate: isoDay(row.scheduled_day) || isoDay(row.desired_installation_date),
    description: [str(row.project_name), str(handoff.work_scope)].filter(Boolean).join(' — '),
    lineItems: Array.isArray(row.line_items) ? row.line_items : [],
  };
}

// ── Blikk project (legacy) ──────────────────────────────────────────────────

export function mapBlikkProjectToEgenkontrollProject(raw: Record<string, any> | null | undefined): EgenkontrollProject | null {
  if (!raw) return null;
  // No id is NOT a failure: /api/projects/lookup deliberately returns the list summary when the
  // matched project has no id, and the form has always been fillable from that. blikkProjectId
  // stays null and the submit step simply skips the Blikk comment — same as before this refactor.
  // Requiring an id here would turn a supported case into "Ordern hittades inte".
  const id = str(raw.id) || str(raw.projectId);
  const location = (raw.workSiteAddress || raw.location || {}) as Record<string, unknown>;
  return {
    source: 'blikk',
    workOrderId: null,
    // null, not '' — the submit step tests this to decide whether to post the Blikk comment, and
    // the type promises null for "no project to comment on".
    blikkProjectId: id || null,
    orderNumber: str(raw.orderNumber) || null,
    customerName: str(raw?.customer?.name),
    address: {
      streetAddress: str(location.streetAddress),
      postalCode: str(location.postalCode),
      city: str(location.city),
    },
    installationDate: isoDay(raw.startDate) || isoDay(raw.created),
    description: str(raw.description),
    lineItems: null,
  };
}

// ── Etapp rows from CRM line items ──────────────────────────────────────────

// The quote form stores the construction type as a slug. The egenkontroll is printed and handed to
// the customer, so 'vagg' must not appear where "Vägg" belongs. Mirrors the labels the quote form
// shows the seller (app/crm/offerter/QuoteFormClient.tsx).
const CONSTRUCTION_LABELS: Record<string, string> = {
  vagg: 'Vägg',
  snedtak: 'Snedtak',
  vind: 'Vind',
};

function constructionLabel(value: unknown): string {
  const slug = str(value).toLowerCase();
  return CONSTRUCTION_LABELS[slug] ?? str(value);
}

// A CRM order already knows each row's area, thickness and density as fields, so the etapp rows
// are mapped straight across. (The Blikk path has to regex them back out of a free-text project
// description — see parseEtappRows — which is exactly the fragility this replaces.)
//
// `construction` splits the two tables the form keeps: 'vind' is blown open (loose fill on an
// attic floor, settling matters), everything else is a closed cavity.
export function etappRowsFromLineItems(
  items: CrmEgenkontrollLineItem[] | null | undefined,
  lambda?: string,
): { open: EtappOpenRow[]; closed: EtappClosedRow[] } {
  const open: EtappOpenRow[] = [];
  const closed: EtappClosedRow[] = [];
  if (!Array.isArray(items)) return { open, closed };

  for (const item of items) {
    const area = str(item.m2);
    const thickness = str(item.thickness_mm);
    // Rows without a measured area/thickness are articles, not construction stages (travel,
    // equipment, the carved-out ROT labour row) — they have no place in an egenkontroll.
    if (!area || !thickness) continue;
    // Item-priced rows must be skipped even when measurements linger: lineItemQuantity returns the
    // piece count for pricing_mode 'item', so lineItemSacks would read "quantity 1" as 1 m³ and
    // print a sack count invented from nothing onto a signed document.
    if (str(item.pricing_mode).toLowerCase() === 'item') continue;

    const construction = str(item.construction).toLowerCase();
    const label = str(item.line_note) || constructionLabel(item.construction) || str(item.article_name);
    const sacks = lineItemSacks(item);
    const sacksStr = sacks > 0 ? String(sacks) : '';
    const density = str(item.density);

    if (construction === 'vind') {
      open.push({
        etapp: label,
        ytaM2: area,
        bestalldTjocklek: thickness,
        sattningsprocent: '',
        installeradTjocklek: '',
        antalSack: sacksStr,
        installeradDensitet: density,
        lambdavarde: lambda,
      });
    } else {
      closed.push({
        etapp: label,
        ytaM2: area,
        bestalldTjocklek: thickness,
        uppmatTjocklek: '',
        installeradDensitet: density,
        antalSackKgPerSack: sacksStr,
        lambdavarde: lambda,
      });
    }
  }

  return { open, closed };
}
