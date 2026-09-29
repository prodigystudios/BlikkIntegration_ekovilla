import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { linkStoreOrderCustomer } from '@/lib/domains/portal/storeOrderActions';
import { ok, routeError, validationError } from '../../../../_shared';
import { requireStoreOrderManager } from '../../_manage';

type RouteContext = { params: { id: string } };

// Butikens kundkort på en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b), medan den är mottagen. Kortet läses
// med sessionen, och kopplingen sparas också på butiken (som fas 3c).
//
//   200 { store_linked }
//   400 validation_error
//   403 store_order_forbidden                  varken ansvarig eller admin
//   404 store_order_not_found / crm_customer_not_found
//   409 store_order_not_received               bekräftad, tillbakadragen eller makulerad
//   422 portal_customer_not_business           ett privatkundskort: butiken är ett företag
//   422 store_order_customer_not_in_fortnox    kortet har inget kundnummer i Fortnox

export const dynamic = 'force-dynamic';
// Next 14.2 räknar inte PUT som dynamisk och cachar då varje fetch, också Supabase-klientens.
export const fetchCache = 'force-no-store';

const bodySchema = z.object({
  customer_id: z.string().uuid('Välj butikens kundkort i listan.'),
});

export async function PUT(req: Request, context: RouteContext) {
  try {
    const gate = await requireStoreOrderManager(context.params.id);
    if (gate.response) return gate.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const result = await linkStoreOrderCustomer(gate.session, getSupabaseAdmin(), {
      id: context.params.id,
      customerId: parsed.data.customer_id,
      actor: { id: gate.userId },
    });
    switch (result.kind) {
      case 'linked':
        return ok({ store_linked: result.storeLinked });
      case 'not_found':
        return routeError(404, 'store_order_not_found', 'Beställningen hittades inte.');
      case 'not_received':
        return routeError(409, 'store_order_not_received', 'Kunden kan bara bytas innan beställningen är bekräftad.');
      case 'customer_not_found':
        return routeError(404, 'crm_customer_not_found', 'Kundkortet hittades inte.');
      case 'not_business':
        return routeError(422, 'portal_customer_not_business', 'Välj butikens kundkort. Butiken är ett företag, inte en privatkund.');
      case 'customer_not_in_fortnox':
        return routeError(422, 'store_order_customer_not_in_fortnox', 'Kundkortet har inget kundnummer i Fortnox. Skicka kortet till Fortnox först.');
    }
  } catch (e) {
    console.error('[portal-store-orders] kunden kunde inte kopplas', { id: context.params.id, error: e instanceof Error ? e.message : String(e) });
    return routeError(500, 'store_order_customer_failed', 'Kunden kunde inte kopplas.');
  }
}
