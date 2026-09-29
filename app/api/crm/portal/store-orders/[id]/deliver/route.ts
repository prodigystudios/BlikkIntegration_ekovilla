import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { markStoreOrderDelivered } from '@/lib/domains/portal/storeOrderFulfilment';
import { formatStoreOrderDay } from '@/lib/domains/portal/storeOrders';
import { isoDayNumber, isoFromDayNumber } from '@/lib/domains/planning/timezone';
import { ok, routeError, validationError } from '../../../../_shared';
import { STORE_ORDER_BUSY_MESSAGE, requireStoreOrderManager, storeOrderFortnoxErrorResponse } from '../../_manage';

type RouteContext = { params: { id: string } };

// Levererad (RESELLER_PORTAL_CRM_PLAN.md fas 8b2): varorna har kommit fram till butiken, den dag säljaren anger (från
// dagen beställningen kom in till och med i dag). Bara när Fortnox-ordern finns och inte är makulerad i Fortnox. Går inte
// att ångra; butiken får den i 8b3.
//
//   200 { delivered_on }
//   400 validation_error
//   400 store_order_delivered_on_out_of_range   före dagen beställningen kom in, eller i framtiden
//   403 store_order_forbidden                   varken ansvarig eller admin
//   404 store_order_not_found
//   409 store_order_not_confirmed               inte bekräftad, eller redan levererad eller makulerad
//   409 store_order_fortnox_order_missing       Fortnox-ordern finns inte än
//   409 store_order_fortnox_order_cancelled     Fortnox-ordern är makulerad i Fortnox
//   409 store_order_busy                        en makulering eller en push arbetar mot Fortnox-ordern just nu
//   409 fortnox_not_connected
//   502 store_order_fortnox_failed              Fortnox svarade inte på läsningen av ordern

export const dynamic = 'force-dynamic';
// Läsningen av Fortnox-ordern, med upp till ~23 s väntan vid 429.
export const maxDuration = 60;

// En riktig kalenderdag: 2026-02-30 läses som 2 mars, och då stämmer den inte tillbaka.
const day = z.string().refine((value) => {
  const n = isoDayNumber(value);
  return n !== null && isoFromDayNumber(n) === value;
}, 'Ange leveransdagen.');

const bodySchema = z.object({ deliveredOn: day });

export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requireStoreOrderManager(context.params.id);
    if (gate.response) return gate.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const result = await markStoreOrderDelivered(getSupabaseAdmin(), {
      id: context.params.id,
      deliveredOn: parsed.data.deliveredOn,
      actor: { id: gate.userId },
    });
    switch (result.kind) {
      case 'delivered':
        return ok({ delivered_on: parsed.data.deliveredOn });
      case 'not_found':
        return routeError(404, 'store_order_not_found', 'Beställningen hittades inte.');
      case 'not_confirmed':
        return routeError(409, 'store_order_not_confirmed', 'Bara en bekräftad beställning kan markeras som levererad. Den är redan levererad, eller makulerad.');
      case 'fortnox_order_missing':
        return routeError(409, 'store_order_fortnox_order_missing', 'Fortnox-ordern finns inte än. Skicka beställningen till Fortnox först.');
      case 'busy':
        return routeError(409, 'store_order_busy', STORE_ORDER_BUSY_MESSAGE);
      case 'fortnox_order_cancelled':
        return routeError(
          409,
          'store_order_fortnox_order_cancelled',
          `Fortnox-order ${result.orderNumber} är makulerad i Fortnox, så beställningen kan inte markeras som levererad.`,
        );
      case 'date_out_of_range':
        return routeError(
          400,
          'store_order_delivered_on_out_of_range',
          `Leveransdagen kan vara från ${formatStoreOrderDay(result.min)}, då beställningen kom in, till och med i dag.`,
        );
    }
  } catch (e) {
    const fortnox = storeOrderFortnoxErrorResponse(e);
    console.error('[portal-store-orders] leveransen kunde inte sparas', { id: context.params.id, error: e instanceof Error ? e.message : String(e) });
    return fortnox ?? routeError(500, 'store_order_deliver_failed', 'Leveransen kunde inte sparas.');
  }
}
