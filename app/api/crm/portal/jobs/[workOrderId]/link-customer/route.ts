import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { workOrderReadinessErrorCode } from '@/lib/domains/crm/workOrderReadiness';
import { linkPortalJobCustomer } from '@/lib/domains/portal/linkCustomer';
import { invalidUuidParam, ok, requirePermission, routeError, validationError } from '../../../../_shared';

type RouteContext = { params: { workOrderId: string } };

const bodySchema = z.object({
  customer_id: z.string().uuid('Välj butikens kundkort i listan'),
});

// Koppla butikens kundkort på en portalorder utan kund, och skapa Fortnox-ordern (RESELLER_PORTAL_CRM_PLAN.md fas 3c).
//
// crm.workorder.write, och sedan RLS på arbetsordern: bara den som har ordern, eller en admin, får ändra den. Kortet
// prövas med samma kontroll som våra egna ordrar innan något sparas; saknas något svarar routen 409 med listan.
// Jobbets och butikens rader skrivs med service-rollen, efter att sessionen fått ändra ordern. Se "Reviewed
// elevations" i SUPABASE_CONVENTIONS.md.
//
//   200 { item, fortnox_order_number, fortnox_error, store_linked }  kopplad; fortnox_error när Fortnox-ordern inte
//                                                                    kunde skapas (kunden är ändå kopplad); item null
//                                                                    om ordern inte gick att läsa om efteråt
//   403 portal_link_forbidden        varken ansvarig för ordern eller admin
//   409 portal_job_changed           ordern sparades av någon annan under tiden; ingenting sparat, försök igen
//   404 crm_work_order_not_found     ingen portalorder som du ser
//   404 crm_customer_not_found       kundkortet finns inte
//   409 portal_job_already_linked    ordern har redan en kund
//   409 portal_job_in_fortnox        ordern finns redan i Fortnox
//   409 crm_work_order_incomplete …  kortet saknar något (details.blockers)
//   422 portal_customer_not_business ett privatkundskort: butiken är ett företag
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.workOrderId);
    if (badId) return badId;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const session = createSessionClient();
    const workOrderId = context.params.workOrderId;
    const result = await linkPortalJobCustomer(session, getSupabaseAdmin(), {
      workOrderId,
      customerId: parsed.data.customer_id,
      actorId: gate.currentUser.id,
    });

    switch (result.kind) {
      case 'not_found':
        return routeError(404, 'crm_work_order_not_found', 'Portalordern hittades inte.');
      case 'already_linked':
        return routeError(409, 'portal_job_already_linked', 'Ordern har redan en kund.');
      case 'in_fortnox':
        return routeError(409, 'portal_job_in_fortnox', 'Ordern finns redan i Fortnox.');
      case 'customer_not_found':
        return routeError(404, 'crm_customer_not_found', 'Kundkortet hittades inte.');
      case 'not_business':
        return routeError(422, 'portal_customer_not_business', 'Välj butikens kundkort. Butiken är ett företag, inte en privatkund.');
      case 'incomplete':
        return routeError(409, workOrderReadinessErrorCode(result.blockers), result.blockers[0]?.message || 'Kundkortet saknar uppgifter.', {
          blockers: result.blockers,
        });
      case 'forbidden':
        return routeError(403, 'portal_link_forbidden', 'Bara den som har ordern, eller en admin, kan koppla kunden.');
      case 'changed':
        return routeError(409, 'portal_job_changed', 'Ordern sparades av någon annan under tiden. Försök igen.');
      case 'linked': {
        // Kopplingen och Fortnox-ordern är klara här. Går ordern inte att läsa om svarar vi ändå med utfallet, och
        // klienten hämtar ordern själv: ett 500 hade sagt "kunde inte kopplas" om något som lyckats.
        const { data, error } = await getCrmWorkOrder(session, workOrderId);
        if (error) console.error('[portal-link] ordern gick inte att läsa om efter kopplingen', { workOrderId, error: error.message });
        return ok({
          item: error ? null : data,
          fortnox_order_number: result.fortnoxOrderNumber,
          fortnox_error: result.fortnoxError,
          store_linked: result.storeLinked,
        });
      }
    }
  } catch (e: unknown) {
    return routeError(500, 'portal_link_unexpected', e instanceof Error ? e.message : 'Kunden kunde inte kopplas');
  }
}
