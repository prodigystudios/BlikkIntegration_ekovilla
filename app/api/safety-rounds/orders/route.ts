import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { ok, routeError, validationError } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/guards';
import { resolveJobAddress } from '@/lib/domains/planning/display';
import { orderSearchSchema } from '@/lib/domains/safetyRounds/schemas';
import { lookupSafetyRoundOrders } from '@/lib/domains/safetyRounds/store';

// Sök arbetsorder att starta en skyddsrond på. Går genom safety_round_order_lookup — en smal
// SECURITY DEFINER-funktion gatad på skrivnyckeln — eftersom en rondledare kan sakna både
// crm.workorder.read och plats i besättningen. Svaret bär ordernummer, projekt, kund och den
// upplösta adressen; ingenting annat ur ordern lämnas ut.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const guard = await requirePermission('safety.round.write');
    if (guard.response) return guard.response;

    const parsed = orderSearchSchema.safeParse({ q: new URL(req.url).searchParams.get('q') ?? '' });
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await lookupSafetyRoundOrders(supabase, parsed.data.q);
    if (error) {
      if (error.code === '42501') return routeError(403, 'safety_round_forbidden', 'Du har inte behörighet att starta skyddsronder.');
      return routeError(500, 'safety_round_order_search_failed', error.message);
    }

    return ok({
      items: (data ?? []).map((order) => ({
        id: order.id,
        order_number: order.order_number,
        fortnox_order_number: order.fortnox_order_number,
        project_name: order.project_name,
        client_name: order.client_name,
        address: resolveJobAddress(order.work_address, order.customer_address),
      })),
    });
  } catch (e: unknown) {
    console.error('[safety-rounds] ordersök:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'safety_round_order_search_unexpected', 'Kunde inte söka arbetsordrar.');
  }
}
