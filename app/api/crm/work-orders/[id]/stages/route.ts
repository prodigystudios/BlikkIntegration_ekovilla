import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  createCrmWorkOrderStage,
  getCrmWorkOrderLineItems,
  listCrmWorkOrderStages,
  nextCrmWorkOrderStageNumber,
} from '@/lib/domains/crm/work-orders';
import {
  computeStageState,
  StageAllocationError,
  validateStageAllocation,
  type WorkOrderStage,
} from '@/lib/domains/crm/workOrderStages';
import {
  createWorkOrderStageSchema,
  invalidUuidParam,
  ok,
  requirePermission,
  requireSignedInUser,
  routeError,
  validationError,
} from '../../_lib';

// Etapper på EN arbetsorder — kontorets indelning av ett jobb som utförs i omgångar.
//
// ⚠️ `stage` i kod och databas, "Etapp" i det användaren läser. Ordet betyder redan
// KONSTRUKTIONSDEL i egenkontrollen; se lib/domains/crm/workOrderStages.ts.
//
// EN KLIENT. Allt går genom sessionsklienten och RLS gör auktoriseringen — SELECT speglar orderns
// egen policy, skrivning kräver crm.workorder.write. Ingen admin-klient behövs, till skillnad från
// säckrutten (som måste slå upp ops_segments åt en installatör) och till skillnad från DELETE i
// [stageId], som räknar placeringar.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const [stagesRes, orderRes] = await Promise.all([
      listCrmWorkOrderStages(supabase, context.params.id),
      getCrmWorkOrderLineItems(supabase, context.params.id),
    ]);
    if (stagesRes.error) return routeError(500, 'crm_work_order_stages_list_failed', stagesRes.error.message);
    if (orderRes.error) return routeError(500, 'crm_work_order_stages_order_read_failed', orderRes.error.message);
    if (!orderRes.data) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

    const stages = (stagesRes.data || []) as unknown as WorkOrderStage[];
    const lineItems = ((orderRes.data as { line_items?: unknown[] }).line_items || []) as never[];

    // Radläget följer med svaret. Editorn behöver "kvar att planera" per rad för att kunna förifylla
    // och klampa, och att räkna om det i klienten hade varit en andra implementation av
    // computeStageState — samma fel som resten av det här arbetet gått ut på att ta bort.
    return ok({ items: stages, line_state: computeStageState(lineItems, stages) });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_stages_unexpected', e?.message || 'Failed to list stages');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.workorder.write');
    if (gate.response) return gate.response;
    const currentUser = await requireSignedInUser();
    if (currentUser.response || !currentUser.currentUser) return currentUser.response;

    const workOrderId = context.params.id;
    const badId = invalidUuidParam(workOrderId);
    if (badId) return badId;

    const parsed = createWorkOrderStageSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const [stagesRes, orderRes] = await Promise.all([
      listCrmWorkOrderStages(supabase, workOrderId),
      getCrmWorkOrderLineItems(supabase, workOrderId),
    ]);
    if (stagesRes.error) return routeError(500, 'crm_work_order_stages_list_failed', stagesRes.error.message);
    if (orderRes.error) return routeError(500, 'crm_work_order_stages_order_read_failed', orderRes.error.message);
    if (!orderRes.data) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

    const stages = (stagesRes.data || []) as unknown as WorkOrderStage[];
    const lineItems = ((orderRes.data as { line_items?: unknown[] }).line_items || []) as never[];

    // Antalen prövas mot orderns AKTUELLA rader och mot de andra etapperna. Domänen äger regeln —
    // den kan inte vara en databaskonstraint, se migreringens huvud.
    let allocation: Map<string, number>;
    try {
      allocation = validateStageAllocation(computeStageState(lineItems, stages), parsed.data.line_quantities);
    } catch (e) {
      if (e instanceof StageAllocationError) return routeError(409, 'crm_work_order_stage_allocation', e.message);
      throw e;
    }

    const nextNumber = await nextCrmWorkOrderStageNumber(supabase, workOrderId);
    if (nextNumber.error || nextNumber.data == null) {
      return routeError(500, 'crm_work_order_stage_number_failed', nextNumber.error?.message || 'Kunde inte numrera etappen.');
    }

    const { data, error } = await createCrmWorkOrderStage(supabase, {
      // Ur rutt-parametern, aldrig ur kroppen — RLS gatar på det här fältet.
      work_order_id: workOrderId,
      stage_number: nextNumber.data,
      title: parsed.data.title,
      // De dedupade, validerade antalen — inte kroppen rakt av. Skickar klienten samma rad två
      // gånger ska raden stå EN gång i boken, med summan.
      line_quantities: [...allocation].map(([line_id, quantity]) => ({ line_id, quantity })),
      work_description: parsed.data.work_description,
      job_type: parsed.data.job_type,
      created_by: currentUser.currentUser.id,
      created_by_name: currentUser.currentUser.name || 'Okänd',
    });

    if (error || !data) {
      // 23505 = unique (work_order_id, stage_number). Två samtidiga skapanden läste samma max — se
      // nextCrmWorkOrderStageNumber om varför det inte tas med ett lås. Be om ett nytt försök i
      // stället för att presentera det som ett serverfel.
      if ((error as { code?: string } | null)?.code === '23505') {
        return routeError(409, 'crm_work_order_stage_number_taken', 'Någon annan skapade en etapp samtidigt. Försök igen.');
      }
      if ((error as { code?: string } | null)?.code === '42501') {
        return routeError(403, 'crm_work_order_stage_forbidden', 'Du har inte behörighet att dela upp den här ordern i etapper.');
      }
      return routeError(500, 'crm_work_order_stage_create_failed', error?.message || 'Kunde inte spara etappen.');
    }

    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'crm_work_order_stage_create_unexpected', e?.message || 'Failed to create stage');
  }
}
