import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCrmWorkOrder, writeOffWorkOrderLineItem } from '@/lib/domains/crm/work-orders';
import { updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { ok, requirePermission, routeError, workOrderWriteOffSchema, validationError, invalidUuidParam } from '../../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Avskriv (eller återställ) en enskild artikelrad — den som såldes men aldrig utfördes.
//
// Egen route, inte en del av line-items-PATCHen, med flit: den PATCHen är LÅST från första
// delfakturan och ska förbli det. Att byta antal eller ordning på rader efter en utställd faktura
// får aldrig gå, eftersom varje rundas antal är sparade mot arrayindex. Avskrivningen rör inte
// ordningen och tar inte bort något — den sätter en flagga — så den är säker i just det läget,
// och det är i det läget den behövs: annars kan en order med en outförd artikel aldrig stängas.
export async function POST(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.workorder.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = workOrderWriteOffSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const result = await writeOffWorkOrderLineItem(
      supabase,
      context.params.id,
      parsed.data.index,
      parsed.data.written_off,
    );

    if (result.error) {
      const status = result.reason === 'not_found' ? 404
        : result.reason === 'line_not_found' ? 400
        : result.reason === 'already_invoiced' || result.reason === 'order_closed' ? 409
        : 500;
      return routeError(status, `crm_work_order_write_off_${result.reason}`, result.error.message);
    }

    // Spegla till Fortnox-ordern så dokumentets summa följer verkligheten. Icke-fatalt, samma
    // mönster som artikelredigeringen: sparningen har redan lyckats.
    let fortnoxError: string | null = null;
    try {
      await updateWorkOrderInFortnox(context.params.id);
    } catch (e) {
      if (!(e instanceof FortnoxNotConnectedError)) {
        fortnoxError = friendlyFortnoxMessage(e);
        console.error('[fortnox] Avskrivning av orderrad kunde inte synkas:', (e as Error)?.message);
      }
    }

    const fresh = await getCrmWorkOrder(supabase, context.params.id);
    return ok({ item: fresh.data ?? null, fortnox_error: fortnoxError });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_write_off_unexpected', e?.message || 'Failed to write off line item');
  }
}
