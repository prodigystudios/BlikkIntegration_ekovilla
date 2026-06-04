import { requireCrmAdmin, ok, routeError } from '../../_shared';
import { syncFortnoxArticles } from '@/lib/domains/fortnox/articles';

export async function POST() {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const result = await syncFortnoxArticles();
    return ok({ synced: result.synced, pages: result.pages });
  } catch (e: any) {
    return routeError(500, 'fortnox_articles_sync_failed', e?.message || 'Artikelsynk misslyckades');
  }
}
