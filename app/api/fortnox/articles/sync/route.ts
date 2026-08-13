import { requireCrmAdmin, ok, routeError } from '../../_shared';
import { syncFortnoxArticles } from '@/lib/domains/fortnox/articles';

export async function POST() {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const result = await syncFortnoxArticles();
    // notesFetched: hur många artikelbeskrivningar som hämtades. Första körningen efter att
    // funktionen infördes hämtar hela registret (~100 s); därefter är den nära noll.
    return ok({ synced: result.synced, pages: result.pages, notesFetched: result.notesFetched });
  } catch (e: any) {
    return routeError(500, 'fortnox_articles_sync_failed', e?.message || 'Artikelsynk misslyckades');
  }
}
