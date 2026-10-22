import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireSignedInUser } from '@/lib/auth/guards';
import { loadScheduleFacts } from '@/lib/domains/planning/scheduleFacts';
import { ok, routeError, validationError } from '../../_lib';

// Fakta till startsidans arbetsschema för den INLOGGADES egna CRM-jobb: säckar, material,
// rapporterat, team och om jobbet är klart, per placering och dag. Se lib/domains/planning/scheduleFacts.ts.
//
// ACCESS MODEL: FEEDEN ÄR GRINDEN. Rutten tar bara emot en period — aldrig placeringar eller ordrar —
// och frågar get_my_crm_jobs med SESSIONSKLIENTEN, alltså exakt de placeringar och dagar
// besättningsvillkoret (is_user_on_segment_between) redan ger läsaren på startsidan. Först därefter
// läses fakta med service-role, för de placeringarna och inga andra: montörerna har ingen läsrätt på
// ops_* (planning.schedule.read). Ett id ur klienten hade varit en väg förbi besättningsvillkoret.
//
// Svaret bär inga priser, inga kunduppgifter och inga konton — säckantal, materialnamn och
// besättningens namn, som planeringstavlan redan visar för samma bil.
//
// POST för en läsning, som ../../../work-orders/margins: Next 14 cachar inte en POST, och perioden går
// i kroppen. Rutten skriver ingenting.
//
// nodejs: admin-klienten använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Taket: startsidan frågar om en vecka. En månad räcker gott, och hindrar en handskriven begäran
// från att dra ett år av placeringar genom läsmodellen.
const bodySchema = z
  .object({
    start_date: z.string().regex(ISO_DATE, 'Ogiltigt datum'),
    end_date: z.string().regex(ISO_DATE, 'Ogiltigt datum'),
  })
  .refine((b) => b.end_date >= b.start_date, { message: 'Slutdatum före startdatum', path: ['end_date'] })
  .refine((b) => (Date.parse(`${b.end_date}T00:00:00Z`) - Date.parse(`${b.start_date}T00:00:00Z`)) / 86_400_000 <= 31, {
    message: 'Perioden får vara högst en månad',
    path: ['end_date'],
  });

export async function POST(req: Request) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    const { data: rows, error: feedError } = await createSessionClient().rpc('get_my_crm_jobs', {
      start_date: parsedBody.data.start_date,
      end_date: parsedBody.data.end_date,
    });
    if (feedError) return routeError(500, 'my_job_facts_failed', feedError.message);
    const feed = (Array.isArray(rows) ? rows : []) as Array<{ segment_id: string; job_day: string | null }>;
    if (feed.length === 0) return ok({ facts: {} });

    const { data, error } = await loadScheduleFacts(getSupabaseAdmin(), feed);
    if (!data) return routeError(500, 'my_job_facts_failed', error?.message || 'Failed to load schedule facts');
    // Teamet gick inte att läsa: säckarna och klart-läget svarar ändå, och kortet visar inget team.
    if (error) {
      console.warn('[planering/my-jobs/facts] besättningen kunde inte läsas', error.message);
      return ok({ facts: data, incomplete: true });
    }
    return ok({ facts: data });
  } catch (e: any) {
    return routeError(500, 'my_job_facts_unexpected', e?.message || 'Failed to load schedule facts');
  }
}
