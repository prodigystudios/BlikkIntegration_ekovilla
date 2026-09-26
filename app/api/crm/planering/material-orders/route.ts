import { createSessionClient } from '@/lib/supabase/session';
import { expectedStatusesForOrders, listOrders } from '@/lib/domains/planning/materialOrdersStore';
import { createDraft, warningsForOrder } from '@/lib/domains/planning/materialOrdersService';
import { describeOrderWarning, orderDeliveryState, warningsFingerprint } from '@/lib/domains/planning/materialOrders';
import { getSupplier } from '@/lib/domains/planning/materialSuppliers';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { ok, routeError, validationError, requirePermission, materialOrderCreateSchema } from '../_lib';
import { composeFailureResponse } from './_respond';

// Materialbeställningar till fabriken.
//
// ⚠️ planning.depot.manage på ALLT, också läsning: raderna bär fabrikens adress och mailets text. Ingen
// logActivity här — loggen läses med schedule.read (konsult har den). Bara utskicket loggas, utan adress.
//
// 🧨 SESSIONSKLIENTEN, aldrig getSupabaseAdmin(): RLS och RPC:erna prövar has_permission på auth.uid().

export async function GET() {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;

    const supabase = createSessionClient();
    const { data, error } = await listOrders(supabase, { sentLimit: 50 });
    if (error) return routeError(500, 'material_orders_list_failed', error.message);

    const sent = data.filter((o) => o.status === 'sent');
    const statuses = await expectedStatusesForOrders(supabase, sent.map((o) => o.id));
    if (statuses.error) return routeError(500, 'material_orders_list_failed', statuses.error.message);

    return ok({
      orders: data.map((o) => ({
        ...o,
        delivery_state: o.status === 'sent' ? orderDeliveryState(statuses.data.get(o.id) ?? []) : null,
      })),
    });
  } catch (e: any) {
    return routeError(500, 'material_orders_list_unexpected', e?.message || 'Failed to list material orders');
  }
}

// Granska: skapa ett utkast med ett renderat mail, och varningarna att ta ställning till.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = materialOrderCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createSessionClient();
    const today = stockholmTodayISO();
    const result = await createDraft(supabase, {
      supplierId: parsed.data.supplier_id,
      lines: parsed.data.lines,
      other_lines: parsed.data.other_lines,
      message: parsed.data.message,
      actor: { id: gate.currentUser.id, name: gate.currentUser.name ?? null },
      today,
      env: process.env,
    });

    if (result.kind === 'open_order_exists') {
      return routeError(
        409,
        'material_order_open_exists',
        `Det finns redan en öppen beställning (#${result.order_no}) till den här leverantören — fortsätt i den`,
        { order_id: result.order_id, order_no: result.order_no, status: result.status },
      );
    }
    if (result.kind !== 'created') return composeFailureResponse(result);

    const supplier = await getSupplier(supabase, parsed.data.supplier_id);
    const warnings = supplier.data ? await warningsForOrder(supabase, result.order, supplier.data, today) : [];
    return ok(
      { order: result.order, warnings: warnings.map((w) => ({ ...w, text: describeOrderWarning(w) })), warnings_fingerprint: warningsFingerprint(warnings) },
      201,
    );
  } catch (e: any) {
    return routeError(500, 'material_order_create_unexpected', e?.message || 'Failed to create material order');
  }
}
