// Kundens kontakt på arbetsordern — namn, telefon, e-post — för fältvyn och orderns sida i CRM.
//
// ACCESS MODEL: RLS ÄR GRINDEN, och den frågas med SESSIONSKLIENTEN — samma modell som systern
// ../assignee-contact. Läsaren måste kunna se arbetsordern under sin egen RLS: besättningen via
// crew-policyn (20260810_crm_work_order_crew_access.sql), kontoret via `crm.workorder.read`. Först
// därefter läses kontakten med service-role, eftersom besättningen inte har läsrätt på crm_customers.
//
// 🧨 Förr: "inloggad + har UUID:t" (modellen från juni, före crew-policyn). Varje inloggat konto som
// fick tag i ett order-UUID fick kundens namn, telefon och e-post — även ett konto som fick 404 på
// själva ordern. Fältvyn läser redan ordern med sessionen och 404:ar för den som inte får se den, så
// för en legitim visning ändras ingenting. Eleveras båda läsningarna igen är routen en läcka.
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getWorkOrderCustomerContact, isWorkOrderReadable } from '@/lib/domains/crm/work-orders';
import { invalidUuidParam, ok, requireSignedInUser, routeError } from '../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const { data: readable, error: readError } = await isWorkOrderReadable(createSessionClient(), context.params.id);
    if (readError) return routeError(500, 'crm_work_order_contact_failed', readError.message);
    // Samma svar som en order utan kontakt: kortet uteblir. Inget som skiljer "finns inte" från
    // "får inte se".
    if (!readable) return ok({ contact: null });

    const { data, error } = await getWorkOrderCustomerContact(getSupabaseAdmin(), context.params.id);
    if (error) return routeError(500, 'crm_work_order_contact_failed', error.message);

    return ok({ contact: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_contact_unexpected', e?.message || 'Failed to load customer contact');
  }
}
