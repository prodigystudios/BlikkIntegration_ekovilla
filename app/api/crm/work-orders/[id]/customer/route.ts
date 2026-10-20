import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { workOrderReadinessErrorCode } from '@/lib/domains/crm/workOrderReadiness';
import { swapWorkOrderCustomer } from '@/lib/domains/crm/swapWorkOrderCustomer';
import { invalidUuidParam, ok, requirePermission, routeError, validationError } from '../../../_shared';

type RouteContext = { params: { id: string } };

const bodySchema = z.object({
  customer_id: z.string().uuid('Välj kunden i listan'),
  // Arbetsplatsen: behåll orderns, eller ta den nya kundens adress. Dialogen föreslår (defaultWorkAddressChoice).
  work_address: z.enum(['keep', 'customer']),
});

// Byt kund på arbetsordern — och på Fortnox-ordern när den finns. Reglerna i
// lib/domains/crm/workOrderCustomerSwap.ts (Williams beslut 2026-10-20).
//
// crm.workorder.write, och sedan RLS på arbetsordern: bara den som har ordern, eller en admin, får ändra den.
//
//   200 { item, in_fortnox, fortnox_error }   bytt; fortnox_error när Fortnox-ordern inte kunde byta kund
//                                             (kunden är ändå bytt på ordern — "Synka om" tar Fortnox)
//   403 work_order_customer_forbidden         varken ansvarig för ordern eller admin
//   404 crm_work_order_not_found              ingen arbetsorder som du ser
//   404 crm_customer_not_found                kundkortet finns inte
//   409 work_order_customer_<skäl>            bytet nekas (same_customer, cancelled, invoiced, portal,
//                                             customer_type, reverse_vat) — meddelandet säger varför
//   409 crm_work_order_incomplete …           kortet saknar något (details.blockers)
//   409 work_order_customer_changed           ordern sparades av någon annan under tiden; ingenting sparat
//   502 work_order_customer_fortnox_customer  den nya kunden kunde inte läggas upp i Fortnox; ingenting sparat
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const session = createSessionClient();
    const workOrderId = context.params.id;
    const result = await swapWorkOrderCustomer(session, getSupabaseAdmin(), {
      workOrderId,
      customerId: parsed.data.customer_id,
      workAddress: parsed.data.work_address,
    });

    switch (result.kind) {
      case 'not_found':
        return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');
      case 'customer_not_found':
        return routeError(404, 'crm_customer_not_found', 'Kundkortet hittades inte.');
      case 'blocked':
        return routeError(409, `work_order_customer_${result.reason}`, result.message);
      case 'incomplete':
        return routeError(409, workOrderReadinessErrorCode(result.blockers), result.blockers[0]?.message || 'Kundkortet saknar uppgifter.', {
          blockers: result.blockers,
        });
      case 'fortnox_customer_failed':
        return routeError(502, 'work_order_customer_fortnox_customer', result.message);
      case 'forbidden':
        return routeError(403, 'work_order_customer_forbidden', 'Bara den som har ordern, eller en admin, kan byta kund.');
      case 'changed':
        return routeError(409, 'work_order_customer_changed', 'Ordern sparades av någon annan under tiden. Försök igen.');
      case 'swapped': {
        // Bytet är klart här. Går ordern inte att läsa om svarar vi ändå med utfallet, och klienten hämtar
        // ordern själv: ett 500 hade sagt "kunde inte bytas" om något som lyckats.
        const { data, error } = await getCrmWorkOrder(session, workOrderId);
        if (error) console.error('[kundbyte] ordern gick inte att läsa om efter bytet', { workOrderId, error: error.message });
        return ok({ item: error ? null : data, in_fortnox: result.inFortnox, fortnox_error: result.fortnoxError });
      }
    }
  } catch (e: unknown) {
    return routeError(500, 'work_order_customer_unexpected', e instanceof Error ? e.message : 'Kunden kunde inte bytas');
  }
}
