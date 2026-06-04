import { z } from 'zod';
import { requireCrmUser, ok, routeError, validationError } from '../_shared';
import { listCachedFortnoxArticles } from '@/lib/domains/fortnox/articles';

const querySchema = z.object({
  q: z.string().trim().optional(),
  active_only: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get('q') || undefined,
      active_only: url.searchParams.get('active_only') || undefined,
      limit: url.searchParams.get('limit') || undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const articles = await listCachedFortnoxArticles({
      search: parsed.data.q,
      activeOnly: parsed.data.active_only !== 'false',
      limit: parsed.data.limit,
    });

    return ok({ items: articles, count: articles.length });
  } catch (e: any) {
    return routeError(500, 'fortnox_articles_list_failed', e?.message || 'Kunde inte hämta artiklar');
  }
}
