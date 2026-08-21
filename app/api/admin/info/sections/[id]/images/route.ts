import { invalidUuidParam, ok, validationError } from '@/lib/api/responses';
import { registerImageSchema } from '@/lib/domains/info-page/schemas';
import { registerImage } from '@/lib/domains/info-page/mutations';
import { requireAdmin, readJson, toRouteError } from '../../../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/info/sections/[id]/images
// Steg 2 av två: filen ligger redan i storage, den här raden gör den synlig på sidan.
// Domänen vaktar att sökvägen är den vi reserverade för just den här fliken.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const badId = invalidUuidParam(params.id);
  if (badId) return badId;

  const parsed = registerImageSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);

  try {
    return ok({ image: await registerImage(auth.client, params.id, parsed.data) }, 201);
  } catch (error) {
    return toRouteError(error);
  }
}
