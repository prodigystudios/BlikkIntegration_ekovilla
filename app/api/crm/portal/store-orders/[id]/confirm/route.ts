import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { confirmStoreOrder } from '@/lib/domains/portal/storeOrderActions';
import type { StoreOrderConfirmBlocker } from '@/lib/domains/portal/storeOrderFortnox';
import { ok, routeError, validationError } from '../../../../_shared';
import { requireStoreOrderManager } from '../../_manage';

type RouteContext = { params: { id: string } };

// Bekräfta en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b): versionen säljaren såg låses för butiken, och
// Fortnox-ordern skapas (25 %). Går Fortnox inte är beställningen ändå bekräftad, och nya försök görs (5 min, 15 min,
// 1 h, i 24 h), eller med "Skicka till Fortnox".
//
//   200 { fortnox_order_number, fortnox_error }   bekräftad; fortnox_error när ordern inte kunde skapas än
//   400 validation_error
//   403 store_order_forbidden                     varken ansvarig eller admin
//   404 store_order_not_found
//   409 store_order_not_received                  redan bekräftad, tillbakadragen eller makulerad
//   409 store_order_changed                       butiken ändrade den efter att sidan lästes: läs om
//   409 store_order_freight_missing               frakten, eller "Ingen frakt", är inte satt
//   409 store_order_customer_missing              ingen kund kopplad
//   409 store_order_customer_not_in_fortnox       kundkortet har inget kundnummer i Fortnox

export const dynamic = 'force-dynamic';
// Ett Fortnox-anrop, och registret före det.
export const maxDuration = 60;

const bodySchema = z.object({
  version: z.number().int().min(1),
});

const BLOCKED: Record<StoreOrderConfirmBlocker, [code: string, message: string]> = {
  not_received: ['store_order_not_received', 'Beställningen är inte längre ny: den är redan bekräftad, tillbakadragen eller makulerad.'],
  changed: ['store_order_changed', 'Butiken har ändrat beställningen sedan du öppnade den. Läs igenom den igen innan du bekräftar.'],
  freight_missing: ['store_order_freight_missing', 'Sätt frakten, eller välj Ingen frakt, innan beställningen bekräftas.'],
  customer_missing: ['store_order_customer_missing', 'Koppla butikens kundkort innan beställningen bekräftas.'],
  customer_not_in_fortnox: ['store_order_customer_not_in_fortnox', 'Kundkortet har inget kundnummer i Fortnox. Skicka kortet till Fortnox först.'],
};

export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requireStoreOrderManager(context.params.id);
    if (gate.response) return gate.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const result = await confirmStoreOrder(getSupabaseAdmin(), {
      id: context.params.id,
      expectedVersion: parsed.data.version,
      actor: { id: gate.userId },
    });
    if (result.kind === 'not_found') return routeError(404, 'store_order_not_found', 'Beställningen hittades inte.');
    if (result.kind === 'blocked') {
      const [code, message] = BLOCKED[result.reason];
      return routeError(409, code, message);
    }
    return ok({ fortnox_order_number: result.push.fortnoxOrderNumber, fortnox_error: result.push.error });
  } catch (e) {
    console.error('[portal-store-orders] beställningen kunde inte bekräftas', { id: context.params.id, error: e instanceof Error ? e.message : String(e) });
    return routeError(500, 'store_order_confirm_failed', 'Beställningen kunde inte bekräftas.');
  }
}
