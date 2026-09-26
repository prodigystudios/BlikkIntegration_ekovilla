import { createSessionClient } from '@/lib/supabase/session';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { getCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { buildKmaDocument } from '@/lib/domains/crm/kmaPlans/document';
import { kmaPlanFilename } from '@/lib/domains/crm/kmaPlans/pdf';
import { kmaFormSchema, parseStoredKmaDocument } from '@/lib/domains/crm/kmaPlans/schemas';
import { insertKmaPlan, kmaRevisionState, listKmaPlans, type KmaPlanListRow } from '@/lib/domains/crm/kmaPlans/store';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { invalidUuidParam, isNoRowsError, ok, requirePermission, routeError, validationError } from '../../_lib';

// KMA-planerna på EN arbetsorder — listan (kortet på ordern) och skapandet av en ny revision.
//
// Sessionsklienten genomgående: RLS på crm_work_order_kma_plans gör auktoriseringen, och routens
// egen nyckelkontroll är den första av två spärrar. Läsning = crm.workorder.read (samma som
// följesedeln), skapande = crm.workorder.write. Ingen admin-klient någonstans.
//
// ⚠️ DOKUMENTET BYGGS HÄR, ur validerad indata och kodens mall — aldrig ur kroppen. Kroppen bär
// bara formulärvärdena; bolaget (alltid Isoleringslandslaget AB), policytexterna och datumen kommer
// från servern. Zod släpper okända nycklar, så ett eget bolagsblock i kroppen faller bort.
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export type KmaPlanItem = KmaPlanListRow & { pdf_url: string };

// Kortet öppnar PDF-rutten i en flik, och rutten sätter filnamnet själv (Content-Disposition) —
// listan behöver alltså bara adressen.
function toItem(row: KmaPlanListRow, workOrderId: string): KmaPlanItem {
  return { ...row, pdf_url: `/api/crm/work-orders/${workOrderId}/kma-plans/${row.id}/pdf` };
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('crm.workorder.read');
    if (guard.response) return guard.response;

    const workOrderId = context.params.id;
    const badId = invalidUuidParam(workOrderId);
    if (badId) return badId;

    const supabase = createSessionClient();
    const { data, error } = await listKmaPlans(supabase, workOrderId);
    if (error) return routeError(500, 'crm_work_order_kma_list_failed', error.message);

    // Knappen "Skapa KMA-plan" / "Revidera" avgörs på SERVERN, på samma nyckel som insert-policyn
    // kräver. Härleddes den ur rollen i klienten svarade kortet ja där databasen svarar nej så fort
    // en nyckel dras in i adminytan.
    const canCreate = can(await getEffectivePermissions(), 'crm.workorder.write');
    return ok({ items: (data ?? []).map((row) => toItem(row, workOrderId)), can_create: canCreate });
  } catch (e: unknown) {
    console.error('[kma] listan:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'crm_work_order_kma_list_unexpected', 'Kunde inte hämta KMA-planerna.');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const guard = await requirePermission('crm.workorder.write');
    if (guard.response || !guard.currentUser) return guard.response;
    const user = guard.currentUser;

    const workOrderId = context.params.id;
    const badId = invalidUuidParam(workOrderId);
    if (badId) return badId;

    const parsed = kmaFormSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    const form = parsed.data;

    const supabase = createSessionClient();

    // Ordern läses med sessionen: den som inte ser ordern ska få 404, inte en plan på den.
    const { data: order, error: orderError } = await getCrmWorkOrder(supabase, workOrderId);
    if (orderError && !isNoRowsError(orderError)) {
      return routeError(500, 'crm_work_order_kma_order_read_failed', orderError.message);
    }
    if (!order) return routeError(404, 'crm_work_order_not_found', 'Arbetsordern hittades inte.');

    const { data: state, error: stateError } = await kmaRevisionState(supabase, workOrderId);
    if (stateError || !state) {
      return routeError(500, 'crm_work_order_kma_revision_failed', stateError?.message || 'Kunde inte räkna fram revisionen.');
    }

    // Svensk kalenderdag — toISOString() hade gett GÅRDAGEN mellan midnatt och två.
    const issuedOn = stockholmTodayISO();
    const revision = state.next;
    const firstIssuedOn = state.firstIssuedOn ?? issuedOn;
    const document = buildKmaDocument(form, { revision, issuedOn, firstIssuedOn });
    // Invariant: det som sparas måste gå att rendera. Spara ALDRIG en revision som PDF-routen sedan
    // avvisar — raden går inte att ändra eller ta bort från appen, och ordern hade burit en plan som
    // aldrig kan öppnas.
    if (!parseStoredKmaDocument(document)) {
      console.error('[kma] byggt dokument klarar inte dokumentschemat', workOrderId);
      return routeError(500, 'crm_work_order_kma_invalid_document', 'KMA-planen kunde inte byggas. Inget sparades.');
    }

    const { data, error } = await insertKmaPlan(supabase, {
      // Ur rutt-parametern, aldrig ur kroppen.
      work_order_id: workOrderId,
      revision,
      issued_on: issuedOn,
      project_name: form.project.projectName,
      input: form,
      document,
      created_by: user.id,
      created_by_name: user.name || 'Okänd',
    });
    if (error || !data) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '23505') {
        return routeError(
          409,
          'crm_work_order_kma_revision_conflict',
          'Någon annan sparade en revision av planen samtidigt. Ladda om och försök igen.',
        );
      }
      if (code === '42501') {
        return routeError(403, 'crm_work_order_kma_forbidden', 'Du har inte behörighet att skapa KMA-planer.');
      }
      return routeError(500, 'crm_work_order_kma_create_failed', error?.message || 'Kunde inte spara KMA-planen.');
    }

    // Dialogen laddar ned planen direkt efter sparningen och behöver namnet till nedladdningen.
    const item = toItem(data, workOrderId);
    return ok({ item, pdf_url: item.pdf_url, filename: kmaPlanFilename(document.meta) }, 201);
  } catch (e: unknown) {
    console.error('[kma] skapa:', e instanceof Error ? e.stack ?? e.message : e);
    return routeError(500, 'crm_work_order_kma_create_unexpected', 'Kunde inte spara KMA-planen.');
  }
}
