import { invalidUuidParam, ok, validationError } from '@/lib/api/responses';
import { updateSectionSchema } from '@/lib/domains/info-page/schemas';
import { buildSectionPatch, deleteSection, updateSection } from '@/lib/domains/info-page/mutations';
import { requireAdmin, readJson, toRouteError } from '../../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const badId = invalidUuidParam(params.id);
  if (badId) return badId;

  const raw = await readJson(req);
  const parsed = updateSectionSchema.safeParse(raw);
  if (!parsed.success) return validationError(parsed.error);

  // Nyckelns NÄRVARO avgör om brödtexten ska skrivas — `undefined` ensamt skiljer inte
  // "skickade ingen body" från "skickade en tom body".
  const hasBody = !!raw && typeof raw === 'object' && 'body' in (raw as Record<string, unknown>);

  try {
    const patch = buildSectionPatch(parsed.data, hasBody);
    return ok({ section: await updateSection(auth.client, params.id, patch) });
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
    return ok({ id: (await deleteSection(auth.client, params.id)).id });
  } catch (error) {
    return toRouteError(error);
  }
}
