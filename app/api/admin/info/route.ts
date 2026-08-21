import { ok } from '@/lib/api/responses';
import { loadInfoPage } from '@/lib/domains/info-page/queries';
import { requireAdmin, toRouteError } from './_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/info — hela trädet som redigeraren arbetar mot.
// Samma laddare som den publika sidan använder, så redigeraren aldrig kan visa en annan
// sanning än besökaren: whitelistningen av body och signeringen av bilder sker på ett ställe.
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  try {
    return ok({ groups: await loadInfoPage(auth.client) });
  } catch (error) {
    return toRouteError(error);
  }
}
