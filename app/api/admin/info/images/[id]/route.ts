import { invalidUuidParam, ok } from '@/lib/api/responses';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { deleteImage } from '@/lib/domains/info-page/mutations';
import { removeInfoImageObject } from '@/lib/domains/info-page/storage';
import { requireAdmin, toRouteError } from '../../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE /api/admin/info/images/[id]
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const badId = invalidUuidParam(params.id);
  if (badId) return badId;

  try {
    const row = await deleteImage(auth.client, params.id);

    if (row.storage_bucket && row.storage_path) {
      const admin = getOptionalSupabaseAdmin();
      // Städningen är best-effort med flit: raden är borta, alltså är bilden borta från sidan.
      // Ett kvarlämnat objekt kostar ingenting och är räddningen om raderingen var ett felklick.
      // En seedad rad (public_path) har inget objekt att städa.
      if (admin) await removeInfoImageObject(admin, row.storage_bucket, row.storage_path);
    }

    return ok({ id: row.id });
  } catch (error) {
    return toRouteError(error);
  }
}
