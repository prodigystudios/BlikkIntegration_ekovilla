import { invalidUuidParam, ok, validationError } from '@/lib/api/responses';
import { updateGroupSchema } from '@/lib/domains/info-page/schemas';
import { deleteGroup, updateGroup } from '@/lib/domains/info-page/mutations';
import { requireAdmin, readJson, toRouteError } from '../../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const badId = invalidUuidParam(params.id);
  if (badId) return badId;

  const parsed = updateGroupSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);

  try {
    return ok({ group: await updateGroup(auth.client, params.id, parsed.data) });
  } catch (error) {
    return toRouteError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const badId = invalidUuidParam(params.id);
  if (badId) return badId;

  try {
    return ok({ id: (await deleteGroup(auth.client, params.id)).id });
  } catch (error) {
    return toRouteError(error);
  }
}
