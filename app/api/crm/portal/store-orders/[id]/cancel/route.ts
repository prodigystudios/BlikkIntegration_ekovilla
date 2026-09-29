import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { cancelStoreOrder } from '@/lib/domains/portal/storeOrderFulfilment';
import { STORE_ORDER_CANCEL_REASON_MAX } from '@/lib/domains/portal/storeOrders';
import { ok, routeError, validationError } from '../../../../_shared';
import { STORE_ORDER_BUSY_MESSAGE, requireStoreOrderManager, storeOrderFortnoxErrorResponse } from '../../_manage';

type RouteContext = { params: { id: string } };

// Makulera en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b2): bara före Levererad, med ett skäl som butiken ser.
// Fortnox-ordern makuleras först; går det inte makuleras ingenting här.
//
//   200 { fortnox_order_numbers }                 makulerad; Fortnox-ordrarna som makulerades
//   400 validation_error
//   403 store_order_forbidden                     varken ansvarig eller admin
//   404 store_order_not_found
//   409 store_order_not_cancellable               levererad, fakturerad, tillbakadragen eller redan makulerad
//   409 store_order_changed                       butiken ändrade den, eller någon bekräftade den, sedan sidan lästes
//   409 store_order_busy                          en push, Levererad eller en annan makulering arbetar mot Fortnox-
//                                                 ordern just nu: försök igen om en stund
//   409 store_order_fortnox_order_invoiced        Fortnox-ordern är redan fakturerad i Fortnox
//   409 fortnox_not_connected
//   502 store_order_fortnox_failed                Fortnox nekade, med Fortnox text
//   500 store_order_cancel_failed

export const dynamic = 'force-dynamic';
// Sökningen och makuleringen mot Fortnox, var och en med upp till ~23 s väntan vid 429.
export const maxDuration = 120;

const NUL = String.fromCharCode(0);

// Det säljaren såg: statusen och butikens version. Skälet går till butiken (portalen tar högst 2000 tecken).
const bodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Skriv skälet till butiken.')
    .max(STORE_ORDER_CANCEL_REASON_MAX, `Högst ${STORE_ORDER_CANCEL_REASON_MAX} tecken.`)
    .refine((text) => !text.includes(NUL), 'Skälet innehåller ett tecken som inte går att spara.'),
  status: z.enum(['received', 'confirmed']),
  version: z.number().int().min(1),
});

export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requireStoreOrderManager(context.params.id);
    if (gate.response) return gate.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const result = await cancelStoreOrder(getSupabaseAdmin(), {
      id: context.params.id,
      reason: parsed.data.reason,
      expected: { status: parsed.data.status, version: parsed.data.version },
      actor: { id: gate.userId },
    });
    switch (result.kind) {
      case 'cancelled':
        return ok({ fortnox_order_numbers: result.fortnoxOrderNumbers });
      case 'not_found':
        return routeError(404, 'store_order_not_found', 'Beställningen hittades inte.');
      case 'not_cancellable':
        return routeError(409, 'store_order_not_cancellable', 'Beställningen kan inte makuleras: den är levererad, fakturerad, tillbakadragen eller redan makulerad.');
      case 'changed':
        return routeError(409, 'store_order_changed', 'Beställningen har ändrats sedan du öppnade den. Läs igenom den igen innan du makulerar.');
      case 'busy':
        return routeError(409, 'store_order_busy', STORE_ORDER_BUSY_MESSAGE);
      case 'fortnox_order_invoiced':
        return routeError(
          409,
          'store_order_fortnox_order_invoiced',
          `Fortnox-order ${result.orderNumber} är redan fakturerad (faktura ${result.invoiceNumber}) och kan inte makuleras.`,
        );
    }
  } catch (e) {
    const fortnox = storeOrderFortnoxErrorResponse(e);
    console.error('[portal-store-orders] beställningen kunde inte makuleras', { id: context.params.id, error: e instanceof Error ? e.message : String(e) });
    return fortnox ?? routeError(500, 'store_order_cancel_failed', 'Beställningen kunde inte makuleras.');
  }
}
