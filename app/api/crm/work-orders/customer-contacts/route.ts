import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getWorkOrderCallContacts, readableWorkOrderIds } from '@/lib/domains/crm/work-orders';
import { ok, requireSignedInUser, routeError, validationError } from '../_lib';

// Vem man ringer om FLERA arbetsordrar — startsidans arbetsschema, där varje stopp har en
// "Ring"-länk. En vecka är upp till ett tiotal ordrar; ett anrop per kort hade varit lika många
// rundturer vid varje laddning.
//
// ACCESS MODEL: samma som systern [id]/customer-contact, och den är den utförliga. RLS ÄR GRINDEN och
// frågas med SESSIONSKLIENTEN: läsaren får bara kontakten för ordrar den själv får se — besättningen
// via crew-policyn, kontoret via `crm.workorder.read`. Först därefter läses kontakten med service-role,
// eftersom besättningen inte har läsrätt på crm_customers. Ordrar läsaren inte ser saknas i svaret,
// precis som ordrar utan nummer — inget skiljer "finns inte" från "får inte se".
//
// ⚠️ Eleveras synlighetsfrågan också är routen en läcka: varje inloggat konto med en lista uuid:n hade
// fått kundernas namn och telefonnummer.
//
// POST för en läsning, av samma skäl som ../margins: id-listan går i kroppen. Rutten skriver ingenting.
// Sökvägen krockar inte med [id] — invalidUuidParam avvisar "customer-contacts" som id.
//
// nodejs: admin-klienten använder service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Taket ligger väl över en veckas jobb. Utan det kan en handskriven begäran be om hela registret.
const bodySchema = z.object({
  work_order_ids: z
    .array(z.string().uuid('Ogiltigt id'))
    .min(1, 'Minst ett id krävs')
    .max(100, 'För många ordrar i samma begäran'),
});

export async function POST(req: Request) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);
    // Gemener: databasen svarar med gemena uuid:n, och synlighetsmängden jämförs mot dem.
    const ids = Array.from(new Set(parsedBody.data.work_order_ids.map((id) => id.toLowerCase())));

    const { data: readable, error: readError } = await readableWorkOrderIds(createSessionClient(), ids);
    if (readError || !readable) return routeError(500, 'crm_work_order_contacts_failed', readError?.message || 'Failed to check access');
    const visible = ids.filter((id) => readable.has(id));
    if (visible.length === 0) return ok({ contacts: {} });

    const { data, error } = await getWorkOrderCallContacts(getSupabaseAdmin(), visible);
    if (!data) return routeError(500, 'crm_work_order_contacts_failed', error?.message || 'Failed to load contacts');
    // Kundkortet gick inte att läsa: slutkunderna på plats svarar ändå, resten uteblir. Kortet visar
    // då ingen "Ring"-länk för dem, och fältvyn har kontakten.
    if (error) console.warn('[work-orders/customer-contacts] kundkorten kunde inte läsas', error.message);

    return ok({ contacts: data });
  } catch (e: any) {
    return routeError(500, 'crm_work_order_contacts_unexpected', e?.message || 'Failed to load customer contacts');
  }
}
