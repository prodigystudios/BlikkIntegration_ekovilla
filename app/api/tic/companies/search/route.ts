import { z } from 'zod';
import { ok, routeError, requireCrmUser } from '@/app/api/crm/_shared';
import { searchTicCompanies } from '@/lib/domains/tic/companies';
import { ticRouteErrorInfo } from '@/lib/domains/tic/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Company lookup via tic.io. CRM-scoped (same roles as the rest of the CRM). The
// client debounces; a too-short query returns an empty list rather than an error.
const querySchema = z.object({ q: z.string().trim().min(2).max(120) });

export async function GET(req: Request) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const parsed = querySchema.safeParse({ q: new URL(req.url).searchParams.get('q') });
    if (!parsed.success) return ok({ items: [] });

    const items = await searchTicCompanies(parsed.data.q);
    return ok({ items });
  } catch (e) {
    const info = ticRouteErrorInfo(e);
    return routeError(info.status, info.code, info.message);
  }
}
