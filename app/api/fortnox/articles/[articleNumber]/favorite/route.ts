import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { ok, routeError, requireCrmWriter } from '../../../_shared';

type RouteContext = { params: { articleNumber: string } };

// Toggle an article as a global favorite. Shared (not per-user) — any CRM writer curates the set;
// RLS (has_permission('crm.write')) is the real gate, requireCrmWriter mirrors it in the app layer.

export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const articleNumber = decodeURIComponent(context.params.articleNumber);
    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await supabase
      .from('fortnox_article_favorites')
      .upsert({ article_number: articleNumber, created_by: crmUser.currentUser.id }, { onConflict: 'article_number' });

    if (error) return routeError(500, 'fortnox_article_favorite_failed', error.message);
    return ok({ article_number: articleNumber, is_favorite: true });
  } catch (e: any) {
    return routeError(500, 'fortnox_article_favorite_unexpected', e?.message || 'Kunde inte spara favorit');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const articleNumber = decodeURIComponent(context.params.articleNumber);
    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await supabase.from('fortnox_article_favorites').delete().eq('article_number', articleNumber);

    if (error) return routeError(500, 'fortnox_article_favorite_failed', error.message);
    return ok({ article_number: articleNumber, is_favorite: false });
  } catch (e: any) {
    return routeError(500, 'fortnox_article_favorite_unexpected', e?.message || 'Kunde inte ta bort favorit');
  }
}
