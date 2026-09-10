import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { listAllSuppliers, createSupplier } from '@/lib/domains/planning/materialSuppliers';
import { ok, routeError, validationError, requirePermission, createSupplierSchema } from '../_lib';

// Leverantörsregistret — vem materialet beställs från.
//
// ⚠️ INGEN logActivity HÄR, till skillnad från expected-deliveries bredvid. Två skäl, och det andra
// är det bindande:
//
//   • Systerregistren (depots, trucks, job-types) loggar inte heller. Aktivitetsloggen är till för
//     SCHEMAÄNDRINGAR — vem flyttade vilket jobb — inte för registervård.
//   • ops_activity_events läses med planning.schedule.read (activity/route.ts:10), som `konsult`
//     håller. En sammanfattning i stil med "La upp leverantören X" hade alltså lagt tillbaka exakt
//     det RLS på den här tabellen precis höll inne. Loggen är en andra läsväg till samma uppgift.
//
// Skulle beställningarna någon gång behöva ett spår är det ORDERRADEN som är sanningen (logActivity
// sväljer sina fel och returnerar void) — inte en logg med bredare läsekrets än registret.

// Hela registret, inaktiva inkluderade (panelen ska kunna visa och återaktivera dem).
//
// 🧨 planning.depot.manage, INTE planning.schedule.read. Frestelsen är att spegla depots-routen
// bredvid, som läser på board-nivå — men raden bär fabrikens mailadress och kontaktperson, och
// rollen `konsult` håller schedule.read. "Administrera"-knappen i planeringen har dessutom ingen
// egen grind. Med board-nivå hade varje konsult kunnat läsa registret. Samma nyckel som RLS
// kräver, så routen och databasen säger samma sak.
export async function GET() {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listAllSuppliers(supabase);
    if (error) return routeError(500, 'planning_suppliers_list_failed', error.message);

    return ok({ suppliers: data });
  } catch (e: any) {
    return routeError(500, 'planning_suppliers_list_unexpected', e?.message || 'Failed to list suppliers');
  }
}

// Lägg upp en leverantör.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = createSupplierSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await createSupplier(supabase, {
      name: parsed.data.name,
      email: parsed.data.email,
      contactName: parsed.data.contact_name ?? null,
      phone: parsed.data.phone ?? null,
      materials: parsed.data.materials,
      leadTimeDays: parsed.data.lead_time_days,
      roundUpTo: parsed.data.round_up_to,
      note: parsed.data.note ?? null,
      actorUserId: gate.currentUser.id,
    });
    if (error) {
      // Unikt index på namnet bland AKTIVA leverantörer. Två rader med samma namn och olika
      // adresser är ett val mellan två fabriker som ser identiska ut i mottagarväljaren — säg det
      // på svenska i stället för att skicka vidare "duplicate key value violates unique
      // constraint".
      if ((error as { code?: string }).code === '23505') {
        return routeError(
          409,
          'planning_supplier_duplicate_name',
          'Det finns redan en aktiv leverantör med det namnet. Två med samma namn går inte att skilja åt när mottagaren väljs.',
        );
      }
      return routeError(500, 'planning_supplier_create_failed', error.message);
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'planning_supplier_create_unexpected', e?.message || 'Failed to create supplier');
  }
}
