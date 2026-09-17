import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { resolveMaterialOrder } from '@/lib/domains/planning/materialOrdersSend';
import { logActivity } from '@/lib/domains/planning/activity';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, materialOrderResolveSchema } from '../../../_lib';

type RouteContext = { params: { id: string } };

// En människas besked om ett oklart utskick: gick mailet fram eller inte? Bara efter 23 h — inom fönstret
// är "Försök igen" (samma nyckel) alltid det säkra, och databasen svarar window_open.
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = materialOrderResolveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const outcome = await resolveMaterialOrder(supabase, context.params.id, parsed.data.delivered);
    switch (outcome.kind) {
      case 'marked_sent':
        await logActivity(supabase, gate.currentUser, {
          action: 'material_order.verify',
          entityType: 'material_order',
          entityId: context.params.id,
          summary: 'Bekräftade att en materialbeställning gick fram',
        });
        return ok({ state: 'sent' });
      case 'released':
        // Det riskablaste beskedet (nästa Skicka får en ny nyckel) — därför loggat, som "gick fram".
        await logActivity(supabase, gate.currentUser, {
          action: 'material_order.not_delivered',
          entityType: 'material_order',
          entityId: context.params.id,
          summary: 'Markerade att en materialbeställning inte gick fram',
        });
        return ok({ state: 'draft' });
      case 'not_found':
        return routeError(404, 'material_order_not_found', 'Beställningen finns inte');
      case 'conflict':
        return routeError(409, `material_order_${outcome.code}`, outcome.message);
      case 'db_error':
        return routeError(500, 'material_order_resolve_failed', outcome.message);
    }
  } catch (e: any) {
    return routeError(500, 'material_order_resolve_unexpected', e?.message || 'Failed to resolve material order');
  }
}
