import { z } from 'zod';
import { requireCrmUser, ok, routeError, validationError } from '../_shared';
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
  } catch (e: any) {
    return routeError(500, 'fortnox_offer_push_failed', e?.message || 'Offert-push till Fortnox misslyckades');
  }
}
