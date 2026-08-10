import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { forbidIfReadonly } from '@/lib/auth/route';
import { lookupCrmWorkOrderByNumber } from '@/lib/domains/crm/work-orders';
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
//   • the projection is fixed in the domain module (lookupCrmWorkOrderByNumber): address fields
//     only from customer_snapshot — personnummer never leaves the server — and line items reduced
//     to geometry, so no unit_price / discount / labour cost either
//   • read-only; there is no write path here
// Same shape as the existing service-role + explicit-gate route /api/planning/consume-bags.
//
// KNOWN LIMITATION: filing the finished report still goes through RLS (POST …/comments), which
// requires crew or assignee. Someone covering a shift they were never scheduled on can fill the
// egenkontroll in and archive the PDF, but the comment on the order will fail. Revisit if that
// turns out to happen in practice.

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  orderNumber: z.string().trim().min(1, 'orderNumber is required').max(64),
});

export async function GET(req: Request) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    // Shared helper — covers BOTH 'konsult' and 'readonly'. A hand-rolled role check here drifted
    // from it once already.
    const readonly = await forbidIfReadonly();
    if (readonly) return readonly;

    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse({ orderNumber: searchParams.get('orderNumber') ?? '' });
    if (!parsed.success) return validationError(parsed.error);

    const { data, error } = await lookupCrmWorkOrderByNumber(getSupabaseAdmin(), parsed.data.orderNumber);
    if (error) return routeError(500, 'crm_work_order_lookup_failed', error.message);

    // Not an error — the caller falls back to Blikk for jobs still in the legacy planning.
    if (!data) return routeError(404, 'crm_work_order_not_found', 'No CRM work order with that number');

    return ok({ item: mapCrmWorkOrderToEgenkontrollProject(data as unknown as CrmWorkOrderLookupRow) });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_lookup_unexpected', e?.message || 'Failed to look up work order');
  }
}
