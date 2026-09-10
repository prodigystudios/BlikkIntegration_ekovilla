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
// ⚠️ Systerrutten ../customer-contact bygger fortfarande på den ÄLDRE modellen ("inloggad + har
// länken", UUID:t som capability). Den kommentaren skrevs i juni, innan crew-policyn fanns i
// augusti — kopiera inte upplägget hit tillbaka.
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isReadonlyRole } from '@/lib/auth/route';
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

    // ⚠️ Denna grind finns INTE i customer-contact intill. Det är inte en avvikelse att
    // harmonisera bort åt andra hållet: varje annan [id]-route här har den, och utan den når ett
    // icke-UUID PostgREST och kommer tillbaka som en rå 500 med "invalid input syntax for type
    // uuid" i klartext. 400 är rätt svar på ett trasigt id.
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const session = createRouteHandlerClient({ cookies });

    // ⛔ DE EXTERNA ROLLERNA FÅR INTE PERSONALENS NUMMER. `konsult` håller `crm.workorder.read`,
    // alltså skulle RLS-grinden nedan släppa igenom hen på varje order. Numret som faller ut är
    // personalens eget, ur `profiles` — och det delas i dag bara via Kontaktlistan, en KURERAD
    // tabell där administrationen valt vad som publiceras. `listAssignableCrmUsers`, kontorets
    // egen personallista, väljer också medvetet bort telefonen (`id, full_name, role`).
    //
    // ⚠️ `isReadonlyRole` OCH INTE EN LITERAL `=== 'konsult'`. Listan bär också `ekonomi`
    // (lönebyrån, likaså extern) och legacy `readonly`. Ekonomi når ingen arbetsorder i dag — hon
    // har bara `time.*`-nycklar, så RLS stoppar henne — men hennes yta har vidgats flera gånger,
    // och den dagen hon når en order ska hon inte plötsligt få personalens privata mobilnummer på
    // köpet. Grinden ska inte behöva ändras igen för att en rolldefinition rörde sig.
    //
    // Beslutet är Williams och gällde "de anställda" (2026-09-09). En extern part faller utanför
    // det, och konsulten arbetar i CRM, inte i fält — kortet finns bara i fältvyn.
    //
    // 🧨 EGEN LÄSNING, INTE `currentUser.role` — den grinden failade OPEN. `getCurrentUser()`
    // kastar sitt profiles-läsfel (lib/auth/route.ts: `const { data: profile }`, ingen error) och
    // svarar `role || 'member'`, så en misslyckad rolluppslagning hade sett ut som en installatör
    // och släppt konsulten förbi — medan RLS fortsatte att admittera hen. Här är ett läsfel i
    // stället ett nej. Läsningen är self-read och går under `profiles_select_self`, alltså den
    // enda profilfråga som alltid får svara.
    //
    // ⚠️ EN ROLLGRIND, alltså precis det lager RBAC-arbetet river (se project_full_rbac_frontend).
    // Den står här tills det finns en nyckel att fråga efter i stället; byt till nyckeln då,
    // ta inte bort grinden.
    // Grinden kräver ett POSITIVT bevis: en läst, intern roll. Läsfel OCH saknad profilrad är båda
    // "obevisad", alltså nej — nekade grinden bara på en igenkänd extern roll vore varje utfall som
    // inte råkade matcha ett ja, inklusive tomma svar.
    const { data: reader, error: readerError } = await session
      .from('profiles').select('role').eq('id', currentUser.currentUser!.id).maybeSingle();
    const readerRole = (reader as { role?: string } | null)?.role ?? null;
    if (readerError || !readerRole || isReadonlyRole(readerRole)) {
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
