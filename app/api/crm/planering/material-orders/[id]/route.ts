import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { expectedStatusesForOrders, getOrder } from '@/lib/domains/planning/materialOrdersStore';
import { discardDraft, updateDraft, warningsForOrder } from '@/lib/domains/planning/materialOrdersService';
import { describeOrderWarning, orderDeliveryState, warningsFingerprint } from '@/lib/domains/planning/materialOrders';
import { getSupplier } from '@/lib/domains/planning/materialSuppliers';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, materialOrderUpdateSchema } from '../../_lib';
import { composeFailureResponse } from '../_respond';

type RouteContext = { params: { id: string } };

// En materialbeställning: läs, ändra utkastet, eller släng det. planning.depot.manage, sessionsklienten.

export async function GET(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data: order, error } = await getOrder(supabase, context.params.id);
    if (error) return routeError(500, 'material_order_read_failed', error.message);
    if (!order) return routeError(404, 'material_order_not_found', 'Beställningen finns inte');

    let warnings: Awaited<ReturnType<typeof warningsForOrder>> = [];
    if (order.status === 'draft' && order.supplier_id) {
      const supplier = await getSupplier(supabase, order.supplier_id);
      if (supplier.data) warnings = await warningsForOrder(supabase, order, supplier.data, stockholmTodayISO());
    }
    let delivery_state = null;
    if (order.status === 'sent') {
      const statuses = await expectedStatusesForOrders(supabase, [order.id]);
      delivery_state = orderDeliveryState(statuses.data.get(order.id) ?? []);
    }
    return ok({
      order,
      warnings: warnings.map((w) => ({ ...w, text: describeOrderWarning(w) })),
      warnings_fingerprint: warningsFingerprint(warnings),
      delivery_state,
    });
  } catch (e: any) {
    return routeError(500, 'material_order_read_unexpected', e?.message || 'Failed to read material order');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response || !gate.currentUser) return gate.response;
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = materialOrderUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const today = stockholmTodayISO();
    const result = await updateDraft(supabase, {
      orderId: context.params.id,
      revision: parsed.data.revision,
      lines: parsed.data.lines,
      other_lines: parsed.data.other_lines,
      message: parsed.data.message,
      actorName: gate.currentUser.name ?? null,
      today,
      env: process.env,
    });

    switch (result.kind) {
      case 'updated': {
        const supplier = result.order.supplier_id ? await getSupplier(supabase, result.order.supplier_id) : null;
        const warnings = supplier?.data ? await warningsForOrder(supabase, result.order, supplier.data, today) : [];
        return ok({
          order: result.order,
          warnings: warnings.map((w) => ({ ...w, text: describeOrderWarning(w) })),
          warnings_fingerprint: warningsFingerprint(warnings),
        });
      }
      case 'not_found':
        return routeError(404, 'material_order_not_found', 'Beställningen finns inte');
      case 'not_draft':
        return routeError(409, 'material_order_not_draft', 'Beställningen skickas eller är skickad och kan inte ändras');
      case 'revision_changed':
        return routeError(409, 'material_order_revision_changed', 'Någon annan har ändrat beställningen — läs om den', { order: result.order });
      default:
        return composeFailureResponse(result);
    }
  } catch (e: any) {
    return routeError(500, 'material_order_update_unexpected', e?.message || 'Failed to update material order');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;
    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const result = await discardDraft(supabase, context.params.id);
    if (result.kind === 'db_error') return routeError(500, 'material_order_delete_failed', result.message);
    // Noll rader: skickas, skickad, redan slängd eller osynlig. Tigande hade lästs som "slängd".
    if (result.kind === 'not_draft') return routeError(409, 'material_order_not_draft', 'Bara ett utkast kan slängas');
    return ok({ ok: true });
  } catch (e: any) {
    return routeError(500, 'material_order_delete_unexpected', e?.message || 'Failed to delete material order');
  }
}
