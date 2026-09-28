import { createSessionClient } from '@/lib/supabase/session';
import { isValidPortalArticleNumber } from '@/lib/domains/portal/articleFields';
import { portalArticleFieldsInputSchema, savePortalArticleFields } from '@/lib/domains/portal/articleFieldsStore';
import { ok, routeError, validationError, requirePermission } from '../../../_shared';

type RouteContext = { params: { articleNumber: string } };

// Spara portalfälten för en artikel (RESELLER_PORTAL_CRM_PLAN.md fas 2a). Reglerna bor i domänen; här är bara HTTP.
//
// Sessionsklienten: RLS (crm.article.manage) är den verkliga grinden, requirePermission speglar den. Fälten sparas i
// CRM:et, inte i Fortnox, så sparandet är skilt från artikelns eget Spara.
export async function PUT(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('crm.article.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    // En trasig procentkod (`%E0`) kastar URIError; det är ett fel i förfrågan, inte ett 500.
    let articleNumber: string;
    try {
      articleNumber = decodeURIComponent(context.params.articleNumber);
    } catch {
      articleNumber = '';
    }
    if (!isValidPortalArticleNumber(articleNumber)) {
      return routeError(400, 'invalid_article_number', 'Ogiltigt artikelnummer.');
    }

    const parsed = portalArticleFieldsInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const outcome = await savePortalArticleFields(createSessionClient(), articleNumber, parsed.data, gate.currentUser.id);
    switch (outcome.kind) {
      case 'saved':
        return ok({ fields: outcome.fields });
      case 'forbidden':
        return routeError(403, 'forbidden', 'Forbidden');
      case 'invalid':
        return routeError(400, 'portal_article_fields_invalid', outcome.message);
      case 'db_error':
        return routeError(500, 'portal_article_fields_failed', outcome.message);
    }
  } catch (e: any) {
    return routeError(500, 'portal_article_fields_unexpected', e?.message || 'Kunde inte spara portalfälten');
  }
}
