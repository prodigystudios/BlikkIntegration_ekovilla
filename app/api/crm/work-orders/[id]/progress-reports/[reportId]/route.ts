import { createSessionClient } from '@/lib/supabase/session';
import {
  deleteCrmWorkOrderProgressReport,
  getCrmWorkOrderProgressReport,
} from '@/lib/domains/crm/work-orders';
import { invalidUuidParam, ok, requireSignedInUser, routeError } from '../../../_lib';

// Ta bort EN framdriftsrapport.
//
// ── VARFÖR RUTTEN FINNS ──────────────────────────────────────────────────────
// Samma återvändsgränd som säckboken gick i 2026-08-24: en rad kan bara ADDERA (kolumnen har
// `check (quantity >= 0)`), så en dag som rapporterats två gånger i dålig mottagning går inte att
// rätta med en ny rad. Utan den här rutten vore enda vägen en manuell delete i databasen.
//
// ── VEM SOM FÅR, OCH VAR DEN REGELN BOR ──────────────────────────────────────
// Kontoret (crm.workorder.write) och den som SKREV raden, så länge hen fortfarande är besättning på
// jobbet. Routen gatar därför INTE på en behörighet av eget: den läser raden med sessionsklienten
// och låter DELETE:n mötas av RLS, precis som skrivvägen gör. Skrev routen om regeln i TypeScript
// hade den blivit en andra kopia som glider isär från policyn — och den kopian är alltid den som
// svarar 200 där databasen svarar nej.
//
// ⚠️ INGEN MOTSVARIGHET TILL SÄCKRUTTENS 409. Där måste rutten dessutom vägra radera en
// egenkontrollrad, eftersom en borttagen final släpper fram delrapporterna som total igen — en
// borttagning som ser ut att sänka siffran HÖJER den. Den här boken har ingen final och ingen
// supersede: en borttagen rad sänker summan med exakt sitt eget belopp, alltid. Leta inte efter den
// spärren här.
//
// ⚠️ EN DELETE SOM INTE TRÄFFAR NÅGON RAD ÄR INTE ETT FEL. PostgREST svarar `error: null` och noll
// rader, exakt som en lyckad borttagning av något som redan var borta. Därför läses raden tillbaka
// med `.select()` — utan det hade en RLS-nekad borttagning rapporterats som lyckad och kortet tagit
// bort en rad ur listan som ligger kvar i databasen.
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
    reportId: string;
  };
};

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const badId = invalidUuidParam(context.params.id) || invalidUuidParam(context.params.reportId);
    if (badId) return badId;

    const supabase = createSessionClient();

    // Läses först för att kunna skilja "finns inte" från "får inte". Utan den här läsningen blir
    // båda samma noll rader, och användaren får ett besked som inte säger vad hen ska göra i stället.
    const { data: existing, error: readError } = await getCrmWorkOrderProgressReport(
      supabase,
      context.params.reportId,
      context.params.id,
    );
    if (readError) {
      return routeError(500, 'crm_work_order_progress_read_failed', readError.message);
    }
    if (!existing) {
      return routeError(404, 'crm_work_order_progress_not_found', 'Rapporten hittades inte.');
    }

    const { data, error } = await deleteCrmWorkOrderProgressReport(
      supabase,
      context.params.reportId,
      context.params.id,
    );
    if (error) {
      return routeError(500, 'crm_work_order_progress_delete_failed', error.message);
    }
    if (!data) {
      // Raden fanns när vi läste den, men DELETE:n träffade ingenting: RLS nekade (en kollega i
      // besättningen som inte skrev raden), eller så hann någon annan ta bort den emellan.
      return routeError(
        403,
        'crm_work_order_progress_delete_blocked',
        'Rapporten kunde inte tas bort. Det är den som skrev rapporten, eller kontoret, som kan ta bort den.',
      );
    }

    return ok({ id: context.params.reportId });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_progress_delete_unexpected', e?.message || 'Failed to delete progress report');
  }
}
