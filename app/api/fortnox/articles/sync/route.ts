import { requireCrmAdmin, ok, routeError } from '../../_shared';
import { syncFortnoxArticles } from '@/lib/domains/fortnox/articles';

// Den FÖRSTA synken efter att beskrivningarna infördes hämtar dem en artikel i taget, throttlat
// (~289 anrop à 300 ms ≈ 100 s), och kan därtill rida ut en 429-backoff. Deklarera taket i stället
// för att förlita sig på plattformens default — en tystnad här ser ut som "synk misslyckades" fast
// rader faktiskt skrevs. Efterföljande synkar hämtar bara nya artiklar och tar sekunder.
export const maxDuration = 300;

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
