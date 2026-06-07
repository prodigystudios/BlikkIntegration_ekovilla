import { z } from 'zod';
import { requireCrmUser, ok, validationError, fortnoxWriteError } from '../_shared';
import { pushQuoteToFortnox } from '@/lib/domains/fortnox/offers';

const bodySchema = z.object({
  quote_id: z.string().uuid('Ogiltigt offert-ID'),
});

export async function POST(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const result = await pushQuoteToFortnox(parsed.data.quote_id);
    return ok(result);
  } catch (e: unknown) {
    return fortnoxWriteError(e, 'fortnox_offer_push_failed', 'Offert-push till Fortnox misslyckades');
  }
}
