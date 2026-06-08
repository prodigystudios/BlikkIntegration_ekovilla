import { z } from 'zod';
import { ok, routeError, requireCrmUser } from '@/app/api/crm/_shared';
import { searchTicPersons } from '@/lib/domains/tic/persons';
import { ticRouteErrorInfo } from '@/lib/domains/tic/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Person lookup via tic.io (private customers). CRM-scoped; person data is sensitive
// so access is gated by the same CRM auth as the rest of the customer flow.
const querySchema = z.object({ q: z.string().trim().min(2).max(120) });

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const parsed = querySchema.safeParse({ q: new URL(req.url).searchParams.get('q') });
    if (!parsed.success) return ok({ items: [] });

    const items = await searchTicPersons(parsed.data.q);
    return ok({ items });
  } catch (e) {
    const info = ticRouteErrorInfo(e);
    return routeError(info.status, info.code, info.message);
  }
}
