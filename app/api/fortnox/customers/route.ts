import { z } from 'zod';
import { requireCrmUser, ok, routeError, validationError } from '../_shared';
import { searchFortnoxCustomersLive } from '@/lib/domains/fortnox/customers';

const querySchema = z.object({
  q: z.string().trim().min(1, 'Sökterm krävs'),
});

// Live search of Fortnox customers (used in quote form for Fortnox customer lookup)
export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({ q: url.searchParams.get('q') || undefined });
    if (!parsed.success) return validationError(parsed.error);

    const customers = await searchFortnoxCustomersLive(parsed.data.q);
    return ok({ items: customers });
  } catch (e: any) {
    return routeError(500, 'fortnox_customers_search_failed', e?.message || 'Kundsökning misslyckades');
  }
}
