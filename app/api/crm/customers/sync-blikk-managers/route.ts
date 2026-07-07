import { z } from 'zod';
import { requireCrmAdmin, ok, routeError, validationError } from '../../_shared';
import { syncBlikkAccountManagersPage } from '@/lib/domains/crm/blikkAccountManagers';

// Backfill av kundansvarig från Blikk (endast företagskunder, matchat på kundnummer).
// Resum-bar per Blikk-listsida: UI:t loopar page 1,2,3… tills nextPage === null.
//
// En sida kan trigga upp till pageSize strypta detalj-anrop (~300 ms styck) när ansvarig
// bara finns på kund-detaljen, så ge routen gott om tid innan serverless-timeout.
export const maxDuration = 300;

const bodySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(100),
});

export async function POST(req: Request) {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error);

    const result = await syncBlikkAccountManagersPage(parsed.data.page, parsed.data.pageSize);
    return ok(result);
  } catch (e: any) {
    return routeError(500, 'blikk_account_managers_sync_failed', e?.message || 'Blikk-import misslyckades');
  }
}
