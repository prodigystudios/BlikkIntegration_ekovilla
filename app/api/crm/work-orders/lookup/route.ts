import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { mapCrmWorkOrderToEgenkontrollProject, type CrmWorkOrderLookupRow } from '@/lib/domains/egenkontroll/projectSource';
import { ok, requireSignedInUser, routeError, validationError } from '../_lib';

// Look up a work order by the number written on the job — the CRM half of the egenkontroll's
// order lookup (app/egenkontroll). The form tries this first and falls back to the legacy Blikk
// lookup (/api/projects/lookup) for jobs still planned in the old world.
//
// WHY SERVICE ROLE: an egenkontroll must be fillable for any job by number. Under the session
// client, RLS would only return orders the person is assigned to or scheduled crew on
// (20260810_crm_work_order_crew_access.sql), so covering a shift, a late crew assignment, or a
// same-day reshuffle would leave the installer unable to open their own paperwork. The legacy
// Blikk lookup this replaces had no such restriction either.
//
// The elevation is kept narrow and deliberate:
//   • authorization is explicit below (signed in, and not a read-only role)
//   • the projection is fixed and minimal — no pricing_summary, no rot_details, and from
//     customer_snapshot only the address fields, so personnummer never leaves the server
//   • read-only; there is no write path here
// Same shape as the existing service-role + explicit-gate route /api/planning/consume-bags.

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  orderNumber: z.string().trim().min(1, 'orderNumber is required').max(64),
});

// Everything the egenkontroll form needs, and nothing else.
const LOOKUP_SELECT =
  'id, order_number, fortnox_order_number, project_name, client_name, desired_installation_date, work_address, customer_snapshot, internal_handoff, line_items';

const ADDRESS_KEYS = [
  'street_address', 'postal_code', 'city',
  'delivery_address', 'delivery_postal_code', 'delivery_city',
] as const;

export async function GET(req: Request) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    // Read-only roles have no business producing field paperwork.
    if (currentUser.currentUser.role === 'konsult') {
      return routeError(403, 'forbidden', 'Read-only role cannot look up work orders');
    }

    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse({ orderNumber: searchParams.get('orderNumber') ?? '' });
    if (!parsed.success) return validationError(parsed.error);
    const orderNumber = parsed.data.orderNumber;

    const supabase = getSupabaseAdmin();

    // The number on the job may be either reference: Fortnox's once the order is synced, or the
    // internal AO number before that. Try Fortnox first — that is what the customer paperwork
    // shows and therefore what gets written down.
    const byFortnox = await supabase
      .from('crm_work_orders')
      .select(LOOKUP_SELECT)
      .eq('fortnox_order_number', orderNumber)
      .limit(1)
      .maybeSingle();
    if (byFortnox.error) return routeError(500, 'crm_work_order_lookup_failed', byFortnox.error.message);

    let row = byFortnox.data as CrmWorkOrderLookupRow | null;

    if (!row) {
      const byOrderNumber = await supabase
        .from('crm_work_orders')
        .select(LOOKUP_SELECT)
        .eq('order_number', orderNumber)
        .limit(1)
        .maybeSingle();
      if (byOrderNumber.error) return routeError(500, 'crm_work_order_lookup_failed', byOrderNumber.error.message);
      row = byOrderNumber.data as CrmWorkOrderLookupRow | null;
    }

    // Not an error — the caller falls back to Blikk for jobs still in the legacy planning.
    if (!row) return routeError(404, 'crm_work_order_not_found', 'No CRM work order with that number');

    // Strip customer_snapshot down to address fields before it leaves the server. Belt and braces
    // with LOOKUP_SELECT: the mapper only reads addresses, but a future edit to the mapper must
    // not be able to widen what this route exposes.
    const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>;
    const safeRow: CrmWorkOrderLookupRow = {
      ...row,
      customer_snapshot: Object.fromEntries(ADDRESS_KEYS.map((k) => [k, snapshot[k] ?? null])),
    };

    return ok({ item: mapCrmWorkOrderToEgenkontrollProject(safeRow) });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_lookup_unexpected', e?.message || 'Failed to look up work order');
  }
}
