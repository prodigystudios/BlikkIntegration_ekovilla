import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { setStoreOrderFreight } from '@/lib/domains/portal/storeOrderActions';
import { isWholeOre } from '@/lib/domains/portal/storeOrderIntake';
import { ok, routeError, validationError } from '../../../../_shared';
import { requireStoreOrderManager } from '../../_manage';

type RouteContext = { params: { id: string } };

// Frakten på en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8b): artikel 1050 FRAKT med säljarens pris, eller
// "Ingen frakt". Bekräftelsen kräver det ena eller det andra. Bara medan beställningen är mottagen.
//
//   200 { saved: true }
//   400 validation_error
//   403 store_order_forbidden      varken ansvarig eller admin
//   404 store_order_not_found
//   409 store_order_not_received   bekräftad, tillbakadragen eller makulerad
//   409 store_order_freight_changed någon annan sparade frakten sedan sidan lästes; ingenting sparat

export const dynamic = 'force-dynamic';
// Next 14.2 räknar inte PUT som dynamisk och cachar då varje fetch, också Supabase-klientens.
export const fetchCache = 'force-no-store';

// `expectedSetAt`: när frakten säljaren såg sparades (null = inte satt). En annans nyare frakt skrivs inte över.
const expectedSetAt = z.string().datetime({ offset: true }).nullable();

const bodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none'), expectedSetAt }),
  z.object({
    mode: z.literal('charged'),
    expectedSetAt,
    price: z
      .number({ invalid_type_error: 'Ange fraktens pris.' })
      .positive('Priset måste vara större än noll.')
      .max(1_000_000, 'Högst 1000000 kr.')
      .refine(isWholeOre, 'Högst två decimaler.'),
  }),
]);

export async function PUT(req: Request, context: RouteContext) {
  try {
    const gate = await requireStoreOrderManager(context.params.id);
    if (gate.response) return gate.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const { expectedSetAt: seen, ...freight } = parsed.data;
    const result = await setStoreOrderFreight(getSupabaseAdmin(), context.params.id, freight, { id: gate.userId }, seen);
    if (result.kind === 'not_found') return routeError(404, 'store_order_not_found', 'Beställningen hittades inte.');
    if (result.kind === 'freight_changed') {
      return routeError(409, 'store_order_freight_changed', 'Någon annan har ändrat frakten sedan du öppnade beställningen. Läs igenom den igen.');
    }
    if (result.kind === 'not_received') {
      return routeError(409, 'store_order_not_received', 'Frakten kan bara ändras innan beställningen är bekräftad.');
    }
    return ok({ saved: true });
  } catch (e) {
    console.error('[portal-store-orders] frakten kunde inte sparas', { id: context.params.id, error: e instanceof Error ? e.message : String(e) });
    return routeError(500, 'store_order_freight_failed', 'Frakten kunde inte sparas.');
  }
}
