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

    // Bindningskontrollen etapp↔order, FÖRE något skrivs — och etappraderna som allokeringen nedan
    // behöver. `updateCrmWorkOrderStage` binder också på work_order_id, men ett 404 här är ett
    // ärligare svar än ett som kommer efter att vi hunnit räkna.
    const beforeRes = await listCrmWorkOrderStages(supabase, workOrderId);
    if (beforeRes.error) return routeError(500, 'crm_work_order_stages_list_failed', beforeRes.error.message);
    const stagesBefore = (beforeRes.data || []) as unknown as WorkOrderStage[];
    if (!stagesBefore.some((s) => s.id === stageId)) {
      return routeError(404, 'crm_work_order_stage_not_found', 'Etappen hittades inte på den här ordern.');
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.work_description !== undefined) patch.work_description = parsed.data.work_description;
    if (parsed.data.job_type !== undefined) patch.job_type = parsed.data.job_type;

    if (parsed.data.line_quantities !== undefined) {
      const orderRes = await getCrmWorkOrderLineItems(supabase, workOrderId);
      if (orderRes.error) return routeError(500, 'crm_work_order_stages_order_read_failed', orderRes.error.message);
      if (!orderRes.data) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

      const stages = stagesBefore;
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

    // 🧨 ÄNDRINGEN MÅSTE NÅ PLACERINGARNA. Beskrivningen och jobbtypen KOPIERAS till placeringen vid
    // utplacering (se placeSegment), och `moveSegmentSchema` har ingen work_description — en riktig
    // placerings text går alltså inte att ändra någonstans i UI:t. Utan det här satt den gamla
    // texten fast för alltid: kontoret rättade etappen, fältet läste kvar felet. Upptäckt i skarp
    // QA 2026-09-18 när en rad var fel i etappens beskrivning och rättelsen aldrig nådde fram.
    //
    // ⚠️ ALLA etappens placeringar, villkorslöst — inte bara de som fortfarande matchar det gamla
    // värdet. Första utkastet hade den försiktigare regeln och den var FEL: eftersom ingenting kan
    // redigera en riktig placerings beskrivning är varje avvikelse mellan etapp och placering per
    // definition staleness, aldrig ett medvetet val. Regeln skyddade alltså ett fall som inte kan
    // uppstå och missade det som gör det — mätt i skarp QA: synced_segments = 0 på en placering som
    // bevisligen bar fel text. Får placeringen en egen editor någon gång måste det här villkoras om.
    //
    // ⚠️ ELEVERAT. ops_segments kräver planning.schedule.write, och kontoret bär crm.workorder.write
    // — inte nödvändigtvis båda. Bundet till stage_id OCH work_order_id ur rutt-parametern.
    //
    // ⚠️ FAILAR ÖPPET: går propageringen sönder är etappen ändå sparad, och svaret säger hur många
    // placeringar som hängde med. Att avvisa en lyckad etappändring för att en följdskrivning
    // missades hade varit ett sämre byte.
    // ⚠️ PROPAGERAR ÄVEN NÄR VÄRDET ÄR OFÖRÄNDRAT, så länge fältet finns med i begäran. Ett första
    // utkast hoppade över no-op-sparningar, och då fanns ingen väg alls att reparera en placering
    // som glidit isär innan den här koden fanns — mätt i skarp QA: en placering bar bevisligen fel
    // text, och "spara etappen igen" gjorde ingenting. Nu är omsparning en reparation, till priset
    // av en överflödig UPDATE på en handfull rader.
    let synced = 0;
    const fields: Array<'work_description' | 'job_type'> = [];
    if (parsed.data.work_description !== undefined) fields.push('work_description');
    if (parsed.data.job_type !== undefined) fields.push('job_type');

    if (fields.length > 0) {
      const admin = getSupabaseAdmin();
      const next: Record<string, unknown> = {};
      for (const field of fields) {
        next[field] = field === 'work_description' ? parsed.data.work_description : parsed.data.job_type;
      }
      const { data: touched } = await admin
        .from('ops_segments')
        .update(next)
        .eq('stage_id', stageId)
        .eq('work_order_id', workOrderId)
        .select('id');
      synced = (touched ?? []).length;
    }

    return ok({ item: data, synced_segments: synced });
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

    const supabase = createRouteHandlerClient({ cookies });

    // 🧨 BINDNINGEN PRÖVAS FÖRE RÄKNINGEN. Räknades placeringarna först svarade routen 409 med en
    // ANNAN orders antal — ett litet läckage, och fel svar: en etapp som inte hör till den här
    // ordern är 404, inte "den är utplacerad". Sessionsklienten, så RLS avgör om etappen får läsas.
    const { data: stageRow, error: stageErr } = await listCrmWorkOrderStages(supabase, workOrderId);
    if (stageErr) return routeError(500, 'crm_work_order_stages_list_failed', stageErr.message);
    if (!((stageRow || []) as Array<{ id: string }>).some((s) => s.id === stageId)) {
      return routeError(404, 'crm_work_order_stage_not_found', 'Etappen hittades inte på den här ordern.');
    }

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
