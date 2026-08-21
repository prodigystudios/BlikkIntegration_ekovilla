import { ok, validationError } from '@/lib/api/responses';
import { createSectionSchema } from '@/lib/domains/info-page/schemas';
import { createSection } from '@/lib/domains/info-page/mutations';
import { requireAdmin, readJson, toRouteError } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/info/sections — ny flik (ett dragspel under ett avsnitt).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const parsed = createSectionSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);

  try {
    return ok({ section: await createSection(auth.client, auth.userId, parsed.data) }, 201);
  } catch (error) {
    return toRouteError(error);
  }
}
