import { createSessionClient } from '@/lib/supabase/session';
// Vem på kontoret som äger arbetsordern — namn + telefon, för fältvyns "ansvarig säljare"-kort.
//
// ACCESS MODEL: RLS ÄR GRINDEN, och den frågas med SESSIONSKLIENTEN. Läsaren måste kunna se
// arbetsordern under sin egen RLS för att få veta något om den ansvarige: besättningen via
// `crm_work_orders_select_crew` (20260810_crm_work_order_crew_access.sql, härlett ur planeringens
// besättningstabeller), kontoret via `crm.workorder.read`. Ingen egen behörighetsregel här — den
// hade blivit en andra kopia att hålla i synk med den som redan finns i databasen.
//
// 🧨 DEN ELEVERADE LÄSNINGEN GÄLLER BARA `profiles`-RADEN, och sker först efter att ordern släppt
// igenom. `profiles` är self-read-only (`profiles_select_self`, auth_roles_setup.sql:71), så
// namnet på någon ANNAN kräver service-role — men eleveras BÅDA läsningarna blir routen en läcka:
// säljarens namn och privata mobilnummer hade då besvarats för vilket order-UUID som helst, åt
// vilket inloggat konto som helst. Och "inloggad" är inte "anställd": `/auth/create-account` delar
// ut `role='member'` åt vem som helst.
//
// Systerrutten ../customer-contact följer samma modell sedan 2026-09-26 (förr: "inloggad + har
// länken", UUID:t som capability — skrivet i juni, innan crew-policyn fanns).
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getWorkOrderAssigneeContact } from '@/lib/domains/crm/work-orders';
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

    // Varje [id]-route här har den: utan den når ett icke-UUID PostgREST och kommer tillbaka som en
    // rå 500 med "invalid input syntax for type uuid" i klartext. 400 är rätt svar på ett trasigt id.
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const session = createSessionClient();

    // ⛔ DE EXTERNA PARTERNA FÅR INTE PERSONALENS NUMMER. `konsult` håller `crm.workorder.read`,
    // alltså skulle RLS-grinden nedan släppa igenom hen på varje order. Numret som faller ut är
    // personalens eget, ur `profiles` — och det delas i dag bara via Kontaktlistan, en KURERAD
    // tabell där administrationen valt vad som publiceras. Beslutet är Williams och gällde "de
    // anställda" (2026-09-09); konsulten arbetar i CRM, inte i fält — kortet finns bara i fältvyn.
    //
    // Grinden är nyckeln app.staff (intern personal: member, sales, admin), inte en rollista. Den
    // failar STÄNGT: ett fel i effective_permissions ger en tom mängd och inget nummer. (Förr en egen
    // profilläsning + isReadonlyRole — skälet var att getCurrentUser() failar ÖPPET på rollen och
    // hade gjort en konsult med trasig profilläsning till 'member'. Nyckeln har inte det problemet.)
    const permissions = await getEffectivePermissions();
    if (!permissions.has('app.staff')) {
      return ok({ contact: null });
    }

    const { data, error } = await getWorkOrderAssigneeContact(
      session,
      getSupabaseAdmin(),
      context.params.id,
    );
    if (error) return routeError(500, 'crm_work_order_assignee_failed', error.message);

    return ok({ contact: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_assignee_unexpected', e?.message || 'Failed to load assignee contact');
  }
}
