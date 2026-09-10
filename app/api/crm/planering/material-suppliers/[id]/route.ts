import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { updateSupplier, deleteSupplier } from '@/lib/domains/planning/materialSuppliers';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, updateSupplierSchema } from '../../_lib';

// Ingen logActivity här — se noten i ../route.ts: loggen läses med planning.schedule.read och vore
// en andra läsväg förbi RLS på registret.

type RouteContext = {
  params: {
    id: string;
  };
};

// Ändra en leverantör — adress, material, ledtid, eller avaktivera den.
//
// Samma nyckel som att lägga upp den: vem vi handlar av är ett inköpsbeslut hela vägen.
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = updateSupplierSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await updateSupplier(supabase, context.params.id, {
      name: parsed.data.name,
      email: parsed.data.email,
      contactName: parsed.data.contact_name,
      phone: parsed.data.phone,
      materials: parsed.data.materials,
      leadTimeDays: parsed.data.lead_time_days,
      note: parsed.data.note,
      active: parsed.data.active,
    });
    if (error) {
      // Att aktivera en leverantör vars namn redan bärs av en aktiv rad landar här, inte bara en
      // omdöpning.
      if ((error as { code?: string }).code === '23505') {
        return routeError(
          409,
          'planning_supplier_duplicate_name',
          'Det finns redan en aktiv leverantör med det namnet. Två med samma namn går inte att skilja åt när mottagaren väljs.',
        );
      }
      return routeError(500, 'planning_supplier_update_failed', error.message);
    }
    // ⚠️ Noll matchande rader svarar `error: null` i PostgREST — raden kan vara borttagen eller
    // osynlig bakom RLS. Tigande hade lästs som "sparat", och panelen visat kvar det som skrevs in.
    if (!data) return routeError(404, 'planning_supplier_not_found', 'Leverantören finns inte längre');

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'planning_supplier_update_unexpected', e?.message || 'Failed to update supplier');
  }
}

// Ta bort en leverantör.
//
// Avveckling ska normalt ske genom avaktivering (`active = false`) — den vägen behåller namnet i
// registret. Radering är kvar för en rad som lagts upp av misstag. När beställningarna landar får
// deras supplier_id `on delete set null` plus en snapshottad supplier_name, så en radering inte
// skriver om vad en skickad beställning påstår sig ha gått till.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteSupplier(supabase, context.params.id);
    if (error) return routeError(500, 'planning_supplier_delete_failed', error.message);
    // Samma tautologi som ovan: en DELETE som inte träffade någon rad svarar `error: null`.
    if (!data) return routeError(404, 'planning_supplier_not_found', 'Leverantören finns inte längre');

    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'planning_supplier_delete_unexpected', e?.message || 'Failed to delete supplier');
  }
}
