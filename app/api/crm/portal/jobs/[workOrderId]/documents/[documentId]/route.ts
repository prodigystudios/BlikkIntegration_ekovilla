import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { documentErrorPage, isDocumentNavigation } from '@/lib/api/responses';
import { openPortalJobDocument } from '@/lib/domains/portal/jobDocumentsStore';
import { invalidUuidParam, requirePermission, routeError } from '../../../../../_shared';

type RouteContext = { params: { workOrderId: string; documentId: string } };

// "Öppna" i kortet "Butiken" (RESELLER_PORTAL_CRM_PLAN.md fas 7): exakt den PDF som frystes och skickades till butiken,
// inte en ny rendering. crm.workorder.read, och sessionen måste kunna läsa dokumentet på just den här arbetsordern (RLS);
// filen läses sedan med service-rollen, eftersom bucketen inte har några policyer. Se "Reviewed elevations" i
// SUPABASE_CONVENTIONS.md.
//
// Öppnas i en flik, så ett fel svaras som en HTML-sida där, som orderbekräftelsens PDF-route.
//
// Routen läser kakan (requirePermission) före varje fetch, så Next 14 cachar inte supabase-anropen trots att den bara
// har GET (se project_next14_get_route_fetch_cache). fetchCache står ändå här: ingen PDF får någonsin komma ur en cache.

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: Request, context: RouteContext) {
  const fail = (status: number, code: string, message: string) =>
    isDocumentNavigation(req) ? documentErrorPage(status, message) : routeError(status, code, message);
  try {
    const gate = await requirePermission('crm.workorder.read');
    if (gate.response || !gate.currentUser) {
      return isDocumentNavigation(req)
        ? documentErrorPage(gate.response?.status ?? 401, 'Du har inte behörighet till arbetsordern.')
        : gate.response;
    }

    const badId = invalidUuidParam(context.params.workOrderId) ?? invalidUuidParam(context.params.documentId);
    if (badId) return fail(400, 'invalid_id', 'Ogiltigt id.');

    const file = await openPortalJobDocument(
      createSessionClient(),
      getSupabaseAdmin(),
      context.params.workOrderId,
      context.params.documentId,
    );
    if (!file) return fail(404, 'portal_document_not_found', 'Dokumentet finns inte.');

    // Svenska tecken i namnet kräver filename*; ett enkelt namn står bredvid för äldre läsare. Samma som portalen.
    const ascii = file.name.replace(/[^\x20-\x7e]|"/g, '_');
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[portal-documents] dokumentet gick inte att öppna', { error: e instanceof Error ? e.message : e });
    return fail(500, 'portal_document_open_failed', 'Dokumentet kunde inte hämtas.');
  }
}
