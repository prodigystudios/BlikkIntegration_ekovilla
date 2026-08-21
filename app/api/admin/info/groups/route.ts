import { ok, validationError } from '@/lib/api/responses';
import { createGroupSchema } from '@/lib/domains/info-page/schemas';
import { createGroup } from '@/lib/domains/info-page/mutations';
import { requireAdmin, readJson, toRouteError } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/info/groups — nytt avsnitt (den grå rubriken på sidan).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const parsed = createGroupSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);

  try {
    return ok({ group: await createGroup(auth.client, auth.userId, parsed.data.title) }, 201);
  } catch (error) {
    return toRouteError(error);
  }
}
