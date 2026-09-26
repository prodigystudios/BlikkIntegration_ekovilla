import { createSessionClient } from '@/lib/supabase/session';
import { z } from 'zod';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { buildKmaPrefill, type KmaOrderSource } from '@/lib/domains/crm/kmaPlans/prefill';
import { latestKmaPlanBy, latestKmaPlanForOrder, listKmaDirectory } from '@/lib/domains/crm/kmaPlans/store';
import { listWorkOrderCrew } from '@/lib/domains/planning/workOrderCrew';
import { invalidUuidParam, isNoRowsError, ok, requirePermission, routeError, validationError } from '../../../_lib';

// Förifyllnaden av KMA-dialogen — vad ordern, planeringen, Kontaktlistan och tidigare planer redan
// vet (lib/domains/crm/kmaPlans/prefill.ts).
//
// Samma nyckel som skapandet (crm.workorder.write): förifyllnaden finns bara för att skapa en plan.
//
// ⚠️ INGEN SERVICE-ROLL. Säljarens namn går inte att slå upp för en kollega — profiles är
// self-read, och embedden `assignee:profiles!assigned_to` svarar null för alla utom en själv.
// SUPABASE_CONVENTIONS.md säger uttryckligen: lägg inte till en ny elevation för att slå upp ett
// namn. Sidan har redan namnet (den granskade /assignees-routen), så det kommer som `sales_name` —
// ett standardvärde i ett redigerbart fält, ingen behörighet.
//
// Besättningen, Kontaktlistan och tidigare planer är FÖRSLAG. En källa som fallerar loggas och
// ger ett tomt förslag — den fäller inte dialogen, där allt ändå går att skriva in för hand.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

const querySchema = z.object({
  sales_name: z.string().trim().max(120, 'Högst 120 tecken').optional(),
});

function warn(source: string, error: { message: string } | null) {
  if (error) console.warn(`[kma] förifyllnad: ${source} kunde inte läsas:`, error.message);
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('crm.workorder.write');
    if (guard.response || !guard.currentUser) return guard.response;
    const user = guard.currentUser;

    const workOrderId = context.params.id;
    const badId = invalidUuidParam(workOrderId);
    if (badId) return badId;

    const url = new URL(req.url);
    const query = querySchema.safeParse({ sales_name: url.searchParams.get('sales_name') ?? undefined });
    if (!query.success) return validationError(query.error);

    const supabase = createSessionClient();

    const { data: order, error: orderError } = await getCrmWorkOrder(supabase, workOrderId);
    if (orderError && !isNoRowsError(orderError)) {
      return routeError(500, 'crm_work_order_kma_order_read_failed', orderError.message);
    }
    if (!order) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

    const [crew, directory, orderLatest, mineLatest, companyLatest] = await Promise.all([
      listWorkOrderCrew(supabase, workOrderId),
      listKmaDirectory(supabase),
      latestKmaPlanForOrder(supabase, workOrderId),
      latestKmaPlanBy(supabase, user.id),
      latestKmaPlanBy(supabase, null),
    ]);
    warn('besättningen', crew.error);
    warn('Kontaktlistan', directory.error);
    warn('ordens senaste plan', orderLatest.error);
    warn('min senaste plan', mineLatest.error);
    warn('bolagets senaste plan', companyLatest.error);

    // Smalt med flit: arbetsbeskrivningen (portkoder), scope och personnummer når aldrig byggaren.
    const row = order as Record<string, unknown>;
    const source: KmaOrderSource = {
      project_name: (row.project_name as string | null) ?? null,
      client_name: (row.client_name as string | null) ?? null,
      order_number: (row.order_number as string | null) ?? null,
      fortnox_order_number: (row.fortnox_order_number as string | null) ?? null,
      work_address: (row.work_address as Record<string, unknown> | null) ?? null,
      customer_snapshot: (row.customer_snapshot as Record<string, unknown> | null) ?? null,
      rot_details: row.rot_details
        ? { property_designation: ((row.rot_details as Record<string, unknown>).property_designation as string | null) ?? null }
        : null,
      line_items: row.line_items ?? [],
      assignee: (row.assignee as { full_name?: string | null } | null) ?? null,
    };

    const directoryEntries = directory.error ? [] : directory.data ?? [];
    const prefill = buildKmaPrefill({
      order: source,
      crew: crew.error ? [] : crew.data,
      directory: directoryEntries,
      salesName: query.data.sales_name ?? null,
      orderLatest: orderLatest.error ? null : orderLatest.data ?? null,
      mineLatest: mineLatest.error ? null : mineLatest.data ?? null,
      companyLatest: companyLatest.error ? null : companyLatest.data ?? null,
    });

    // Kontaktlistan följer med till namnförslagen i dialogen. Den läses redan av varje inloggad
    // (/kontakt-lista), så det är ingen ny exponering.
    return ok({
      ...prefill,
      directory: directoryEntries.filter((entry) => entry.name?.trim()),
      crew_count: crew.error ? null : crew.data.length,
    });
  } catch (e: unknown) {
    console.error('[kma] förifyllnad:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'crm_work_order_kma_prefill_unexpected', 'Kunde inte förbereda KMA-planen.');
  }
}
