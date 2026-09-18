import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  countSegmentsForStage,
  deleteCrmWorkOrderStage,
  getCrmWorkOrderLineItems,
  listCrmWorkOrderStages,
  updateCrmWorkOrderStage,
} from '@/lib/domains/crm/work-orders';
import {
  computeStageState,
  StageAllocationError,
  validateStageAllocation,
  type WorkOrderStage,
} from '@/lib/domains/crm/workOrderStages';
import {
  invalidUuidParam,
  ok,
  requirePermission,
  routeError,
  updateWorkOrderStageSchema,
  validationError,
} from '../../../_lib';

// En enskild etapp: ändra eller ta bort.
//
// ── TVÅ KLIENTER, MED FLIT ───────────────────────────────────────────────────
// Placeringarna RÄKNAS eleverat (getSupabaseAdmin): ops_segments kräver planning.schedule.read, och
// RLS gäller för `count` precis som för rader. En kontorsanvändare som bara bär crm.workorder.write
// hade fått tillbaka 0 — inte ett fel — och spärren nedan hade TYSTNAT. Fail-open utan spår.
//
// Själva skrivningen (UPDATE/DELETE) går genom SESSIONSKLIENTEN, så det är RLS som auktoriserar
// den. Byts ordningen — admin på skrivningen — blir routens egna kontroller den enda spärren.
//
// nodejs: admin-klienten använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; stageId: string } };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.write');
    if (gate.response) return gate.response;

    const { id: workOrderId, stageId } = context.params;
    const badOrder = invalidUuidParam(workOrderId);
    if (badOrder) return badOrder;
    const badStage = invalidUuidParam(stageId);
    if (badStage) return badStage;

    const parsed = updateWorkOrderStageSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const patch: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.work_description !== undefined) patch.work_description = parsed.data.work_description;
    if (parsed.data.job_type !== undefined) patch.job_type = parsed.data.job_type;

    if (parsed.data.line_quantities !== undefined) {
      const [stagesRes, orderRes] = await Promise.all([
        listCrmWorkOrderStages(supabase, workOrderId),
        getCrmWorkOrderLineItems(supabase, workOrderId),
      ]);
      if (stagesRes.error) return routeError(500, 'crm_work_order_stages_list_failed', stagesRes.error.message);
      if (orderRes.error) return routeError(500, 'crm_work_order_stages_order_read_failed', orderRes.error.message);
      if (!orderRes.data) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

      const stages = (stagesRes.data || []) as unknown as WorkOrderStage[];
      if (!stages.some((s) => s.id === stageId)) {
        return routeError(404, 'crm_work_order_stage_not_found', 'Etappen hittades inte på den här ordern.');
      }
      const lineItems = ((orderRes.data as { line_items?: unknown[] }).line_items || []) as never[];

      // ⚠️ `excludeStageId` — utan den räknas etappens EGNA antal som upptagna av någon annan, och
      // att spara en etapp utan att ändra den hade svarat "raden har bara 0 kvar".
      const state = computeStageState(lineItems, stages, { excludeStageId: stageId });
      try {
        const allocation = validateStageAllocation(state, parsed.data.line_quantities);
        patch.line_quantities = [...allocation].map(([line_id, quantity]) => ({ line_id, quantity }));
      } catch (e) {
        if (e instanceof StageAllocationError) return routeError(409, 'crm_work_order_stage_allocation', e.message);
        throw e;
      }
    }

    if (Object.keys(patch).length === 0) {
      return routeError(400, 'crm_work_order_stage_nothing_to_update', 'Ingenting att uppdatera.');
    }

    const { data, error } = await updateCrmWorkOrderStage(supabase, stageId, workOrderId, patch);
    if (error) {
      if ((error as { code?: string }).code === '42501') {
        return routeError(403, 'crm_work_order_stage_forbidden', 'Du har inte behörighet att ändra etapper på den här ordern.');
      }
      return routeError(500, 'crm_work_order_stage_update_failed', error.message);
    }
    // En UPDATE som inte träffar någon rad svarar `error: null`. Utan raden tillbaka hade ett
    // RLS-nej sett ut som en lyckad ändring.
    if (!data) return routeError(404, 'crm_work_order_stage_not_found', 'Etappen hittades inte på den här ordern.');

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_stage_update_unexpected', e?.message || 'Failed to update stage');
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.write');
    if (gate.response) return gate.response;

    const { id: workOrderId, stageId } = context.params;
    const badOrder = invalidUuidParam(workOrderId);
    if (badOrder) return badOrder;
    const badStage = invalidUuidParam(stageId);
    if (badStage) return badStage;

    const force = new URL(req.url).searchParams.get('force') === '1';

    // ⚠️ RÄKNAS ELEVERAT, OCH FAILAR STÄNGT. Går räkningen sönder vet vi inte om etappen är
    // utplacerad — och att då gå vidare hade kunnat flytta säckantal på kort ingen tittar på.
    const counted = await countSegmentsForStage(getSupabaseAdmin(), stageId);
    if (counted.error) {
      return routeError(500, 'crm_work_order_stage_segment_count_failed', counted.error.message);
    }
    const segmentCount = counted.count ?? 0;

    if (segmentCount > 0 && !force) {
      // 409 och inte 400: kroppen är felfri, det är LÄGET som är svaret. Borttagningen lämnar
      // placeringarna kvar (stage_id är on delete set null) men rest-scopade, så kortens säckantal
      // hoppar. Det ska vara ett medvetet andra steg, inte en överraskning.
      return routeError(
        409,
        'crm_work_order_stage_has_segments',
        segmentCount === 1
          ? 'Etappen är utplacerad på kalendern. Tas den bort ligger placeringen kvar, men den kommer att visa resten av ordern i stället för etappens del.'
          : `Etappen är utplacerad på ${segmentCount} ställen i kalendern. Tas den bort ligger placeringarna kvar, men de kommer att visa resten av ordern i stället för etappens del.`,
      );
    }

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteCrmWorkOrderStage(supabase, stageId, workOrderId);
    if (error) {
      if ((error as { code?: string }).code === '42501') {
        return routeError(403, 'crm_work_order_stage_forbidden', 'Du har inte behörighet att ta bort etapper på den här ordern.');
      }
      return routeError(500, 'crm_work_order_stage_delete_failed', error.message);
    }
    if (!data) return routeError(404, 'crm_work_order_stage_not_found', 'Etappen hittades inte på den här ordern.');

    // Antalet tillbaka så att klienten kan säga vad som faktiskt hände med placeringarna.
    return ok({ id: stageId, released_segments: segmentCount });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_stage_delete_unexpected', e?.message || 'Failed to delete stage');
  }
}
